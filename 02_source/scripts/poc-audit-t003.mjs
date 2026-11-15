/**
 * T003 PoC audit runner (PROJECT_BOOK §4.1, §10.1; IMPLEMENTATION_PLAN T003).
 *
 * For every fixture under 02_source/tests/fixtures/s0/{typescript,go}:
 *   1. Runs the production extractor (TS or Go) on the fixture repo.
 *   2. Compares extractor output against the HAND-WRITTEN golden.json
 *      field-by-field (modules incl. module_id/content_sha256 recomputed
 *      from the repo files via the frozen contracts, edges incl. typeOnly,
 *      generated edges, external count, unknowns, excluded files).
 *      Any field mismatch = parity FAIL.
 *   3. Runs a minimal FULL_GRAPH audit of the synthetic claimed map
 *      against the extracted ground truth (snapshot binding, hallucinated
 *      / missing edges, wrong entrypoint, unclaimed reachable modules,
 *      name-collision confusion, generated mismatch, dynamic-import
 *      unknown) and compares status + finding set with golden.json.
 *
 * This runner is a PoC harness for T003 only. The independent Oracle +
 * S0 gate belong to T004 and must not reuse this code's expectations.
 *
 * Usage: node scripts/poc-audit-t003.mjs [--fixtures <dir>] [--out <json>]
 * Exit 0 = all 32 fixtures pass parity + audit; 1 = any failure.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { extractTypeScriptRepo } from "../dist/extractors/typescript/index.js";
import { extractGoRepo } from "../dist/extractors/go/index.js";
import {
  computeContentSha256,
  computeGoPackageContentSha256,
  computeModuleId,
  normalizeRelativePath,
  parseEntrypointsTomlOptional,
} from "../dist/contracts/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FIXTURES = join(ROOT, "tests", "fixtures", "s0");

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
const FIXTURES_DIR = argValue("--fixtures", DEFAULT_FIXTURES);
const OUT_PATH = argValue("--out", "");

function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** All files under a dir, repo-relative POSIX paths, sorted. */
function listFilesRecursive(dirAbs, dirRel = "") {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const rel = dirRel === "" ? e.name : `${dirRel}/${e.name}`;
    if (e.isDirectory()) out.push(...listFilesRecursive(join(dirAbs, e.name), rel));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

/** Canonical snapshot hash — same definition as the fixture generator. */
function snapshotHash(repoDir) {
  const lines = [];
  for (const rel of listFilesRecursive(repoDir)) {
    const content = readFileSync(join(repoDir, rel));
    lines.push(`${rel}\0${sha256Hex(content)}\n`);
  }
  return sha256Hex(lines.join(""));
}

function edgeKey(e) {
  return `${e.from}\0${e.to}\0${e.typeOnly === true ? "t" : "r"}`;
}

function sortStrings(arr) {
  return [...arr].sort();
}

/** Compare extractor output with the hand-written golden. Returns mismatches. */
function compareGolden(lang, extraction, golden, repoDir) {
  const mismatches = [];
  const exp = golden.expected;

  // ---- modules ----
  const expModules = new Map(exp.modules.map((m) => [m.relativePath, m]));
  const gotModules = new Map();
  for (const detail of extraction.modules ?? extraction.packages ?? []) {
    const mod = detail.module;
    gotModules.set(mod.relativePath, { module: mod, detail });
  }
  for (const [path, em] of expModules) {
    const got = gotModules.get(path);
    if (got === undefined) {
      mismatches.push(`missing module ${path}`);
      continue;
    }
    const { module: gm, detail } = got;
    const check = (field, expected, actual) => {
      if (expected !== actual) {
        mismatches.push(`module ${path}: ${field} expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
      }
    };
    check("nodeKind", em.nodeKind, gm.nodeKind);
    check("isGenerated", em.isGenerated, gm.isGenerated);
    check("isEntrypoint", em.isEntrypoint, gm.isEntrypoint);
    check("parseStatus", em.parseStatus, gm.parseStatus);
    // module_id recomputed from the contract (never copied from output).
    const idInput = lang === "go" && path === "." ? "" : normalizeRelativePath(path);
    check("moduleId", computeModuleId(lang, idInput), gm.moduleId);
    if (lang === "typescript") {
      check("isDeclarationFile", em.isDeclarationFile, detail.isDeclarationFile);
      const content = readFileSync(join(repoDir, path), "utf8");
      check("contentSha256", computeContentSha256(content), gm.contentSha256);
      check("files", JSON.stringify(em.files), JSON.stringify(
        detail.module.relativePath === path
          ? [{ relativePath: path, isGenerated: gm.isGenerated, isCgo: false }]
          : [],
      ));
    } else {
      check("packageName", em.packageName, detail.packageName);
      const gotFiles = detail.files.map((f) => ({
        relativePath: f.relativePath, isGenerated: f.isGenerated, isCgo: f.isCgo,
      }));
      check("files", JSON.stringify(em.files), JSON.stringify(gotFiles));
      const expectedHash = computeGoPackageContentSha256(
        em.files.map((f) => ({
          relativePath: f.relativePath,
          contentSha256: computeContentSha256(readFileSync(join(repoDir, f.relativePath), "utf8")),
        })),
      );
      check("contentSha256", expectedHash, gm.contentSha256);
    }
  }
  for (const path of gotModules.keys()) {
    if (!expModules.has(path)) mismatches.push(`unexpected module ${path}`);
  }

  // ---- edges ----
  const edgeSet = (list) => new Set(list.map(edgeKey));
  const expEdges = edgeSet(exp.edges);
  const gotEdges = edgeSet(extraction.edges);
  for (const k of expEdges) if (!gotEdges.has(k)) mismatches.push(`missing edge ${k.replaceAll("\0", " -> ")}`);
  for (const k of gotEdges) if (!expEdges.has(k)) mismatches.push(`unexpected edge ${k.replaceAll("\0", " -> ")}`);
  const expGen = edgeSet(exp.generatedEdges ?? []);
  const gotGen = edgeSet(extraction.generatedEdges ?? []);
  for (const k of expGen) if (!gotGen.has(k)) mismatches.push(`missing generated edge ${k.replaceAll("\0", " -> ")}`);
  for (const k of gotGen) if (!expGen.has(k)) mismatches.push(`unexpected generated edge ${k.replaceAll("\0", " -> ")}`);

  // ---- external count, unknowns, excluded files ----
  if (extraction.externalImportCount !== exp.externalImportCount) {
    mismatches.push(`externalImportCount expected ${exp.externalImportCount} got ${extraction.externalImportCount}`);
  }
  const unknownKey = (u) => `${u.from}\0${u.specifier ?? u.importPath ?? ""}\0${u.reason}`;
  const expUnknowns = new Set((exp.unknowns ?? []).map(unknownKey));
  const gotUnknowns = new Set((extraction.unknowns ?? []).map(unknownKey));
  for (const k of expUnknowns) if (!gotUnknowns.has(k)) mismatches.push(`missing unknown ${k.replaceAll("\0", " | ")}`);
  for (const k of gotUnknowns) if (!expUnknowns.has(k)) mismatches.push(`unexpected unknown ${k.replaceAll("\0", " | ")}`);
  const exclKey = (e) => `${e.relativePath}\0${e.reason}`;
  const expExcl = new Set((exp.excludedFiles ?? []).map(exclKey));
  const gotExcl = new Set((extraction.excludedFiles ?? []).map(exclKey));
  for (const k of expExcl) if (!gotExcl.has(k)) mismatches.push(`missing excluded file ${k.replaceAll("\0", " | ")}`);
  for (const k of gotExcl) if (!expExcl.has(k)) mismatches.push(`unexpected excluded file ${k.replaceAll("\0", " | ")}`);

  return mismatches;
}

/** Minimal FULL_GRAPH audit of a claimed map vs extracted ground truth. */
function miniAudit(lang, extraction, claimed, repoDir) {
  const findings = new Set();
  const gtModules = new Map();
  for (const detail of extraction.modules ?? extraction.packages ?? []) {
    gtModules.set(detail.module.relativePath, detail.module);
  }
  const gtEdges = new Set(extraction.edges.map((e) => `${e.from}\0${e.to}`));
  const genEdges = new Set((extraction.generatedEdges ?? []).map((e) => `${e.from}\0${e.to}`));
  const claimedEdges = new Set(claimed.edges.map((e) => `${e.from}\0${e.to}`));
  const claimedModules = new Set(claimed.modules.map((m) => m.path));

  // Snapshot binding.
  const snapStatus = claimed.repoSnapshotSha256 === snapshotHash(repoDir) ? "MATCH" : "STALE_SNAPSHOT";

  for (const m of claimed.modules) {
    if (!gtModules.has(m.path)) findings.add("HALLUCINATED_MODULE");
  }
  for (const e of claimed.edges) {
    const key = `${e.from}\0${e.to}`;
    if (!gtEdges.has(key)) {
      if (genEdges.has(key)) findings.add("GENERATED_MISMATCH");
      else findings.add("HALLUCINATED_EDGE");
    }
  }
  for (const e of extraction.edges) {
    const key = `${e.from}\0${e.to}`;
    if (!claimedEdges.has(key)) findings.add("MISSING_EDGE");
  }

  // Declared entrypoints (.repomapverify.toml).
  let declared = [];
  const tomlPath = join(repoDir, ".repomapverify.toml");
  if (existsSync(tomlPath)) {
    try {
      declared = parseEntrypointsTomlOptional(readFileSync(tomlPath, "utf8")).paths;
    } catch {
      declared = [];
    }
  }
  const toEntryModule = (p) => (lang === "go" ? posix.dirname(p) : p);
  const declaredModules = new Set(declared.map(toEntryModule));
  const claimedEntries = new Set((claimed.entrypoints ?? []).map((p) =>
    lang === "go" ? p : p,
  ));
  if (declared.length > 0) {
    const same =
      declaredModules.size === claimedEntries.size &&
      [...declaredModules].every((d) => claimedEntries.has(d));
    if (!same) findings.add("WRONG_ENTRYPOINT");
  }

  // Reachability from declared entrypoints (runtime edges only: TS
  // type-only edges do not carry runtime reachability).
  const adjacency = new Map();
  for (const e of extraction.edges) {
    if (e.typeOnly === true) continue;
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    adjacency.get(e.from).push(e.to);
  }
  const reachable = new Set();
  const queue = [...declaredModules].filter((d) => gtModules.has(d));
  while (queue.length > 0) {
    const cur = queue.shift();
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    for (const nxt of adjacency.get(cur) ?? []) {
      if (!reachable.has(nxt)) queue.push(nxt);
    }
  }
  for (const mod of reachable) {
    if (!claimedModules.has(mod)) findings.add("UNCLAIMED_REACHABLE_MODULE");
  }

  // Name-collision confusion: a hallucinated edge whose target basename
  // matches the basename of a missing edge from the same source.
  const missingBySource = new Map();
  for (const e of extraction.edges) {
    if (!claimedEdges.has(`${e.from}\0${e.to}`)) {
      if (!missingBySource.has(e.from)) missingBySource.set(e.from, []);
      missingBySource.get(e.from).push(e.to);
    }
  }
  for (const e of claimed.edges) {
    const key = `${e.from}\0${e.to}`;
    if (gtEdges.has(key)) continue;
    for (const miss of missingBySource.get(e.from) ?? []) {
      if (miss !== e.to && basename(miss) === basename(e.to)) {
        findings.add("NAME_COLLISION_CONFUSION");
      }
    }
  }

  for (const u of extraction.unknowns ?? []) {
    if (u.reason === "DYNAMIC_IMPORT_UNKNOWN") findings.add("DYNAMIC_IMPORT_UNKNOWN");
  }

  const FAIL_FINDINGS = new Set([
    "HALLUCINATED_EDGE", "HALLUCINATED_MODULE", "WRONG_ENTRYPOINT",
    "MISSING_EDGE", "UNCLAIMED_REACHABLE_MODULE", "NAME_COLLISION_CONFUSION",
    "GENERATED_MISMATCH",
  ]);
  let status = "PASS";
  if (snapStatus !== "MATCH") status = "INCOMPLETE";
  else if ([...findings].some((f) => FAIL_FINDINGS.has(f))) status = "FAIL";
  else if (findings.has("DYNAMIC_IMPORT_UNKNOWN")) status = "INCOMPLETE";
  return { status, findings: sortStrings([...findings]), snapStatus };
}

async function runFixture(lang, dir) {
  const name = basename(dir);
  const repoDir = join(dir, "repo");
  const golden = JSON.parse(readFileSync(join(dir, "golden.json"), "utf8"));
  const claimed = JSON.parse(readFileSync(join(dir, "claimed-map.json"), "utf8"));
  const extraction = lang === "typescript"
    ? await extractTypeScriptRepo(repoDir)
    : await extractGoRepo(repoDir);
  const parityMismatches = compareGolden(lang, extraction, golden, repoDir);
  const audit = miniAudit(lang, extraction, claimed, repoDir);
  const auditMismatches = [];
  if (audit.snapStatus !== "MATCH") auditMismatches.push(`snapshot ${audit.snapStatus}`);
  if (audit.status !== golden.expectedStatus) {
    auditMismatches.push(`status expected ${golden.expectedStatus} got ${audit.status}`);
  }
  const expFindings = sortStrings(golden.expectedFindings ?? []);
  if (JSON.stringify(audit.findings) !== JSON.stringify(expFindings)) {
    auditMismatches.push(`findings expected [${expFindings.join(", ")}] got [${audit.findings.join(", ")}]`);
  }
  return {
    fixture: name,
    language: lang,
    kind: golden.kind,
    plantedClass: golden.plantedClass,
    parity: parityMismatches.length === 0 ? "PASS" : "FAIL",
    parityMismatches,
    audit: auditMismatches.length === 0 ? "PASS" : "FAIL",
    auditStatus: audit.status,
    auditFindings: audit.findings,
    auditMismatches,
  };
}

async function main() {
  const results = [];
  for (const lang of ["typescript", "go"]) {
    const langDir = join(FIXTURES_DIR, lang);
    if (!existsSync(langDir)) {
      console.error(`missing fixtures dir: ${langDir}`);
      process.exitCode = 1;
      continue;
    }
    const names = readdirSync(langDir)
      .filter((n) => statSync(join(langDir, n)).isDirectory())
      .sort();
    for (const name of names) {
      const r = await runFixture(lang, join(langDir, name));
      results.push(r);
      const ok = r.parity === "PASS" && r.audit === "PASS";
      console.log(`${ok ? "PASS" : "FAIL"}  ${r.fixture}  parity=${r.parity} audit=${r.audit} status=${r.auditStatus} findings=[${r.auditFindings.join(", ")}]`);
      for (const m of [...r.parityMismatches, ...r.auditMismatches]) {
        console.log(`        - ${m}`);
      }
    }
  }
  const total = results.length;
  const parityPass = results.filter((r) => r.parity === "PASS").length;
  const auditPass = results.filter((r) => r.audit === "PASS").length;
  const ctrlPass = results.filter((r) => r.kind === "control" && r.auditStatus === "PASS" && r.auditFindings.length === 0).length;
  const ctrlTotal = results.filter((r) => r.kind === "control").length;
  const plantDetected = results.filter((r) => r.kind === "planted" && r.auditStatus === "FAIL" && r.auditFindings.length > 0).length;
  const plantTotal = results.filter((r) => r.kind === "planted").length;
  console.log(`\nSUMMARY: ${total} fixtures, parity ${parityPass}/${total}, audit ${auditPass}/${total}, control PASS ${ctrlPass}/${ctrlTotal}, planted detected ${plantDetected}/${plantTotal}`);
  const report = {
    generatedAt: new Date().toISOString(),
    fixturesDir: FIXTURES_DIR,
    totals: { total, parityPass, auditPass, ctrlPass, ctrlTotal, plantDetected, plantTotal },
    results,
  };
  if (OUT_PATH !== "") {
    writeFileSync(OUT_PATH, JSON.stringify(report, null, 2) + "\n");
    console.log(`report written to ${OUT_PATH}`);
  }
  if (parityPass !== total || auditPass !== total) process.exitCode = 1;
}

await main();
