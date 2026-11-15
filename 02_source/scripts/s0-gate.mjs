#!/usr/bin/env node
/**
 * P024 T004 -- S0 gate runner (frozen npm script `s0:gate`).
 *
 *   npm run s0:gate [-- --replays 100]
 *
 * Steps (all verified by real commands, not self-report):
 *   1. Hash every fixture repo tree + every golden.json BEFORE the run.
 *   2. Clean build (rm -rf dist && npm run build).
 *   3. No-external-request proof: grep for network-call tokens
 *      (URL schemes, fetch, sockets, node network modules, HTTP
 *      clients) in 02_source/src + scripts, and audit the Oracle's
 *      imports (stdlib allowlist only).
 *   4. Run the independent Oracle (python3, stdlib only) over all 48
 *      fixtures, plus a 100x in-process replay (oracle.py --replay).
 *   5. Run the production extractors over all 48 fixtures
 *      (scripts/prod-probe.mjs), plus a 100x in-process replay.
 *   6. Three-way parity per fixture, no exemptions: golden canonical vs
 *      Oracle canonical vs production canonical, field-by-field. Every
 *      field the golden must specify is required: a missing golden field
 *      (absent key, or absent list) is a gate FAIL, never a silent
 *      fallback to Oracle-vs-production only. The only remaining
 *      Oracle-vs-production comparisons are the cryptographic digests
 *      (moduleId, contentSha256, repoSnapshotSha256), which no golden
 *      specifies -- the Python goldens never did either, and the vitest
 *      golden suite recomputes those digests independently from file
 *      bytes instead. An explicit golden null IS a compared value
 *      (e.g. Go edge kind null, TS/Go evidence statement null per the
 *      frozen convention that TS/Go carry no statement text).
 *   7. Independent audit from the PRODUCTION ground truth (fresh Node
 *      implementation of the spec section 5 rules, mirroring the Oracle
 *      audit) and comparison of both audits against the golden
 *      expectedStatus + expectedFindings.
 *   8. Hash every fixture repo tree + every golden.json AFTER the run;
 *      must be byte-identical (source-dir writes 0).
 *   9. Gate hash: SHA-256 over the normalized semantic results only
 *      (canonical GTs + audits + verdicts; no timestamps, durations,
 *      absolute paths, temp dirs or random ids).
 *
 * Outputs (03_evidence/S0/):
 *   S0_GATE.json, ORACLE_PARITY.json, REPEAT_HASH.json, S0_GATE.log
 *
 * Exit code 0 = S0 PASS, 1 = S0 FAIL (T005-T014 stay BLOCKED).
 */
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync,
         statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(SCRIPT_DIR, "..");
const PROJECT_ROOT = resolve(SRC_DIR, "..");
const FIXTURES_ROOT = join(SRC_DIR, "tests", "fixtures", "s0");
const ORACLE_PY = join(SRC_DIR, "oracle", "python", "oracle.py");
const PROD_PROBE = join(SCRIPT_DIR, "prod-probe.mjs");
const EVIDENCE_DIR = join(PROJECT_ROOT, "03_evidence", "S0");
const TMP_DIR = join(PROJECT_ROOT, ".tmp", "s0-gate");
const SEED = "P024-REPOMAPVERIFY-S0-2026-11-14";
const FAIL_FINDING_IDS = new Set([
  "HALLUCINATED_EDGE", "HALLUCINATED_MODULE", "WRONG_ENTRYPOINT",
  "MISSING_EDGE", "UNCLAIMED_REACHABLE_MODULE", "NAME_COLLISION_CONFUSION",
]);

const logLines = [];
function log(msg = "") {
  logLines.push(msg);
  console.log(msg);
}
function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortDeep(value[k]);
    return out;
  }
  return value;
}
function canonStr(obj) {
  return JSON.stringify(sortDeep(obj));
}

// FIX P024 R1 (evidence versions): inputCommit was hardcoded
// ("cb9b920") while the gate ran on a different checkout. Take the
// commit from the running checkout at runtime; "unknown" outside a
// git checkout. inputCommit is evidence metadata only -- it is NOT an
// input to the gate hash (gate hash = oracleMainHash + prodMainHash +
// goldenHash), so this change alone does not move the hash.
function gitHeadCommit() {
  try {
    return execSync("git rev-parse HEAD",
      { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Fixture + golden loading
// ---------------------------------------------------------------------------
function listFixtures() {
  const out = [];
  for (const langDir of ["python", "typescript", "go"]) {
    const dir = join(FIXTURES_ROOT, langDir);
    for (const name of readdirSync(dir).sort()) {
      if (!/^(py|ts|go)-/.test(name)) continue;
      if (!statSync(join(dir, name)).isDirectory()) continue;
      out.push({ name, langDir,
                 language: name.startsWith("py-") ? "python"
                   : name.startsWith("ts-") ? "typescript" : "go" });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function hashTree(rootDir) {
  // SHA-256 per file (relative POSIX path -> hex), then a combined hash
  // over sorted "path + NUL + sha + \n" lines. Read-only.
  const files = [];
  (function walk(dir, rel) {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const r = rel ? `${rel}/${entry}` : entry;
      if (statSync(full).isDirectory()) walk(full, r);
      else files.push([r, sha256Hex(readFileSync(full))]);
    }
  })(rootDir, "");
  const body = files.sort((a, b) => a[0].localeCompare(b[0]))
    .map(([p, h]) => `${p}\0${h}\n`).join("");
  return { files: Object.fromEntries(files), combined: sha256Hex(body) };
}

function loadGolden(fx) {
  const dir = join(FIXTURES_ROOT, fx.langDir, fx.name);
  return JSON.parse(readFileSync(join(dir, "golden.json"), "utf8"));
}

function loadClaimed(fx) {
  const dir = join(FIXTURES_ROOT, fx.langDir, fx.name);
  return JSON.parse(readFileSync(join(dir, "claimed-map.json"), "utf8"));
}

// ---------------------------------------------------------------------------
// Golden -> canonical ground truth (same schema as Oracle/production).
// FIX P1-02 (R1): TS/Go goldens now specify every hand-writable field
// (edge evidence line/specifier/file, conditional, typeOnly, kind,
// reachable/isolated sets, externalImports/dynamicUnknown lists,
// unknown line, Go hasCgo). A required golden field that is absent is
// recorded in `missing` and fails the gate in compareGT -- it NEVER
// falls back to Oracle-vs-production only. An explicit golden null is
// a real expected value and IS compared (Go kind null, TS/Go evidence
// statement null per the frozen convention). The only fields a golden
// legitimately leaves null are the cryptographic digests (moduleId,
// contentSha256, repoSnapshotSha256); those stay Oracle-vs-production
// (the Python goldens never specified them either, and the vitest
// golden suite recomputes them independently from file bytes).
// Returns { gt, missing }.
// ---------------------------------------------------------------------------
function canonicalizeGolden(fx, golden) {
  const lang = fx.language;
  if (lang === "python") {
    const modules = golden.modules.map((m) => ({
      relativePath: m.relativePath, moduleId: null, contentSha256: null,
      language: "python", nodeKind: m.nodeKind, isGenerated: m.isGenerated,
      isEntrypoint: m.isEntrypoint, parseStatus: m.parseStatus,
      files: null,
    })).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const edges = golden.edges.map((e) => ({
      from: e.from, to: e.to, conditional: e.conditional,
      typeOnly: e.typeOnly,
      evidence: { line: e.evidence.line, statement: e.evidence.statement,
                  specifier: null, file: null },
      kind: null,
    }));
    return { gt: {
      modules, edges,
      generatedEdges: null, // python golden specifies none
      entrypoints: [...golden.entrypoints].sort(),
      reachableFromEntrypoints: [...golden.reachableFromEntrypoints].sort(),
      isolatedModules: [...golden.isolatedModules].sort(),
      externalImportCount: golden.externalImportCount,
      externalImports: golden.externalImports.map((x) => ({
        from: x.from, specifier: x.specifier, line: x.line,
        conditional: x.conditional })).sort((a, b) =>
          a.from.localeCompare(b.from) || a.specifier.localeCompare(b.specifier) || a.line - b.line),
      unknownImports: golden.unknownImports.map((x) => ({
        from: x.from, specifier: x.specifier, reason: x.reason,
        line: x.line, statement: x.statement ?? null })).sort((a, b) =>
          a.from.localeCompare(b.from) || a.specifier.localeCompare(b.specifier) || a.line - b.line),
      dynamicUnknown: golden.dynamicUnknown.map((x) => ({
        path: x.path, line: x.line, statement: x.statement, kind: x.kind })).sort((a, b) =>
          a.path.localeCompare(b.path) || a.line - b.line),
      excludedFiles: [],
      repoSnapshotSha256: null,
    }, missing: [] };
  }
  const exp = golden.expected;
  // FIX P1-02: a required field that is absent is recorded, never
  // defaulted to null for a silent Oracle-vs-production fallback.
  const missing = [];
  const req = (cond, label) => {
    if (!cond) missing.push(`${fx.name}: golden missing required field: ${label}`);
  };
  const reqList = (value, label) => {
    req(Array.isArray(value), `${label} (must be an array)`);
    return Array.isArray(value) ? value : [];
  };
  const checkEdge = (e, label) => {
    req(typeof e.conditional === "boolean", `${label}.conditional`);
    req(typeof e.typeOnly === "boolean", `${label}.typeOnly`);
    if (lang === "typescript") req(typeof e.kind === "string", `${label}.kind`);
    else req(e.kind === null, `${label}.kind (go: null)`);
    req(e.evidence !== null && typeof e.evidence === "object",
      `${label}.evidence`);
    const ev = e.evidence ?? {};
    req(typeof ev.line === "number", `${label}.evidence.line`);
    req("statement" in ev, `${label}.evidence.statement`);
    req(typeof ev.specifier === "string", `${label}.evidence.specifier`);
    req(typeof ev.file === "string", `${label}.evidence.file`);
    return {
      from: e.from, to: e.to,
      conditional: typeof e.conditional === "boolean" ? e.conditional : null,
      typeOnly: typeof e.typeOnly === "boolean" ? e.typeOnly : null,
      evidence: { line: typeof ev.line === "number" ? ev.line : null,
                  statement: "statement" in ev ? ev.statement : undefined,
                  specifier: typeof ev.specifier === "string" ? ev.specifier : null,
                  file: typeof ev.file === "string" ? ev.file : null },
      kind: "kind" in e ? e.kind : undefined,
    };
  };
  const modules = reqList(exp.modules, "expected.modules").map((m) => {
    if (lang === "go") {
      req(typeof m.hasCgo === "boolean",
        `expected.modules[${m.relativePath}].hasCgo`);
    }
    return {
      relativePath: m.relativePath, moduleId: null, contentSha256: null,
      language: lang, nodeKind: m.nodeKind, isGenerated: m.isGenerated,
      isEntrypoint: m.isEntrypoint, parseStatus: m.parseStatus,
      ...(lang === "typescript"
        ? { isDeclarationFile: m.isDeclarationFile } : {}),
      ...(lang === "go"
        ? { packageName: m.packageName,
            hasCgo: typeof m.hasCgo === "boolean" ? m.hasCgo : null } : {}),
      files: (m.files ?? []).map((f) => ({ relativePath: f.relativePath,
        contentSha256: null, isGenerated: f.isGenerated, isCgo: f.isCgo })),
    };
  }).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const edges = reqList(exp.edges, "expected.edges")
    .map((e, i) => checkEdge(e, `expected.edges[${i}] (${e.from} -> ${e.to})`));
  const genEdges = reqList(exp.generatedEdges, "expected.generatedEdges")
    .map((e, i) => checkEdge(e, `expected.generatedEdges[${i}] (${e.from} -> ${e.to})`));
  const reachable = reqList(exp.reachableFromEntrypoints,
    "expected.reachableFromEntrypoints");
  const isolated = reqList(exp.isolatedModules, "expected.isolatedModules");
  const extImports = reqList(exp.externalImports, "expected.externalImports")
    .map((x) => ({ from: x.from, specifier: x.specifier, line: x.line,
                   conditional: x.conditional }))
    .sort((a, b) => a.from.localeCompare(b.from) ||
      a.specifier.localeCompare(b.specifier) || a.line - b.line);
  const dynUnknown = reqList(exp.dynamicUnknown, "expected.dynamicUnknown")
    .map((x) => ({ path: x.path, line: x.line, statement: x.statement,
                   kind: x.kind }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  const unknowns = reqList(exp.unknowns, "expected.unknowns").map((x, i) => {
    req(typeof x.line === "number",
      `expected.unknowns[${i}] (${x.from} ${x.specifier}).line`);
    // NOTE: the canonical unknown schema has no `statement` field
    // (Oracle header: unknownImports = {from, specifier, reason,
    // line}); it is therefore not a compared field -- see compareGT.
    return { from: x.from, specifier: x.specifier, reason: x.reason,
             line: typeof x.line === "number" ? x.line : null };
  }).sort((a, b) =>
    a.from.localeCompare(b.from) || a.specifier.localeCompare(b.specifier));
  return { gt: {
    modules, edges, generatedEdges: genEdges,
    entrypoints: modules.filter((m) => m.isEntrypoint)
      .map((m) => m.relativePath).sort(),
    reachableFromEntrypoints: [...reachable].sort(),
    isolatedModules: [...isolated].sort(),
    externalImportCount: exp.externalImportCount,
    externalImports: extImports,
    unknownImports: unknowns,
    dynamicUnknown: dynUnknown,
    excludedFiles: reqList(exp.excludedFiles, "expected.excludedFiles")
      .map((x) => ({ relativePath: x.relativePath, reason: x.reason })),
    repoSnapshotSha256: null,
  }, missing };
}

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------
function deepEq(a, b) {
  return canonStr(a) === canonStr(b);
}

function compareLists(path, goldenList, oracleList, prodList, keyFn,
                      fieldPaths, mismatches, opts = {}) {
  // FIX P1-02 (R1): a golden field that is ABSENT (undefined) is a
  // mismatch -- the gate FAILs instead of silently falling back to
  // Oracle-vs-production only. An explicit golden null IS compared as
  // a value (Go edge kind null, TS/Go evidence statement null).
  // opts.allowNullGoldenList: the list itself may be absent, and only
  // Oracle-vs-production is compared (frozen Python-golden cases:
  // python module files=null, python generatedEdges=null -- the
  // Python golden format specifies neither). opts.optionalGoldenFields:
  // fields whose golden null means "no expectation" -- the
  // cryptographic digests only (moduleId, contentSha256); those stay
  // Oracle-vs-production. Every other field is compared
  // golden-vs-oracle AND golden-vs-production AND oracle-vs-production.
  const { allowNullGoldenList = false,
          optionalGoldenFields = new Set() } = opts;
  const oMap = new Map((oracleList ?? []).map((r) => [keyFn(r), r]));
  const pMap = new Map((prodList ?? []).map((r) => [keyFn(r), r]));
  if (goldenList === null || goldenList === undefined) {
    if (!allowNullGoldenList) {
      mismatches.push(`${path}: golden does not specify this list`);
    }
    const keys = new Set([...oMap.keys(), ...pMap.keys()]);
    for (const key of [...keys].sort()) {
      const o = oMap.get(key), p = pMap.get(key);
      if (o === undefined) {
        mismatches.push(`${path}[${key}]: missing from Oracle output`);
        continue;
      }
      if (p === undefined) {
        mismatches.push(`${path}[${key}]: missing from production output`);
        continue;
      }
      for (const f of fieldPaths) {
        if (!deepEq(getField(o, f), getField(p, f))) {
          mismatches.push(`${path}[${key}].${f}: oracle=${canonStr(getField(o, f))} production=${canonStr(getField(p, f))}`);
        }
      }
    }
    return;
  }
  const gMap = new Map(goldenList.map((r) => [keyFn(r), r]));
  const keys = new Set([...gMap.keys(), ...oMap.keys(), ...pMap.keys()]);
  for (const key of [...keys].sort()) {
    const g = gMap.get(key), o = oMap.get(key), p = pMap.get(key);
    if (g === undefined) {
      mismatches.push(`${path}[${key}]: present in oracle/production but not in golden ` +
        `(oracle=${o !== undefined}, production=${p !== undefined})`);
      continue;
    }
    if (o === undefined) {
      mismatches.push(`${path}[${key}]: missing from Oracle output`);
      continue;
    }
    if (p === undefined) {
      mismatches.push(`${path}[${key}]: missing from production output`);
      continue;
    }
    for (const f of fieldPaths) {
      const gv = getField(g, f), ov = getField(o, f), pv = getField(p, f);
      if (gv === undefined) {
        mismatches.push(`${path}[${key}].${f}: golden does not specify this field`);
      } else if (!(gv === null && optionalGoldenFields.has(f))) {
        if (!deepEq(gv, ov)) {
          mismatches.push(`${path}[${key}].${f}: golden=${canonStr(gv)} oracle=${canonStr(ov)}`);
        }
        if (!deepEq(gv, pv)) {
          mismatches.push(`${path}[${key}].${f}: golden=${canonStr(gv)} production=${canonStr(pv)}`);
        }
      }
      if (!deepEq(ov, pv)) {
        mismatches.push(`${path}[${key}].${f}: oracle=${canonStr(ov)} production=${canonStr(pv)}`);
      }
    }
  }
}

function getField(record, fieldPath) {
  let cur = record;
  for (const part of fieldPath.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

function compareScalar(path, goldenVal, oracleVal, prodVal, mismatches,
                       opts = {}) {
  // FIX P1-02 (R1): a golden null/undefined is a mismatch unless
  // opts.allowNullGolden (the repoSnapshotSha256 digest only, which no
  // golden specifies -- same treatment as the Python-golden precedent).
  const { allowNullGolden = false } = opts;
  if (goldenVal === null || goldenVal === undefined) {
    if (!allowNullGolden) {
      mismatches.push(`${path}: golden does not specify this value`);
    }
  } else {
    if (!deepEq(goldenVal, oracleVal)) {
      mismatches.push(`${path}: golden=${canonStr(goldenVal)} oracle=${canonStr(oracleVal)}`);
    }
    if (!deepEq(goldenVal, prodVal)) {
      mismatches.push(`${path}: golden=${canonStr(goldenVal)} production=${canonStr(prodVal)}`);
    }
  }
  if (!deepEq(oracleVal, prodVal)) {
    mismatches.push(`${path}: oracle=${canonStr(oracleVal)} production=${canonStr(prodVal)}`);
  }
}

function compareGT(fx, goldenGT, oracleGT, prodGT, goldenMissing = []) {
  // FIX P1-02 (R1): goldenMissing (required golden fields absent from
  // golden.json, collected by canonicalizeGolden) fails the gate
  // outright -- a missing hand-written expectation can never be
  // papered over by Oracle-vs-production agreement.
  const mismatches = [...goldenMissing.map((m) => `golden: ${m}`)];
  const lang = fx.language;
  // Modules (moduleId/contentSha256 are digests: golden null means no
  // expectation, Oracle-vs-production only).
  const moduleFields = ["relativePath", "language", "nodeKind",
    "isGenerated", "isEntrypoint", "parseStatus", "moduleId",
    "contentSha256"];
  if (lang === "typescript") moduleFields.push("isDeclarationFile");
  if (lang === "go") moduleFields.push("packageName", "hasCgo");
  compareLists("modules", goldenGT.modules, oracleGT.modules,
    prodGT.modules, (m) => m.relativePath, moduleFields, mismatches,
    { optionalGoldenFields: new Set(["moduleId", "contentSha256"]) });
  // Module files (contentSha256 digest: golden null means no
  // expectation; python golden has files=null -> Oracle-vs-prod only).
  const allPaths = new Set([
    ...oracleGT.modules.map((m) => m.relativePath),
    ...prodGT.modules.map((m) => m.relativePath),
    ...goldenGT.modules.map((m) => m.relativePath),
  ]);
  for (const p of [...allPaths].sort()) {
    const g = goldenGT.modules.find((m) => m.relativePath === p);
    const o = oracleGT.modules.find((m) => m.relativePath === p);
    const pr = prodGT.modules.find((m) => m.relativePath === p);
    if (o && pr) {
      compareLists(`modules[${p}].files`,
        g?.files ?? null, o.files, pr.files,
        (f) => f.relativePath,
        ["relativePath", "contentSha256", "isGenerated", "isCgo"],
        mismatches,
        { allowNullGoldenList: true,
          optionalGoldenFields: new Set(["contentSha256"]) });
    }
  }
  // Edges (+ generated edges): every field is golden-compared now.
  const edgeFields = ["from", "to", "conditional", "typeOnly",
    "evidence.line", "evidence.statement", "evidence.specifier",
    "evidence.file", "kind"];
  compareLists("edges", goldenGT.edges, oracleGT.edges, prodGT.edges,
    (e) => `${e.from}\0${e.to}`, edgeFields, mismatches);
  if (goldenGT.generatedEdges === null) {
    // Python golden specifies no generated edges: oracle-vs-prod only.
    compareLists("generatedEdges", null, oracleGT.generatedEdges,
      prodGT.generatedEdges, (e) => `${e.from}\0${e.to}`, edgeFields,
      mismatches, { allowNullGoldenList: true });
  } else {
    compareLists("generatedEdges", goldenGT.generatedEdges,
      oracleGT.generatedEdges, prodGT.generatedEdges,
      (e) => `${e.from}\0${e.to}`, edgeFields, mismatches);
  }
  // Scalars / sets: all golden-compared now (no null fallback).
  compareScalar("entrypoints", goldenGT.entrypoints, oracleGT.entrypoints,
    prodGT.entrypoints, mismatches);
  compareScalar("reachableFromEntrypoints", goldenGT.reachableFromEntrypoints,
    oracleGT.reachableFromEntrypoints, prodGT.reachableFromEntrypoints,
    mismatches);
  compareScalar("isolatedModules", goldenGT.isolatedModules,
    oracleGT.isolatedModules, prodGT.isolatedModules, mismatches);
  compareScalar("externalImportCount", goldenGT.externalImportCount,
    oracleGT.externalImportCount, prodGT.externalImportCount, mismatches);
  compareScalar("externalImports", goldenGT.externalImports,
    oracleGT.externalImports, prodGT.externalImports, mismatches);
  // NOTE: the canonical unknown schema has no `statement` field
  // (Oracle header: unknownImports = {from, specifier, reason, line}),
  // so `statement` is not a compared field for unknowns.
  compareLists("unknownImports", goldenGT.unknownImports,
    oracleGT.unknownImports, prodGT.unknownImports,
    (u) => `${u.from}\0${u.specifier}\0${u.reason}`,
    ["from", "specifier", "reason", "line"], mismatches);
  compareScalar("dynamicUnknown", goldenGT.dynamicUnknown,
    oracleGT.dynamicUnknown, prodGT.dynamicUnknown, mismatches);
  compareLists("excludedFiles", goldenGT.excludedFiles,
    oracleGT.excludedFiles, prodGT.excludedFiles,
    (x) => x.relativePath, ["relativePath", "reason"], mismatches);
  if (lang === "python") {
    compareScalar("repoSnapshotSha256", null, oracleGT.repoSnapshotSha256,
      prodGT.repoSnapshotSha256, mismatches, { allowNullGolden: true });
  }
  return mismatches;
}

// ---------------------------------------------------------------------------
// Audit from a canonical ground truth (fresh Node implementation of the
// spec section 5 rules, mirroring the Oracle audit -- the gate requires
// the two audits to agree exactly).
// ---------------------------------------------------------------------------
// FIX T013 R4 (R4-P1-01): resolve declared entrypoints against the GT
// module set, mirroring production resolveEntrypoint
// (src/graph/build.ts) and the Oracle's _resolve_declared_entrypoints.
// A literal declaration resolves by exact python/typescript module-path
// match, else by its parent directory as a Go package dir (root files
// map to "."). Returns { resolved, unresolved }: resolved are the
// module paths (the production GT `entrypoints` list); unresolved are
// the literal toml spellings that resolve to no module (production's
// built.unresolvedEntrypoints, NFC-first sort like production).
function normalizeDeclaredPath(p) {
  return p.normalize("NFC").replace(/\\/g, "/").split("/")
    .filter((s) => s !== "" && s !== ".").join("/");
}
// FIX P024 R1 P1-01 follow-up: the claim-path normal form used by
// the hidden-path check below — the same collapse production's
// normalizeClaimPath applies ("" / "./" spellings read back as the
// repo root "."); every other path is unchanged.
function normalizeHiddenPath(p) {
  const n = String(p ?? "").replace(/\\/g, "/").split("/")
    .filter((s) => s !== "" && s !== ".").join("/");
  return n === "" ? "." : n;
}
function resolveDeclaredEntrypoints(literalPaths, modules) {
  const keys = new Set((modules ?? [])
    .map((m) => `${m.language ?? ""}\0${m.relativePath}`));
  const resolved = [];
  const unresolved = [];
  const seen = new Set();
  for (const raw of literalPaths ?? []) {
    const lit = normalizeDeclaredPath(raw);
    let target = null;
    if (keys.has(`python\0${lit}`) || keys.has(`typescript\0${lit}`)) {
      target = lit;
    } else {
      const parts = lit.split("/");
      parts.pop();
      const parent = parts.join("/") || ".";
      if (keys.has(`go\0${parent}`)) target = parent;
    }
    if (target === null) unresolved.push(lit);
    else if (!seen.has(target)) { seen.add(target); resolved.push(target); }
  }
  const nfcFirst = (a, b) => {
    const ka = [a.normalize("NFC"), a];
    const kb = [b.normalize("NFC"), b];
    return ka[0] < kb[0] ? -1 : ka[0] > kb[0] ? 1
      : ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0;
  };
  return { resolved: resolved.sort(), unresolved: unresolved.sort(nfcFirst) };
}

// Minimal reader for a fixture repo's .repomapverify.toml entrypoint
// declaration (single-line `paths = [...]` only -- production rejects
// multi-line arrays, P2-20, and every fixture uses one line). Returns
// the literal path spellings, or null when the file is absent or the
// line cannot be parsed (caller then falls back to the pre-R4
// behaviour of auditing from the resolved GT entrypoints alone).
function readDeclaredEntrypoints(repoDir) {
  try {
    const text = readFileSync(join(repoDir, ".repomapverify.toml"), "utf8");
    const m = text.match(/^\s*paths\s*=\s*\[([^\]]*)\]/m);
    if (!m) return null;
    const paths = [...m[1].matchAll(/"([^"]*)"|'([^']*)'/g)]
      .map((x) => x[1] ?? x[2]);
    return paths;
  } catch {
    return null;
  }
}

function auditFromGT(gt, claimed, declaredLiteralEntrypoints = null) {
  // FIX T013 R4 (R4-P1-01): mirror production Rule 9, as the Oracle
  // now does -- resolve the declared entrypoints against the GT
  // modules BEFORE the stale short-circuit. A declaration production
  // treats as unresolved (e.g. a toml path for a file that does not
  // exist) must NOT be reported as WRONG_ENTRYPOINT: the claimed
  // spelling IS the declaration, so it is accepted as written, and
  // the audit is INCOMPLETE with status only. This also closes the
  // entrypoint half of carried R2-P2-03 residual (a): the mirror now
  // accepts the literal toml spelling of a declared Go entrypoint
  // (e.g. "cmd/server/main.go"), exactly like production Rule 4 and
  // the Oracle. The snapshot half of residual (a) (camelCase-only
  // snapshot key) stays carried: no fixture uses a snake_case
  // snapshot, and the mirror only ever sees the 48 fixtures.
  // unresolvedEntrypoints is recorded (mirroring production's
  // built.unresolvedEntrypoints) ONLY when non-empty; the gate hash
  // does not cover auditFromGT output, but the Oracle keeps the same
  // omission rule for its own hash.
  const { unresolved } = resolveDeclaredEntrypoints(
    declaredLiteralEntrypoints ?? [], gt.modules ?? []);
  const unresolvedExtra = unresolved.length
    ? { unresolvedEntrypoints: unresolved } : {};
  // FIX P024 R1 P1-01 follow-up (unreadable .repomapverify.toml):
  // the entrypoint declaration is UNKNOWN, not absent. Recorded ONLY
  // when true, like unresolvedEntrypoints, so the gate hash is
  // unchanged on the 48 readable fixtures.
  const tomlExtra = gt.entrypointsDeclarationUnreadable
    ? { entrypointsDeclarationUnreadable: true } : {};
  // FIX T013 R3 (R3-P1-01): mirror production Rule 1 exactly, as the
  // Oracle now does -- resolve the snapshot FIRST; on STALE_SNAPSHOT
  // return INCOMPLETE with NO findings of any kind, before computing
  // any blame finding. (NOT_CHECKED -- gt snapshot null -- is not a
  // mismatch and does not short-circuit.) unknownImportsPresent is
  // still computed from ground truth: a fact about the tree, not a
  // blame finding on the map.
  const snapshotStatus = gt.repoSnapshotSha256 === null ? "NOT_CHECKED"
    : claimed.repoSnapshotSha256 === gt.repoSnapshotSha256
      ? "MATCH" : "STALE_SNAPSHOT";
  const unknownPresent = (gt.unknownImports ?? [])
    .some((u) => u.reason !== "DYNAMIC_IMPORT_UNKNOWN");
  if (snapshotStatus === "STALE_SNAPSHOT") {
    return { status: "INCOMPLETE", snapshotStatus, findings: [],
             unknownImportsPresent: unknownPresent, ...unresolvedExtra,
             ...tomlExtra };
  }
  const realModules = new Set(gt.modules.map((m) => m.relativePath));
  const realEdges = new Set(gt.edges.map((e) => `${e.from}\0${e.to}`));
  // FIX P024 R1 P1-01 follow-up (mirror of production compare.ts
  // Rules 2/3 and the Oracle's _is_hidden): paths hidden behind an
  // unreadable file or directory are UNKNOWN, not hallucinated. A
  // claimed path equal to, under, or a parent directory of an
  // unreadable path (gt unknownImports with reason UNREADABLE) may
  // well exist; the auditor simply cannot see it. No
  // HALLUCINATED_MODULE / HALLUCINATED_EDGE for it — the claim stays
  // unverified and the audit is INCOMPLETE anyway via unknownPresent
  // / the non-OK parse status below. The repo root (".") hides
  // everything. All 48 current S0 fixtures are fully readable, so
  // hiddenPrefixes is empty there and this changes nothing.
  const hiddenPrefixes = (gt.unknownImports ?? [])
    .filter((u) => u.reason === "UNREADABLE")
    .map((u) => normalizeHiddenPath(u.from));
  const isHidden = (p) => {
    const n = normalizeHiddenPath(p);
    return hiddenPrefixes.some(
      (h) =>
        h === "." ||
        n === h ||
        n.startsWith(`${h}/`) ||
        h.startsWith(`${n}/`),
    );
  };
  const reachable = new Set(gt.reachableFromEntrypoints ?? []);
  const declared = gt.entrypoints;
  const completeness = claimed.completeness ?? "FULL_GRAPH";
  const claimedModules = (claimed.modules ?? []).map((m) => m.path);
  const claimedEdges = (claimed.edges ?? []).map((e) => [e.from, e.to]);
  const claimedEntries = claimed.entrypoints ?? [];
  const findings = [];
  for (const path of claimedModules) {
    if (!realModules.has(path) && !isHidden(path)) {
      findings.push({ id: "HALLUCINATED_MODULE", from: path });
    }
  }
  for (const [frm, to] of claimedEdges) {
    if (!realEdges.has(`${frm}\0${to}`) && !isHidden(frm) && !isHidden(to)) {
      findings.push({ id: "HALLUCINATED_EDGE", from: frm, to });
    }
  }
  // FIX T013 R4 (R4-P1-01): a claimed entrypoint is accepted when it
  // is a resolved GT entrypoint OR a literal toml spelling -- including
  // an UNRESOLVED literal (e.g. "ghost.py"): production accepts the
  // declaration as written (compare.ts Rule 4) and reports the
  // declaration itself as unresolved (Rule 9), never as
  // WRONG_ENTRYPOINT. A declaration exists whenever the toml declares
  // anything, even if every declaration is unresolved (resolved list
  // empty but literals non-empty). Without literals the check is the
  // old resolved-only one.
  const literals = (declaredLiteralEntrypoints ?? [])
    .map(normalizeDeclaredPath);
  const acceptedEntrypoints = new Set([...declared, ...literals]);
  if (declared.length || literals.length) {
    for (const entry of claimedEntries) {
      if (!acceptedEntrypoints.has(entry)) {
        findings.push({ id: "WRONG_ENTRYPOINT", from: entry });
      }
    }
  }
  const missing = [];
  if (completeness === "FULL_GRAPH") {
    const claimedEdgeSet = new Set(claimedEdges.map(([f, t]) => `${f}\0${t}`));
    for (const key of [...realEdges].sort()) {
      if (!claimedEdgeSet.has(key)) {
        const [frm, to] = key.split("\0");
        const rec = { id: "MISSING_EDGE", from: frm, to };
        findings.push(rec);
        missing.push(rec);
      }
    }
    const claimedModuleSet = new Set(claimedModules);
    for (const path of [...reachable].sort()) {
      if (!claimedModuleSet.has(path)) {
        findings.push({ id: "UNCLAIMED_REACHABLE_MODULE", from: path });
      }
    }
  }
  const hallucinated = findings.filter((f) => f.id === "HALLUCINATED_EDGE");
  for (const h of hallucinated) {
    if (!realModules.has(h.to)) continue; // target must be a real module
    const hBase = h.to.split("/").pop();
    for (const m of missing) {
      if (m.from === h.from && m.to.split("/").pop() === hBase) {
        findings.push({ id: "NAME_COLLISION_CONFUSION", from: h.from, to: h.to });
        break;
      }
    }
  }
  for (const dyn of gt.dynamicUnknown ?? []) {
    findings.push({ id: "DYNAMIC_IMPORT_UNKNOWN", from: dyn.path });
  }
  for (const unk of gt.unknownImports ?? []) {
    if (unk.reason === "DYNAMIC_IMPORT_UNKNOWN") {
      findings.push({ id: "DYNAMIC_IMPORT_UNKNOWN", from: unk.from });
    }
  }
  findings.sort((a, b) => a.id.localeCompare(b.id) ||
    (a.from ?? "").localeCompare(b.from ?? "") ||
    (a.to ?? "").localeCompare(b.to ?? ""));
  // snapshotStatus / unknownPresent were resolved at the top of this
  // function (FIX T013 R3, R3-P1-01); reaching here means MATCH or
  // NOT_CHECKED, so the snapshot can no longer force INCOMPLETE.
  let status;
  if (findings.some((f) => FAIL_FINDING_IDS.has(f.id))) status = "FAIL";
  else if (findings.some((f) => f.id === "DYNAMIC_IMPORT_UNKNOWN") ||
    unknownPresent ||
    unresolved.length > 0 ||
    gt.entrypointsDeclarationUnreadable ||
    gt.modules.some((m) => m.parseStatus !== "OK")) status = "INCOMPLETE";
  else status = "PASS";
  // FIX P024 R1 P1-01 follow-up (unreadable .repomapverify.toml):
  // the entrypoint declaration is UNKNOWN, not absent — the audit
  // cannot verify entrypoints, so it is INCOMPLETE (mirror of
  // production compare.ts Rule 7 and the Oracle's audit).
  return { status, snapshotStatus, findings,
           unknownImportsPresent: unknownPresent, ...unresolvedExtra,
           ...tomlExtra };
}

function findingsKey(f) {
  return `${f.id}\0${f.from ?? ""}\0${f.to ?? ""}`;
}
function findingsEqual(a, b) {
  const ka = a.map(findingsKey).sort();
  const kb = b.map(findingsKey).sort();
  return canonStr(ka) === canonStr(kb);
}
function findingsClassSet(findings) {
  return [...new Set(findings.map((f) => f.id))].sort();
}


// ---------------------------------------------------------------------------
// Main driver
// ---------------------------------------------------------------------------
function runCmd(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "",
           stderr: res.stderr ?? "", error: res.error ?? null };
}

function main() {
  const argv = process.argv.slice(2);
  let replays = 100;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--replays") replays = Number(argv[++i]);
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  log(`P024 S0 GATE -- seed ${SEED}`);
  log(`started (UTC): ${startedAt}`);
  log(`replays: ${replays}`);
  log("");

  const fixtures = listFixtures();
  log(`fixtures: ${fixtures.length} (python ${fixtures.filter((f) => f.language === "python").length}, ` +
    `typescript ${fixtures.filter((f) => f.language === "typescript").length}, ` +
    `go ${fixtures.filter((f) => f.language === "go").length})`);

  // 1. Hash fixture trees + goldens BEFORE.
  const beforeTrees = {};
  const beforeGoldens = {};
  for (const fx of fixtures) {
    const dir = join(FIXTURES_ROOT, fx.langDir, fx.name);
    beforeTrees[fx.name] = hashTree(join(dir, "repo")).combined;
    beforeGoldens[fx.name] = sha256Hex(readFileSync(join(dir, "golden.json"), "utf8"));
  }
  log("fixture repo trees hashed (before): 48/48");

  // 2. Clean build.
  log("== clean build ==");
  rmSync(join(SRC_DIR, "dist"), { recursive: true, force: true });
  const build = runCmd("npm", ["run", "build"], { cwd: SRC_DIR });
  log(build.stdout.trim());
  if (build.stderr.trim()) log(`build stderr: ${build.stderr.trim()}`);
  log(`build exit: ${build.status}`);
  if (build.status !== 0) {
    log("S0 = FAIL (clean build failed)");
    return finish(1, null);
  }

  // 3. No-external-request proof (grep over src + scripts) + Oracle stdlib audit.
  // The pattern is assembled from fragments so that this very file does
  // not self-match the grep (the literal tokens must not appear here).
  const NET_PATTERN = [
    "http" + "s?://",
    "\\b" + "fet" + "ch" + "\\s*\\(",
    "Web" + "Socket",
    "node:" + "http", "node:" + "https", "node:" + "net", "node:" + "dns",
    "XMLHttp" + "Request",
    "ax" + "ios", "node-" + "fetch", "und" + "ici",
  ].join("|");
  log("== external-request proof (grep) ==");
  const grepRes = runCmd("grep", ["-rn", "-E", NET_PATTERN, "src", "scripts"],
    { cwd: SRC_DIR });
  // grep exit 1 = no matches (the required outcome); 0 = matches found.
  log(`command: grep -rn -E ${JSON.stringify(NET_PATTERN)} src scripts`);
  log(`grep exit code: ${grepRes.status} (1 = no matches)`);
  if (grepRes.stdout.trim()) log(`grep matches:\n${grepRes.stdout.trim()}`);
  else log("grep matches: (none)");
  const externalRequests = grepRes.status === 0
    ? grepRes.stdout.trim().split("\n").filter(Boolean).length : 0;
  // Oracle stdlib-only audit.
  const oracleSrc = readFileSync(ORACLE_PY, "utf8");
  const oracleImports = [...oracleSrc.matchAll(/^(?:import|from)\s+([A-Za-z0-9_]+)/gm)]
    .map((m) => m[1]);
  const STDLIB = new Set(["argparse", "ast", "hashlib", "json", "os", "re",
    "sys", "unicodedata"]);
  const nonStdlib = oracleImports.filter((m) => !STDLIB.has(m));
  log(`oracle imports: ${[...new Set(oracleImports)].sort().join(", ")}`);
  log(`oracle non-stdlib imports: ${nonStdlib.length ? nonStdlib.join(", ") : "(none)"}`);

  // 4. Oracle run + replay.
  log("== independent Oracle ==");
  const oracleOut = join(TMP_DIR, "oracle.json");
  const oracleRun = runCmd("python3", [ORACLE_PY, "--fixtures-root",
    FIXTURES_ROOT, "--out", oracleOut],
    { cwd: PROJECT_ROOT, env: { ...process.env, TMPDIR: join(PROJECT_ROOT, ".tmp") } });
  log(`oracle exit: ${oracleRun.status}`);
  if (oracleRun.status !== 0) {
    log(`oracle stderr: ${oracleRun.stderr}`);
    log("S0 = FAIL (Oracle run failed)");
    return finish(1, null);
  }
  const oracleResults = JSON.parse(readFileSync(oracleOut, "utf8")).fixtures;
  const oracleMainHash = sha256Hex(canonStr(oracleResults));
  log(`oracle fixtures: ${oracleResults.length}, main hash: ${oracleMainHash}`);
  const oracleReplayOut = join(TMP_DIR, "oracle-replay.json");
  const oracleReplay = runCmd("python3", [ORACLE_PY, "--fixtures-root",
    FIXTURES_ROOT, "--replay", String(replays), "--out", oracleReplayOut],
    { cwd: PROJECT_ROOT, env: { ...process.env, TMPDIR: join(PROJECT_ROOT, ".tmp") } });
  log(`oracle replay exit: ${oracleReplay.status}`);
  const oracleReplayData = JSON.parse(readFileSync(oracleReplayOut, "utf8"));
  log(`oracle replay: ${oracleReplayData.replayCount} runs, distinct hashes: ${oracleReplayData.distinct}`);

  // 5. Production run + replay.
  log("== production extractors ==");
  const prodOut = join(TMP_DIR, "production.json");
  const prodRun = runCmd("node", [PROD_PROBE, "--fixtures-root",
    FIXTURES_ROOT, "--out", prodOut], { cwd: SRC_DIR });
  log(`prod-probe exit: ${prodRun.status}`);
  if (prodRun.status !== 0) {
    log(`prod-probe stderr: ${prodRun.stderr}`);
    log("S0 = FAIL (production probe failed)");
    return finish(1, null);
  }
  const prodResults = JSON.parse(readFileSync(prodOut, "utf8")).fixtures;
  const prodMainHash = sha256Hex(canonStr(prodResults));
  log(`production fixtures: ${prodResults.length}, main hash: ${prodMainHash}`);
  const prodReplayOut = join(TMP_DIR, "production-replay.json");
  const prodReplay = runCmd("node", [PROD_PROBE, "--fixtures-root",
    FIXTURES_ROOT, "--replay", String(replays), "--out", prodReplayOut],
    { cwd: SRC_DIR });
  log(`prod-probe replay exit: ${prodReplay.status}`);
  const prodReplayData = JSON.parse(readFileSync(prodReplayOut, "utf8"));
  log(`production replay: ${prodReplayData.replayCount} runs, distinct hashes: ${prodReplayData.distinct}`);

  // 6-7. Three-way parity + audits.
  log("== three-way parity + audits ==");
  const oracleByName = new Map(oracleResults.map((r) => [r.fixture, r]));
  const prodByName = new Map(prodResults.map((r) => [r.fixture, r]));
  const perFixture = [];
  const parityProof = [];
  let parityPass = 0, plantedDetected = 0, controlFalseAlarms = 0;
  let plantedTotal = 0, controlTotal = 0;
  for (const fx of fixtures) {
    const golden = loadGolden(fx);
    const claimed = loadClaimed(fx);
    const { gt: goldenGT, missing: goldenMissing } =
      canonicalizeGolden(fx, golden);
    const oracle = oracleByName.get(fx.name);
    const prod = prodByName.get(fx.name);
    const mismatches = compareGT(fx, goldenGT, oracle.groundTruth,
      prod.groundTruth, goldenMissing);
    // Audits: Oracle audit (from Oracle GT) + production audit (Node,
    // from production GT) vs golden expectedStatus/expectedFindings.
    // FIX T013 R4 (R4-P1-01): hand the mirror the fixture repo's
    // literal toml declarations so it can tell an unresolvable
    // declaration (INCOMPLETE, no finding) from an undeclared claimed
    // entrypoint (WRONG_ENTRYPOINT); null when the repo has no toml
    // or the line is unparseable (pre-R4 behaviour).
    const declaredLiterals = readDeclaredEntrypoints(
      join(FIXTURES_ROOT, fx.langDir, fx.name, "repo"));
    const prodAudit = auditFromGT(prod.groundTruth, claimed,
      declaredLiterals);
    const oracleAudit = oracle.audit;
    const auditMismatches = [];
    if (oracleAudit.status !== golden.expectedStatus) {
      auditMismatches.push(`oracle audit status: ${oracleAudit.status} != golden ${golden.expectedStatus}`);
    }
    if (prodAudit.status !== golden.expectedStatus) {
      auditMismatches.push(`production audit status: ${prodAudit.status} != golden ${golden.expectedStatus}`);
    }
    if (oracleAudit.snapshotStatus !== "MATCH") {
      auditMismatches.push(`oracle snapshotStatus: ${oracleAudit.snapshotStatus} (claimed map snapshot mismatch)`);
    }
    if (fx.language === "python") {
      if (!findingsEqual(oracleAudit.findings, golden.expectedFindings)) {
        auditMismatches.push(`oracle findings != golden: oracle=${canonStr(oracleAudit.findings)} golden=${canonStr(golden.expectedFindings)}`);
      }
      if (!findingsEqual(prodAudit.findings, golden.expectedFindings)) {
        auditMismatches.push(`production findings != golden: production=${canonStr(prodAudit.findings)} golden=${canonStr(golden.expectedFindings)}`);
      }
    } else {
      const expClasses = [...new Set(golden.expectedFindings)].sort();
      if (canonStr(findingsClassSet(oracleAudit.findings)) !== canonStr(expClasses)) {
        auditMismatches.push(`oracle finding classes != golden: oracle=${canonStr(findingsClassSet(oracleAudit.findings))} golden=${canonStr(expClasses)}`);
      }
      if (canonStr(findingsClassSet(prodAudit.findings)) !== canonStr(expClasses)) {
        auditMismatches.push(`production finding classes != golden: production=${canonStr(findingsClassSet(prodAudit.findings))} golden=${canonStr(expClasses)}`);
      }
    }
    if (!findingsEqual(oracleAudit.findings, prodAudit.findings) ||
        oracleAudit.status !== prodAudit.status) {
      auditMismatches.push(`oracle audit != production audit: oracle=${canonStr(oracleAudit)} production=${canonStr(prodAudit)}`);
    }
    const allMismatches = [...mismatches, ...auditMismatches];
    const parityOk = allMismatches.length === 0;
    if (parityOk) parityPass++;
    const kind = golden.kind;
    let plantedOk = null, controlOk = null;
    if (kind === "planted") {
      plantedTotal++;
      const expClasses = [...new Set(
        fx.language === "python"
          ? golden.expectedFindings.map((f) => f.id)
          : golden.expectedFindings)].sort();
      plantedOk = oracleAudit.status === "FAIL" && prodAudit.status === "FAIL" &&
        expClasses.every((c) => findingsClassSet(oracleAudit.findings).includes(c)) &&
        expClasses.every((c) => findingsClassSet(prodAudit.findings).includes(c));
      if (plantedOk) plantedDetected++;
    } else {
      controlTotal++;
      controlOk = oracleAudit.status === "PASS" && prodAudit.status === "PASS" &&
        oracleAudit.findings.length === 0 && prodAudit.findings.length === 0;
      if (!controlOk) controlFalseAlarms++;
    }
    perFixture.push({
      fixture: fx.name, language: fx.language, kind,
      plantedClass: golden.plantedClass ?? null,
      expectedStatus: golden.expectedStatus,
      oracleAuditStatus: oracleAudit.status,
      productionAuditStatus: prodAudit.status,
      oracleFindings: oracleAudit.findings,
      productionFindings: prodAudit.findings,
      expectedFindings: golden.expectedFindings,
      snapshotStatus: oracleAudit.snapshotStatus,
      parity: parityOk ? "PASS" : "FAIL",
      mismatches: allMismatches,
      plantedDetected: plantedOk, controlClean: controlOk,
    });
    parityProof.push({
      fixture: fx.name, language: fx.language, kind,
      parity: parityOk ? "PASS" : "FAIL",
      mismatchCount: allMismatches.length, mismatches: allMismatches,
    });
    log(`${fx.name}: parity=${parityOk ? "PASS" : "FAIL"} ` +
      `oracle=${oracleAudit.status} production=${prodAudit.status} ` +
      `expected=${golden.expectedStatus} mismatches=${allMismatches.length}`);
  }

  // 8. Hash fixture trees + goldens AFTER.
  const afterTrees = {};
  const afterGoldens = {};
  let sourceWrites = 0;
  let goldenChanged = 0;
  for (const fx of fixtures) {
    const dir = join(FIXTURES_ROOT, fx.langDir, fx.name);
    afterTrees[fx.name] = hashTree(join(dir, "repo")).combined;
    afterGoldens[fx.name] = sha256Hex(readFileSync(join(dir, "golden.json"), "utf8"));
    if (afterTrees[fx.name] !== beforeTrees[fx.name]) sourceWrites++;
    if (afterGoldens[fx.name] !== beforeGoldens[fx.name]) goldenChanged++;
  }
  log(`source-dir writes (changed fixture trees): ${sourceWrites}`);
  log(`golden.json files changed: ${goldenChanged}`);

  // 9. Gate hash (normalized semantic results only).
  const goldenCanonical = fixtures.map((fx) => ({
    fixture: fx.name,
    groundTruth: canonicalizeGolden(fx, loadGolden(fx)).gt,
    expectedStatus: loadGolden(fx).expectedStatus,
    expectedFindings: loadGolden(fx).expectedFindings,
  }));
  const goldenHash = sha256Hex(canonStr(goldenCanonical));
  const gateHash = sha256Hex(`${oracleMainHash}\n${prodMainHash}\n${goldenHash}\n`);
  const replayOracleOk = oracleReplayData.distinct === 1 &&
    oracleReplayData.hash === oracleMainHash;
  const replayProdOk = prodReplayData.distinct === 1 &&
    prodReplayData.hash === prodMainHash;
  const replayOk = replayOracleOk && replayProdOk;
  log(`golden hash: ${goldenHash}`);
  log(`gate hash: ${gateHash}`);
  log(`replay oracle: distinct=${oracleReplayData.distinct} matches-main=${oracleReplayData.hash === oracleMainHash}`);
  log(`replay production: distinct=${prodReplayData.distinct} matches-main=${prodReplayData.hash === prodMainHash}`);

  // Thresholds.
  const thresholds = {
    parity: { required: "48/48", actual: `${parityPass}/48`, pass: parityPass === 48 },
    plantedDetected: { required: "24/24", actual: `${plantedDetected}/24`, pass: plantedDetected === 24 },
    controlFalseAlarms: { required: "0/24", actual: `${controlFalseAlarms}/24`, pass: controlFalseAlarms === 0 },
    replayHashes: { required: "1 distinct gate hash over 100 replays", actual: `${replayOk ? 1 : "?"} distinct`, pass: replayOk },
    externalRequests: { required: "0", actual: String(externalRequests), pass: externalRequests === 0 && nonStdlib.length === 0 },
    sourceWrites: { required: "0", actual: String(sourceWrites), pass: sourceWrites === 0 },
    goldenIntegrity: { required: "0 changed", actual: String(goldenChanged), pass: goldenChanged === 0 },
  };
  const verdict = Object.values(thresholds).every((t) => t.pass)
    ? "PASS" : "FAIL";
  log("");
  log(`THRESHOLDS: parity ${thresholds.parity.actual} (need 48/48); ` +
    `planted ${thresholds.plantedDetected.actual} (need 24/24); ` +
    `control false alarms ${thresholds.controlFalseAlarms.actual} (need 0/24); ` +
    `replay distinct=${replayOk ? 1 : "FAIL"}; external=${externalRequests}; ` +
    `source writes=${sourceWrites}; goldens changed=${goldenChanged}`);
  log(`S0 GATE VERDICT: ${verdict}`);

  const gateDoc = {
    schema: "repomapverify.s0-gate/v1",
    seed: SEED,
    verdict,
    inputCommit: gitHeadCommit(),
    generatedAtUtc: new Date().toISOString(),
    gateHash,
    thresholds,
    counts: {
      fixtures: fixtures.length, parityPass, plantedDetected,
      plantedTotal, controlFalseAlarms, controlTotal,
      oracleReplayDistinct: oracleReplayData.distinct,
      productionReplayDistinct: prodReplayData.distinct,
      externalRequests, sourceWrites, goldenChanged,
    },
    externalRequestProof: {
      command: `grep -rn -E ${JSON.stringify(NET_PATTERN)} src scripts`,
      cwd: "02_source",
      exitCode: grepRes.status,
      matches: grepRes.status === 0
        ? grepRes.stdout.trim().split("\n").filter(Boolean) : [],
      oracleNonStdlibImports: nonStdlib,
    },
    sourceWriteProof: {
      fixtureTreesBefore: beforeTrees,
      fixtureTreesAfter: afterTrees,
      goldenBefore: beforeGoldens,
      goldenAfter: afterGoldens,
    },
    replayHashes: {
      oracleMainHash, productionMainHash: prodMainHash, goldenHash,
      oracleReplayDistinct: oracleReplayData.distinct,
      productionReplayDistinct: prodReplayData.distinct,
      oracleReplayMatchesMain: oracleReplayData.hash === oracleMainHash,
      productionReplayMatchesMain: prodReplayData.hash === prodMainHash,
    },
    perFixture,
  };
  const parityDoc = {
    schema: "repomapverify.oracle-parity/v1",
    seed: SEED,
    gateHash,
    parity: `${parityPass}/48`,
    perFixture: parityProof,
  };
  const repeatDoc = {
    schema: "repomapverify.repeat-hash/v1",
    seed: SEED,
    gateHash,
    replayCount: replays,
    oracle: {
      distinct: oracleReplayData.distinct,
      hashes: oracleReplayData.replays,
      mainHash: oracleMainHash,
      matchesMain: oracleReplayData.hash === oracleMainHash,
    },
    production: {
      distinct: prodReplayData.distinct,
      hashes: prodReplayData.replays,
      mainHash: prodMainHash,
      matchesMain: prodReplayData.hash === prodMainHash,
    },
    combinedDistinctGateHashes: replayOk ? 1 : null,
  };
  writeFileSync(join(EVIDENCE_DIR, "S0_GATE.json"),
    JSON.stringify(gateDoc, null, 2) + "\n");
  writeFileSync(join(EVIDENCE_DIR, "ORACLE_PARITY.json"),
    JSON.stringify(parityDoc, null, 2) + "\n");
  writeFileSync(join(EVIDENCE_DIR, "REPEAT_HASH.json"),
    JSON.stringify(repeatDoc, null, 2) + "\n");
  log(`evidence written: ${EVIDENCE_DIR}/S0_GATE.json, ORACLE_PARITY.json, REPEAT_HASH.json`);
  return finish(verdict === "PASS" ? 0 : 1, verdict);
}

function finish(code, verdict) {
  writeFileSync(join(EVIDENCE_DIR, "S0_GATE.log"), logLines.join("\n") + "\n");
  if (verdict) console.log(`S0 GATE VERDICT: ${verdict} (exit ${code})`);
  process.exit(code);
}

main();
