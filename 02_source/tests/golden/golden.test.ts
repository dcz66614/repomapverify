/**
 * T011 golden regression (PROJECT_BOOK §10.2; PLAN T011 §5, §7.1).
 *
 * The full regression entry point for the hand-written expectations:
 *   - 48 S0 fixtures (tests/fixtures/s0 per-language golden.json): production
 *     output compared field-by-field at THREE levels — extractor,
 *     ground-truth graph (canonical form), and audit (status +
 *     finding sets + snapshot + coverage). module_id /
 *     content_sha256 / snapshot hashes are recomputed IN THIS FILE
 *     from file bytes with node:crypto (tests/golden/helpers.ts),
 *     never taken from production output.
 *   - 20 boundary audit checks (19 fixtures under
 *     tests/fixtures/boundary/, one with a second claimed map):
 *     extractor + graph + audit vs hand-written expected.json.
 *   - 1 demo repo run (02_source/demo): graph + audit vs the
 *     hand-written tests/golden/demo.expected.json.
 *
 * Expectations are NEVER regenerated from production output: every
 * expected value comes from golden.json / expected.json /
 * demo.expected.json, or from an independent test-side computation
 * (BFS over GOLDEN edges, hash recomputation from file bytes).
 * Any mismatch fails loudly: the test collects per-field problem
 * strings and asserts the list is empty, so vitest prints the
 * field-level diff. This suite does NOT use the Oracle or the S0
 * gate runner — it exercises the production extractors, graph
 * builder and comparator directly.
 *
 * Results are written to 03_evidence/T011/GOLDEN_REGRESSION.json.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { extractPythonRepo } from "../../src/extractors/python/index.js";
import { extractTypeScriptRepo } from "../../src/extractors/typescript/index.js";
import { extractGoRepo } from "../../src/extractors/go/index.js";
import { buildGroundTruthGraphFromRepo } from "../../src/graph/fromRepo.js";
import { canonicalizeGraph } from "../../src/canonical/index.js";
import { parseEntrypointsTomlOptional } from "../../src/contracts/entrypoints.js";
import { compareMapsDetailed } from "../../src/comparator/compare.js";
import type { ComparatorEvidence } from "../../src/comparator/types.js";
import type { ClaimedMapV1 } from "../../src/contracts/claimed-map.js";
import {
  canon,
  expectedModuleId,
  expectedSnapshotSha256,
  findingKey,
  listS0Fixtures,
  loadClaimed,
  sha256File,
  sortStr,
  sortedJson,
  type GoldenFinding,
} from "./helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", "..");
const REPO_ROOT = join(SRC_ROOT, "..");
const S0_ROOT = join(HERE, "..", "fixtures", "s0");
const BOUNDARY_ROOT = join(HERE, "..", "fixtures", "boundary");
const EVIDENCE_DIR = join(REPO_ROOT, "03_evidence", "T011");

const SNAPSHOT_SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", "venv"]);

interface LevelResult {
  fixture: string;
  language: string;
  kind: string;
  extractorMatch: boolean;
  graphMatch: boolean;
  auditMatch: boolean;
  match: boolean;
  problems: string[];
}

const results: LevelResult[] = [];

function pushResult(r: LevelResult): void {
  results.push(r);
}

/** Recursively list every file under a repo dir (test-side walk). */
function walkFiles(repoDir: string): string[] {
  const out: string[] = [];
  const walk = (dirAbs: string, dirRel: string): void => {
    for (const entry of readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const rel = dirRel === "" ? entry.name : `${dirRel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SNAPSHOT_SKIP_DIRS.has(entry.name)) continue;
        walk(join(dirAbs, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(repoDir, "");
  return out.sort();
}

/** Independent snapshot hash of a repo tree, from file bytes. */
function snapshotOfTree(repoDir: string): string {
  return expectedSnapshotSha256(
    walkFiles(repoDir).map((p) => ({ relativePath: p, contentSha256: sha256File(join(repoDir, p)) })),
  );
}

function tomlEntrypoints(repoDir: string): string[] {
  const tomlPath = join(repoDir, ".repomapverify.toml");
  if (!existsSync(tomlPath)) return [];
  return parseEntrypointsTomlOptional(readFileSync(tomlPath, "utf8")).paths;
}

/** Test-side BFS over GOLDEN edges from expected entrypoint modules. */
function bfsReachable(
  edges: [string, string][],
  entryModules: string[],
  allModules: string[] = [],
): { reachable: string[]; isolated: string[] } {
  const adj = new Map<string, string[]>();
  const nodes = new Set<string>(allModules);
  for (const [from, to] of edges) {
    nodes.add(from);
    nodes.add(to);
    const list = adj.get(from) ?? [];
    list.push(to);
    adj.set(from, list);
  }
  const seen = new Set<string>();
  const queue = [...entryModules];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nxt of adj.get(cur) ?? []) if (!seen.has(nxt)) queue.push(nxt);
  }
  return {
    reachable: [...seen].sort(sortStr),
    isolated: [...nodes].filter((n) => !seen.has(n)).sort(sortStr),
  };
}

/** A toml file path maps to a graph module path (Go: package dir). */
function entryModulePaths(language: string, tomlPaths: string[]): string[] {
  if (language === "go") {
    return tomlPaths.map((p) => {
      const dir = posix.dirname(p);
      return dir === "." ? "." : dir;
    });
  }
  return [...tomlPaths];
}

/** Evidence assembled from an already-obtained extractor result. */
function evidenceFromExtraction(language: string, r: unknown): ComparatorEvidence {
  if (language === "python") {
    const x = r as Awaited<ReturnType<typeof extractPythonRepo>>;
    return {
      dynamicUnknowns: x.dynamicUnknown.map((d) => ({
        path: d.path,
        line: d.line,
        statement: d.statement,
        kind: d.kind,
      })),
      unknownImports: x.unknownImports.map((u) => ({
        from: u.from,
        specifier: u.specifier,
        reason: u.reason,
        line: u.line,
        statement: u.statement,
      })),
      generatedEdges: x.generatedExcludedEdges.map((e) => ({ from: e.from, to: e.to })),
    };
  }
  if (language === "typescript") {
    const x = r as Awaited<ReturnType<typeof extractTypeScriptRepo>>;
    return {
      unknownImports: x.unknowns.map((u) => ({
        from: u.from,
        specifier: u.specifier,
        reason: u.reason,
        ...(u.line !== undefined ? { line: u.line } : {}),
      })),
      generatedEdges: x.generatedEdges.map((e) => ({ from: e.from, to: e.to })),
    };
  }
  const x = r as Awaited<ReturnType<typeof extractGoRepo>>;
  return {
    unknownImports: x.unknowns.map((u) => ({
      from: u.from,
      specifier: u.importPath,
      reason: u.reason,
      line: u.line,
    })),
    generatedEdges: x.generatedEdges.map((e) => ({ from: e.from, to: e.to })),
  };
}

/** Coverage numbers re-derived from the claimed map + T006 rule. */
function expectedCoverage(claimed: ClaimedMapV1, findingIds: string[]): { total: number; verified: number } {
  const modules = new Set(claimed.modules.map((m) => m.path));
  const edges = new Set(claimed.edges.map((e) => `${e.from}\0${e.to}`));
  const entrypoints = new Set(claimed.entrypoints);
  const total = modules.size + edges.size + entrypoints.size;
  const unverified = findingIds.filter((id) =>
    ["HALLUCINATED_MODULE", "HALLUCINATED_EDGE", "GENERATED_MISMATCH", "WRONG_ENTRYPOINT"].includes(id),
  ).length;
  return { total, verified: total - unverified };
}

function checkAuditCommon(
  problems: string[],
  where: string,
  report: { status: string; snapshotStatus: string; findings: GoldenFinding[]; coverage: { verifiedClaims: number; totalClaims: number }; groundTruth: { modules: number; edges: number }; claimed: { modules: number; edges: number } },
  claimed: ClaimedMapV1,
  expectedStatus: string,
  expectedFindings: GoldenFinding[] | string[],
  language: string,
  gtModuleCount: number,
  gtEdgeCount: number,
  exactFindings = language === "python",
): void {
  if (report.status !== expectedStatus) {
    problems.push(`${where} audit status: got ${report.status}, want ${expectedStatus}`);
  }
  if (report.snapshotStatus !== "MATCH") {
    problems.push(`${where} audit snapshotStatus: got ${report.snapshotStatus}, want MATCH`);
  }
  if (exactFindings) {
    // Boundary expected.json findings carry full (id, from, to): exact set equality.
    const want = (expectedFindings as GoldenFinding[]).map(findingKey).sort();
    const got = report.findings.map(findingKey).sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`${where} audit findings: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  } else {
    const want = [...new Set(expectedFindings as string[])].sort();
    const got = [...new Set(report.findings.map((f) => f.id))].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`${where} audit finding classes: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  }
  const cov = expectedCoverage(claimed, report.findings.map((f) => f.id));
  if (report.coverage.totalClaims !== cov.total) {
    problems.push(`${where} audit coverage.totalClaims: got ${report.coverage.totalClaims}, want ${cov.total}`);
  }
  if (report.coverage.verifiedClaims !== cov.verified) {
    problems.push(`${where} audit coverage.verifiedClaims: got ${report.coverage.verifiedClaims}, want ${cov.verified}`);
  }
  if (report.groundTruth.modules !== gtModuleCount || report.groundTruth.edges !== gtEdgeCount) {
    problems.push(
      `${where} audit groundTruth counts: got ${report.groundTruth.modules}/${report.groundTruth.edges}, want ${gtModuleCount}/${gtEdgeCount}`,
    );
  }
  const claimedModules = new Set(claimed.modules.map((m) => m.path)).size;
  const claimedEdges = new Set(claimed.edges.map((e) => `${e.from}\0${e.to}`)).size;
  if (report.claimed.modules !== claimedModules || report.claimed.edges !== claimedEdges) {
    problems.push(
      `${where} audit claimed counts: got ${report.claimed.modules}/${report.claimed.edges}, want ${claimedModules}/${claimedEdges}`,
    );
  }
}

async function checkS0Fixture(langDir: string, language: string, name: string): Promise<void> {
  const dir = join(S0_ROOT, langDir, name);
  const repoDir = join(dir, "repo");
  const golden = JSON.parse(readFileSync(join(dir, "golden.json"), "utf8"));
  const problems: string[] = [];
  const extractorProblems: string[] = [];
  const graphProblems: string[] = [];
  const auditProblems: string[] = [];
  const fail = (bucket: string[], msg: string): void => {
    bucket.push(msg);
    problems.push(msg);
  };

  // ---- Extractor level + graph level share one extraction run. ----
  let extraction: unknown;
  if (language === "python") extraction = await extractPythonRepo(repoDir);
  else if (language === "typescript") extraction = await extractTypeScriptRepo(repoDir);
  else extraction = await extractGoRepo(repoDir);

  const built = await buildGroundTruthGraphFromRepo(repoDir);
  const canonical = canonicalizeGraph(built);
  const claimed = loadClaimed(dir);
  const evidence = evidenceFromExtraction(language, extraction);
  const { report, infoFindings } = compareMapsDetailed(built, claimed, evidence);

  const treeSnapshot = snapshotOfTree(repoDir);
  if (built.graph.repoSnapshotSha256 !== treeSnapshot) {
    fail(graphProblems, `${name} graph snapshot: got ${built.graph.repoSnapshotSha256}, want independent walk ${treeSnapshot}`);
  }

  if (language === "python") {
    const r = extraction as Awaited<ReturnType<typeof extractPythonRepo>>;
    if (r.repoSnapshotSha256 !== treeSnapshot) {
      fail(extractorProblems, `${name} extractor snapshot: got ${r.repoSnapshotSha256}, want independent walk ${treeSnapshot}`);
    }
    const wantModules = (golden.modules as Record<string, unknown>[]).map((m) => ({
      relativePath: m.relativePath,
      language: "python",
      nodeKind: m.nodeKind,
      isEntrypoint: m.isEntrypoint,
      isGenerated: m.isGenerated,
      parseStatus: m.parseStatus,
      moduleId: expectedModuleId("python", m.relativePath as string),
      contentSha256: sha256File(join(repoDir, m.relativePath as string)),
    }));
    const gotModules = r.modules
      .map((m) => ({
        relativePath: m.relativePath,
        language: m.language,
        nodeKind: m.nodeKind,
        isEntrypoint: m.isEntrypoint,
        isGenerated: m.isGenerated,
        parseStatus: m.parseStatus,
        moduleId: m.moduleId,
        contentSha256: m.contentSha256,
      }))
      .sort((a, b) => sortStr(a.relativePath, b.relativePath));
    wantModules.sort((a, b) => sortStr(a.relativePath, b.relativePath));
    if (canon(gotModules) !== canon(wantModules)) {
      fail(extractorProblems, `${name} extractor modules (incl. recomputed moduleId/contentSha256): got ${canon(gotModules)}, want ${canon(wantModules)}`);
    }
    if (JSON.stringify(sortedJson(r.edges)) !== JSON.stringify(sortedJson(golden.edges))) {
      fail(extractorProblems, `${name} extractor edges: got ${JSON.stringify(sortedJson(r.edges))}, want ${JSON.stringify(sortedJson(golden.edges))}`);
    }
    for (const [field, got, want] of [
      ["entrypoints", r.entrypoints, golden.entrypoints],
      ["reachableFromEntrypoints", r.reachableFromEntrypoints, golden.reachableFromEntrypoints],
      ["isolatedModules", r.isolatedModules, golden.isolatedModules],
      ["externalImports", r.externalImports, golden.externalImports],
      ["unknownImports", r.unknownImports, golden.unknownImports],
      ["dynamicUnknown", r.dynamicUnknown, golden.dynamicUnknown],
    ] as const) {
      // Order-insensitive, key-order-insensitive comparison.
      if (JSON.stringify(sortedJson(got as unknown[])) !== JSON.stringify(sortedJson(want as unknown[]))) {
        fail(extractorProblems, `${name} extractor ${field}: got ${canon(got)}, want ${canon(want)}`);
      }
    }
    if (r.externalImports.length !== golden.externalImportCount) {
      fail(extractorProblems, `${name} extractor externalImportCount: got ${r.externalImports.length}, want ${golden.externalImportCount}`);
    }
    // Graph level: canonical modules/edges/reachable/isolated vs golden.
    const wantCanonModules = wantModules.map((m) => ({ ...m, aliases: [] as string[] }));
    const gotCanonModules = canonical.modules.map((m) => ({
      relativePath: m.relativePath,
      language: m.language,
      nodeKind: m.nodeKind,
      isEntrypoint: m.isEntrypoint,
      isGenerated: m.isGenerated,
      parseStatus: m.parseStatus,
      moduleId: m.moduleId,
      contentSha256: m.contentSha256,
      aliases: m.aliases,
    }));
    if (canon(gotCanonModules) !== canon(wantCanonModules)) {
      fail(graphProblems, `${name} graph modules: got ${canon(gotCanonModules)}, want ${canon(wantCanonModules)}`);
    }
    const wantEdges = (golden.edges as { from: string; to: string }[]).map((e) => `${e.from}\0${e.to}`).sort();
    const gotEdges = canonical.edges.map((e) => `${e.from}\0${e.to}`).sort();
    if (JSON.stringify(gotEdges) !== JSON.stringify(wantEdges)) {
      fail(graphProblems, `${name} graph edges: got ${JSON.stringify(gotEdges)}, want ${JSON.stringify(wantEdges)}`);
    }
    if (JSON.stringify(canonical.entrypoints) !== JSON.stringify([...golden.entrypoints].sort(sortStr))) {
      fail(graphProblems, `${name} graph entrypoints: got ${JSON.stringify(canonical.entrypoints)}, want ${JSON.stringify([...golden.entrypoints].sort(sortStr))}`);
    }
    if (JSON.stringify(canonical.reachableFromEntrypoints) !== JSON.stringify([...golden.reachableFromEntrypoints].sort(sortStr))) {
      fail(graphProblems, `${name} graph reachable: got ${JSON.stringify(canonical.reachableFromEntrypoints)}, want ${JSON.stringify([...golden.reachableFromEntrypoints].sort(sortStr))}`);
    }
    if (JSON.stringify(canonical.isolatedModules) !== JSON.stringify([...golden.isolatedModules].sort(sortStr))) {
      fail(graphProblems, `${name} graph isolated: got ${JSON.stringify(canonical.isolatedModules)}, want ${JSON.stringify([...golden.isolatedModules].sort(sortStr))}`);
    }
  } else {
    const exp = golden.expected as Record<string, unknown>;
    const goldenEdges = exp.edges as { from: string; to: string }[];
    const goldenEdgePairs = goldenEdges.map((e) => `${e.from}\0${e.to}`).sort();
    const goldenModules = exp.modules as Record<string, unknown>[];
    const tomlPaths = tomlEntrypoints(repoDir);
    const expectedEntryModules = entryModulePaths(language, tomlPaths).sort(sortStr);
    const { reachable, isolated } = bfsReachable(
      goldenEdges.map((e) => [e.from, e.to] as [string, string]),
      expectedEntryModules,
      goldenModules.map((m) => m.relativePath as string),
    );

    if (language === "typescript") {
      const r = extraction as Awaited<ReturnType<typeof extractTypeScriptRepo>>;
      const wantModules = goldenModules.map((m) => ({
        relativePath: m.relativePath,
        nodeKind: m.nodeKind,
        isEntrypoint: m.isEntrypoint,
        isGenerated: m.isGenerated,
        parseStatus: m.parseStatus,
        isDeclarationFile: m.isDeclarationFile,
        files: m.files,
      }));
      const gotModules = r.modules
        .map((d) => ({
          relativePath: d.module.relativePath,
          nodeKind: d.module.nodeKind,
          isEntrypoint: d.module.isEntrypoint,
          isGenerated: d.module.isGenerated,
          parseStatus: d.module.parseStatus,
          isDeclarationFile: d.isDeclarationFile,
          files: [{ relativePath: d.module.relativePath, isGenerated: d.module.isGenerated, isCgo: false }],
        }))
        .sort((a, b) => sortStr(a.relativePath as string, b.relativePath as string));
      wantModules.sort((a, b) => sortStr(a.relativePath as string, b.relativePath as string));
      if (canon(gotModules) !== canon(wantModules)) {
        fail(extractorProblems, `${name} extractor modules: got ${canon(gotModules)}, want ${canon(wantModules)}`);
      }
      // Recomputed hashes per module (single-file modules).
      for (const d of r.modules) {
        const wantId = expectedModuleId("typescript", d.module.relativePath);
        const wantContent = sha256File(join(repoDir, d.module.relativePath));
        if (d.module.moduleId !== wantId || d.module.contentSha256 !== wantContent) {
          fail(extractorProblems, `${name} extractor hashes for ${d.module.relativePath}: got ${d.module.moduleId}/${d.module.contentSha256}, want ${wantId}/${wantContent}`);
        }
      }
      const gotEdges = r.edges.map((e) => `${e.from}\0${e.to}`).sort();
      if (JSON.stringify(gotEdges) !== JSON.stringify(goldenEdgePairs)) {
        fail(extractorProblems, `${name} extractor edges: got ${JSON.stringify(gotEdges)}, want ${JSON.stringify(goldenEdgePairs)}`);
      }
      const gotGen = r.generatedEdges.map((e) => `${e.from}\0${e.to}`).sort();
      const wantGen = ((exp.generatedEdges ?? []) as { from: string; to: string }[]).map((e) => `${e.from}\0${e.to}`).sort();
      if (JSON.stringify(gotGen) !== JSON.stringify(wantGen)) {
        fail(extractorProblems, `${name} extractor generatedEdges: got ${JSON.stringify(gotGen)}, want ${JSON.stringify(wantGen)}`);
      }
      if (r.externalImportCount !== exp.externalImportCount) {
        fail(extractorProblems, `${name} extractor externalImportCount: got ${r.externalImportCount}, want ${exp.externalImportCount}`);
      }
      const gotUnknowns = r.unknowns.map((u) => ({ from: u.from, specifier: u.specifier, reason: u.reason })).sort((a, b) => sortStr(JSON.stringify(a), JSON.stringify(b)));
      const wantUnknowns = ((exp.unknowns ?? []) as Record<string, unknown>[]).map((u) => ({ from: u.from, specifier: u.specifier, reason: u.reason }));
      if (JSON.stringify(sortedJson(gotUnknowns)) !== JSON.stringify(sortedJson(wantUnknowns))) {
        fail(extractorProblems, `${name} extractor unknowns: got ${JSON.stringify(gotUnknowns)}, want ${JSON.stringify(wantUnknowns)}`);
      }
      if (JSON.stringify([...r.declaredEntrypoints].sort(sortStr)) !== JSON.stringify([...tomlPaths].sort(sortStr))) {
        fail(extractorProblems, `${name} extractor declaredEntrypoints: got ${JSON.stringify(r.declaredEntrypoints)}, want ${JSON.stringify(tomlPaths)}`);
      }
    } else {
      const r = extraction as Awaited<ReturnType<typeof extractGoRepo>>;
      const wantModules = goldenModules.map((m) => ({
        relativePath: m.relativePath,
        nodeKind: m.nodeKind,
        isEntrypoint: m.isEntrypoint,
        isGenerated: m.isGenerated,
        parseStatus: m.parseStatus,
        packageName: m.packageName,
        files: m.files,
      }));
      const gotModules = r.packages
        .map((p) => ({
          relativePath: p.module.relativePath,
          nodeKind: p.module.nodeKind,
          isEntrypoint: p.module.isEntrypoint,
          isGenerated: p.module.isGenerated,
          parseStatus: p.module.parseStatus,
          packageName: p.packageName,
          files: p.files.map((f) => ({ relativePath: f.relativePath, isGenerated: f.isGenerated, isCgo: f.isCgo })),
        }))
        .sort((a, b) => sortStr(a.relativePath as string, b.relativePath as string));
      wantModules.sort((a, b) => sortStr(a.relativePath as string, b.relativePath as string));
      if (canon(gotModules) !== canon(wantModules)) {
        fail(extractorProblems, `${name} extractor packages: got ${canon(gotModules)}, want ${canon(wantModules)}`);
      }
      // Recomputed package hashes: golden files[] drive the formula.
      for (const p of r.packages) {
        const goldenPkg = goldenModules.find((m) => m.relativePath === p.module.relativePath) as
          | { files: { relativePath: string }[] }
          | undefined;
        if (goldenPkg === undefined) continue;
        const wantContent = expectedSnapshotSha256(
          goldenPkg.files.map((f) => ({ relativePath: f.relativePath, contentSha256: sha256File(join(repoDir, f.relativePath)) })),
        );
        const wantId = expectedModuleId("go", p.module.relativePath);
        if (p.module.moduleId !== wantId || p.module.contentSha256 !== wantContent) {
          fail(extractorProblems, `${name} extractor hashes for package ${p.module.relativePath}: got ${p.module.moduleId}/${p.module.contentSha256}, want ${wantId}/${wantContent}`);
        }
      }
      const gotEdges = r.edges.map((e) => `${e.from}\0${e.to}`).sort();
      if (JSON.stringify(gotEdges) !== JSON.stringify(goldenEdgePairs)) {
        fail(extractorProblems, `${name} extractor edges: got ${JSON.stringify(gotEdges)}, want ${JSON.stringify(goldenEdgePairs)}`);
      }
      const gotGen = r.generatedEdges.map((e) => `${e.from}\0${e.to}`).sort();
      const wantGen = ((exp.generatedEdges ?? []) as { from: string; to: string }[]).map((e) => `${e.from}\0${e.to}`).sort();
      if (JSON.stringify(gotGen) !== JSON.stringify(wantGen)) {
        fail(extractorProblems, `${name} extractor generatedEdges: got ${JSON.stringify(gotGen)}, want ${JSON.stringify(wantGen)}`);
      }
      if (r.externalImportCount !== exp.externalImportCount) {
        fail(extractorProblems, `${name} extractor externalImportCount: got ${r.externalImportCount}, want ${exp.externalImportCount}`);
      }
      const gotUnknowns = r.unknowns.map((u) => ({
        from: u.from,
        ...(u.importPath !== "" ? { importPath: u.importPath } : {}),
        reason: u.reason,
      }));
      const wantUnknowns = ((exp.unknowns ?? []) as Record<string, unknown>[]).map((u) => ({
        from: u.from,
        ...((u.importPath ?? u.specifier) !== undefined && (u.importPath ?? u.specifier) !== ""
          ? { importPath: (u.importPath ?? u.specifier) as string }
          : {}),
        reason: u.reason,
      }));
      if (JSON.stringify(sortedJson(gotUnknowns)) !== JSON.stringify(sortedJson(wantUnknowns))) {
        fail(extractorProblems, `${name} extractor unknowns: got ${JSON.stringify(gotUnknowns)}, want ${JSON.stringify(wantUnknowns)}`);
      }
      const gotExcluded = r.excludedFiles.map((f) => ({ relativePath: f.relativePath, reason: f.reason }));
      const wantExcluded = ((exp.excludedFiles ?? []) as Record<string, unknown>[]).map((f) => ({ relativePath: f.relativePath, reason: f.reason }));
      if (JSON.stringify(sortedJson(gotExcluded)) !== JSON.stringify(sortedJson(wantExcluded))) {
        fail(extractorProblems, `${name} extractor excludedFiles: got ${JSON.stringify(gotExcluded)}, want ${JSON.stringify(wantExcluded)}`);
      }
      if (JSON.stringify([...r.declaredEntrypoints].sort(sortStr)) !== JSON.stringify([...tomlPaths].sort(sortStr))) {
        fail(extractorProblems, `${name} extractor declaredEntrypoints: got ${JSON.stringify(r.declaredEntrypoints)}, want ${JSON.stringify(tomlPaths)}`);
      }
    }

    // Graph level (TS/Go): canonical modules/edges/entrypoints/reachable/isolated.
    const gotCanonModules = canonical.modules.map((m) => m.relativePath).sort(sortStr);
    const wantCanonModules = goldenModules.map((m) => m.relativePath as string).sort(sortStr);
    if (canon(gotCanonModules) !== canon(wantCanonModules)) {
      fail(graphProblems, `${name} graph modules: got ${canon(gotCanonModules)}, want ${canon(wantCanonModules)}`);
    }
    const gotEdges = canonical.edges.map((e) => `${e.from}\0${e.to}`).sort();
    if (JSON.stringify(gotEdges) !== JSON.stringify(goldenEdgePairs)) {
      fail(graphProblems, `${name} graph edges: got ${JSON.stringify(gotEdges)}, want ${JSON.stringify(goldenEdgePairs)}`);
    }
    if (JSON.stringify(canonical.entrypoints) !== JSON.stringify(expectedEntryModules)) {
      fail(graphProblems, `${name} graph entrypoints: got ${JSON.stringify(canonical.entrypoints)}, want ${JSON.stringify(expectedEntryModules)}`);
    }
    if (JSON.stringify(canonical.reachableFromEntrypoints) !== JSON.stringify(reachable)) {
      fail(graphProblems, `${name} graph reachable (BFS over GOLDEN edges): got ${JSON.stringify(canonical.reachableFromEntrypoints)}, want ${JSON.stringify(reachable)}`);
    }
    if (JSON.stringify(canonical.isolatedModules) !== JSON.stringify(isolated)) {
      fail(graphProblems, `${name} graph isolated (BFS over GOLDEN edges): got ${JSON.stringify(canonical.isolatedModules)}, want ${JSON.stringify(isolated)}`);
    }
    if (canonical.externalImportCount !== (exp.externalImportCount as number)) {
      fail(graphProblems, `${name} graph externalImportCount: got ${canonical.externalImportCount}, want ${exp.externalImportCount}`);
    }
  }

  if (canonical.externalImportCount !== (language === "python" ? golden.externalImportCount : golden.expected.externalImportCount)) {
    // Already checked per-language above for TS/Go; Python checked here once.
    if (language === "python") {
      fail(graphProblems, `${name} graph externalImportCount mismatch`);
    }
  }

  // ---- Audit level (all languages). ----
  checkAuditCommon(
    auditProblems,
    name,
    report,
    claimed,
    golden.expectedStatus,
    golden.expectedFindings,
    language,
    canonical.modules.length,
    canonical.edges.length,
  );
  if (golden.kind === "control") {
    if (report.findings.length !== 0) {
      auditProblems.push(`${name} control fixture has findings: ${JSON.stringify(report.findings.map(findingKey))}`);
    }
    if (infoFindings.some((f) => f.id !== "ENTRYPOINT_CANDIDATE" && f.id !== "ISOLATED_MODULE")) {
      auditProblems.push(`${name} control info findings contain non-info types: ${JSON.stringify(infoFindings.map((f) => f.id))}`);
    }
  }
  problems.push(...auditProblems);

  pushResult({
    fixture: name,
    language,
    kind: golden.kind,
    extractorMatch: extractorProblems.length === 0,
    graphMatch: graphProblems.length === 0,
    auditMatch: auditProblems.length === 0,
    match: problems.length === 0,
    problems: [...problems],
  });
  expect(problems, `${name}: ${problems.join(" | ")}`).toEqual([]);
}

interface BoundaryExpected {
  fixture: string;
  language: string;
  extractor: Record<string, unknown>;
  graph: { modules: string[]; edges: [string, string][]; reachable: string[]; isolated: string[] };
  audit: {
    claimed: { modules: string[]; entrypoints: string[]; edges: [string, string][] };
    status: string;
    findings: GoldenFinding[];
  };
  audit2?: {
    claimed: { modules: string[]; entrypoints: string[]; edges: [string, string][] };
    status: string;
    findings: GoldenFinding[];
  };
}

function buildBoundaryClaimed(
  doc: BoundaryExpected,
  audit: BoundaryExpected["audit"],
  snapshotSha256: string,
): ClaimedMapV1 {
  const kind = doc.language === "go" ? "package" : "module";
  return {
    schema: "repomapverify.claimed-map/v1",
    mapId: doc.fixture,
    repo: doc.fixture,
    completeness: "FULL_GRAPH",
    repoSnapshotSha256: snapshotSha256,
    modules: audit.claimed.modules.map((p, i) => ({ id: `m${i}`, path: p, kind: kind as "module" | "package" })),
    entrypoints: audit.claimed.entrypoints,
    edges: audit.claimed.edges.map(([from, to]) => ({ from, to })),
  };
}

async function checkBoundaryFixture(name: string): Promise<void> {
  const dir = join(BOUNDARY_ROOT, name);
  const doc = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as BoundaryExpected;
  const repoDir = join(dir, "repo");
  const problems: string[] = [];
  const extractorProblems: string[] = [];
  const graphProblems: string[] = [];
  const auditProblems: string[] = [];
  const fail = (bucket: string[], msg: string): void => {
    bucket.push(msg);
    problems.push(msg);
  };

  let extraction: unknown;
  if (doc.language === "typescript") extraction = await extractTypeScriptRepo(repoDir);
  else extraction = await extractGoRepo(repoDir);
  const built = await buildGroundTruthGraphFromRepo(repoDir);
  const canonical = canonicalizeGraph(built);
  const evidence = evidenceFromExtraction(doc.language, extraction);
  const treeSnapshot = snapshotOfTree(repoDir);
  if (built.graph.repoSnapshotSha256 !== treeSnapshot) {
    fail(graphProblems, `${name} graph snapshot: got ${built.graph.repoSnapshotSha256}, want independent walk ${treeSnapshot}`);
  }

  if (doc.language === "typescript") {
    const r = extraction as Awaited<ReturnType<typeof extractTypeScriptRepo>>;
    const wantModules = (doc.extractor.modules as Record<string, unknown>[]).map((m) => ({
      relativePath: m.relativePath,
      isGenerated: m.isGenerated,
      isEntrypoint: m.isEntrypoint,
      parseStatus: m.parseStatus,
      isDeclarationFile: m.isDeclarationFile,
    }));
    const gotModules = r.modules
      .map((d) => ({
        relativePath: d.module.relativePath,
        isGenerated: d.module.isGenerated,
        isEntrypoint: d.module.isEntrypoint,
        parseStatus: d.module.parseStatus,
        isDeclarationFile: d.isDeclarationFile,
      }))
      .sort((a, b) => sortStr(a.relativePath, b.relativePath));
    wantModules.sort((a, b) => sortStr(a.relativePath as string, b.relativePath as string));
    if (canon(gotModules) !== canon(wantModules)) {
      fail(extractorProblems, `${name} extractor modules: got ${canon(gotModules)}, want ${canon(wantModules)}`);
    }
    const wantEdges = sortedJson(doc.extractor.edges as unknown[]);
    const gotEdges = sortedJson(
      r.edges.map((e) => ({ from: e.from, to: e.to, typeOnly: e.typeOnly, kind: e.kind })),
    );
    if (JSON.stringify(gotEdges) !== JSON.stringify(wantEdges)) {
      fail(extractorProblems, `${name} extractor edges: got ${JSON.stringify(gotEdges)}, want ${JSON.stringify(wantEdges)}`);
    }
    const wantGen = ((doc.extractor.generatedEdges ?? []) as { from: string; to: string }[]).map((e) => `${e.from}\0${e.to}`).sort();
    const gotGen = r.generatedEdges.map((e) => `${e.from}\0${e.to}`).sort();
    if (JSON.stringify(gotGen) !== JSON.stringify(wantGen)) {
      fail(extractorProblems, `${name} extractor generatedEdges: got ${JSON.stringify(gotGen)}, want ${JSON.stringify(wantGen)}`);
    }
    if (r.externalImportCount !== doc.extractor.externalImportCount) {
      fail(extractorProblems, `${name} extractor externalImportCount: got ${r.externalImportCount}, want ${doc.extractor.externalImportCount}`);
    }
    const wantUnknowns = sortedJson(doc.extractor.unknowns as unknown[]);
    const gotUnknowns = sortedJson(r.unknowns.map((u) => ({ from: u.from, reason: u.reason, specifier: u.specifier })));
    if (JSON.stringify(gotUnknowns) !== JSON.stringify(wantUnknowns)) {
      fail(extractorProblems, `${name} extractor unknowns: got ${JSON.stringify(gotUnknowns)}, want ${JSON.stringify(wantUnknowns)}`);
    }
  } else {
    const r = extraction as Awaited<ReturnType<typeof extractGoRepo>>;
    const wantPkgs = (doc.extractor.packages as Record<string, unknown>[]).map((p) => ({
      relativePath: p.relativePath,
      packageName: p.packageName,
      isGenerated: p.isGenerated,
      hasCgo: p.hasCgo,
      files: p.files,
    }));
    const gotPkgs = r.packages
      .map((p) => ({
        relativePath: p.module.relativePath,
        packageName: p.packageName,
        isGenerated: p.module.isGenerated,
        hasCgo: p.hasCgo,
        files: p.files.map((f) => ({ relativePath: f.relativePath, isGenerated: f.isGenerated, isCgo: f.isCgo })),
      }))
      .sort((a, b) => sortStr(a.relativePath as string, b.relativePath as string));
    wantPkgs.sort((a, b) => sortStr(a.relativePath as string, b.relativePath as string));
    if (canon(gotPkgs) !== canon(wantPkgs)) {
      fail(extractorProblems, `${name} extractor packages: got ${canon(gotPkgs)}, want ${canon(wantPkgs)}`);
    }
    const wantEdges = ((doc.extractor.edges ?? []) as { from: string; to: string }[]).map((e) => `${e.from}\0${e.to}`).sort();
    const gotEdges = r.edges.map((e) => `${e.from}\0${e.to}`).sort();
    if (JSON.stringify(gotEdges) !== JSON.stringify(wantEdges)) {
      fail(extractorProblems, `${name} extractor edges: got ${JSON.stringify(gotEdges)}, want ${JSON.stringify(wantEdges)}`);
    }
    const wantGen = ((doc.extractor.generatedEdges ?? []) as { from: string; to: string }[]).map((e) => `${e.from}\0${e.to}`).sort();
    const gotGen = r.generatedEdges.map((e) => `${e.from}\0${e.to}`).sort();
    if (JSON.stringify(gotGen) !== JSON.stringify(wantGen)) {
      fail(extractorProblems, `${name} extractor generatedEdges: got ${JSON.stringify(gotGen)}, want ${JSON.stringify(wantGen)}`);
    }
    if (r.externalImportCount !== doc.extractor.externalImportCount) {
      fail(extractorProblems, `${name} extractor externalImportCount: got ${r.externalImportCount}, want ${doc.extractor.externalImportCount}`);
    }
    const wantUnknowns = sortedJson(doc.extractor.unknowns as unknown[]);
    const gotUnknowns = sortedJson(
      r.unknowns.map((u) => ({
        from: u.from,
        ...(u.importPath !== "" ? { importPath: u.importPath } : {}),
        reason: u.reason,
      })),
    );
    if (JSON.stringify(gotUnknowns) !== JSON.stringify(wantUnknowns)) {
      fail(extractorProblems, `${name} extractor unknowns: got ${JSON.stringify(gotUnknowns)}, want ${JSON.stringify(wantUnknowns)}`);
    }
    const wantExcluded = sortedJson(doc.extractor.excludedFiles as unknown[]);
    const gotExcluded = sortedJson(r.excludedFiles.map((f) => ({ relativePath: f.relativePath, reason: f.reason })));
    if (JSON.stringify(gotExcluded) !== JSON.stringify(wantExcluded)) {
      fail(extractorProblems, `${name} extractor excludedFiles: got ${JSON.stringify(gotExcluded)}, want ${JSON.stringify(wantExcluded)}`);
    }
  }

  // Graph level.
  const gotGraphModules = canonical.modules.map((m) => m.relativePath).sort(sortStr);
  if (JSON.stringify(gotGraphModules) !== JSON.stringify([...doc.graph.modules].sort(sortStr))) {
    fail(graphProblems, `${name} graph modules: got ${JSON.stringify(gotGraphModules)}, want ${JSON.stringify([...doc.graph.modules].sort(sortStr))}`);
  }
  const gotGraphEdges = canonical.edges.map((e) => `${e.from}\0${e.to}`).sort();
  const wantGraphEdges = doc.graph.edges.map(([f, t]) => `${f}\0${t}`).sort();
  if (JSON.stringify(gotGraphEdges) !== JSON.stringify(wantGraphEdges)) {
    fail(graphProblems, `${name} graph edges: got ${JSON.stringify(gotGraphEdges)}, want ${JSON.stringify(wantGraphEdges)}`);
  }
  if (JSON.stringify(canonical.reachableFromEntrypoints) !== JSON.stringify([...doc.graph.reachable].sort(sortStr))) {
    fail(graphProblems, `${name} graph reachable: got ${JSON.stringify(canonical.reachableFromEntrypoints)}, want ${JSON.stringify([...doc.graph.reachable].sort(sortStr))}`);
  }
  if (JSON.stringify(canonical.isolatedModules) !== JSON.stringify([...doc.graph.isolated].sort(sortStr))) {
    fail(graphProblems, `${name} graph isolated: got ${JSON.stringify(canonical.isolatedModules)}, want ${JSON.stringify([...doc.graph.isolated].sort(sortStr))}`);
  }

  // Audit level (audit + audit2 when present).
  for (const [label, audit] of [["audit", doc.audit], ["audit2", doc.audit2]] as const) {
    if (audit === undefined) continue;
    const claimed = buildBoundaryClaimed(doc, audit, built.graph.repoSnapshotSha256);
    const { report } = compareMapsDetailed(built, claimed, evidence);
    checkAuditCommon(
      auditProblems,
      `${name}:${label}`,
      report,
      claimed,
      audit.status,
      audit.findings,
      doc.language,
      canonical.modules.length,
      canonical.edges.length,
      true,
    );
  }
  problems.push(...auditProblems);

  pushResult({
    fixture: name,
    language: doc.language,
    kind: "boundary",
    extractorMatch: extractorProblems.length === 0,
    graphMatch: graphProblems.length === 0,
    auditMatch: auditProblems.length === 0,
    match: problems.length === 0,
    problems: [...problems],
  });
  expect(problems, `${name}: ${problems.join(" | ")}`).toEqual([]);
}

async function checkDemo(): Promise<void> {
  const expected = JSON.parse(readFileSync(join(HERE, "demo.expected.json"), "utf8"));
  const repoDir = join(SRC_ROOT, "demo", "repo");
  const problems: string[] = [];
  const r = await extractPythonRepo(repoDir);
  const built = await buildGroundTruthGraphFromRepo(repoDir);
  const canonical = canonicalizeGraph(built);
  const claimed = loadClaimed(join(SRC_ROOT, "demo"));
  const evidence = evidenceFromExtraction("python", r);
  const { report } = compareMapsDetailed(built, claimed, evidence);

  // Extractor + graph: modules (with recomputed hashes), edges, entrypoints, reachable, isolated.
  const wantModules = (expected.modules as Record<string, unknown>[]).map((m) => ({
    relativePath: m.relativePath,
    language: "python",
    nodeKind: m.nodeKind,
    isEntrypoint: m.isEntrypoint,
    isGenerated: m.isGenerated,
    parseStatus: m.parseStatus,
    moduleId: expectedModuleId("python", m.relativePath as string),
    contentSha256: sha256File(join(repoDir, m.relativePath as string)),
  }));
  const gotModules = canonical.modules.map((m) => ({
    relativePath: m.relativePath,
    language: m.language,
    nodeKind: m.nodeKind,
    isEntrypoint: m.isEntrypoint,
    isGenerated: m.isGenerated,
    parseStatus: m.parseStatus,
    moduleId: m.moduleId,
    contentSha256: m.contentSha256,
  }));
  if (canon(gotModules) !== canon(wantModules)) {
    problems.push(`demo graph modules: got ${canon(gotModules)}, want ${canon(wantModules)}`);
  }
  const wantEdges = (expected.edges as { from: string; to: string }[]).map((e) => `${e.from}\0${e.to}`).sort();
  const gotEdges = canonical.edges.map((e) => `${e.from}\0${e.to}`).sort();
  if (JSON.stringify(gotEdges) !== JSON.stringify(wantEdges)) {
    problems.push(`demo graph edges: got ${JSON.stringify(gotEdges)}, want ${JSON.stringify(wantEdges)}`);
  }
  if (JSON.stringify(canonical.entrypoints) !== JSON.stringify(expected.entrypoints)) {
    problems.push(`demo graph entrypoints: got ${JSON.stringify(canonical.entrypoints)}, want ${JSON.stringify(expected.entrypoints)}`);
  }
  if (JSON.stringify(canonical.reachableFromEntrypoints) !== JSON.stringify(expected.reachableFromEntrypoints)) {
    problems.push(`demo graph reachable: got ${JSON.stringify(canonical.reachableFromEntrypoints)}, want ${JSON.stringify(expected.reachableFromEntrypoints)}`);
  }
  if (JSON.stringify(canonical.isolatedModules) !== JSON.stringify(expected.isolatedModules)) {
    problems.push(`demo graph isolated: got ${JSON.stringify(canonical.isolatedModules)}, want ${JSON.stringify(expected.isolatedModules)}`);
  }
  if (JSON.stringify(canonical.entrypointCandidates) !== JSON.stringify(expected.entrypointCandidates)) {
    problems.push(`demo graph entrypointCandidates: got ${JSON.stringify(canonical.entrypointCandidates)}, want ${JSON.stringify(expected.entrypointCandidates)}`);
  }
  if (canonical.externalImportCount !== expected.externalImportCount) {
    problems.push(`demo externalImportCount: got ${canonical.externalImportCount}, want ${expected.externalImportCount}`);
  }
  if (JSON.stringify(sortedJson(r.unknownImports)) !== JSON.stringify(sortedJson(expected.unknownImports))) {
    problems.push(`demo unknownImports: got ${JSON.stringify(r.unknownImports)}, want ${JSON.stringify(expected.unknownImports)}`);
  }
  if (JSON.stringify(sortedJson(r.dynamicUnknown)) !== JSON.stringify(sortedJson(expected.dynamicUnknown))) {
    problems.push(`demo dynamicUnknown: got ${JSON.stringify(r.dynamicUnknown)}, want ${JSON.stringify(expected.dynamicUnknown)}`);
  }
  const treeSnapshot = snapshotOfTree(repoDir);
  if (built.graph.repoSnapshotSha256 !== treeSnapshot) {
    problems.push(`demo graph snapshot: got ${built.graph.repoSnapshotSha256}, want independent walk ${treeSnapshot}`);
  }

  // Audit level.
  checkAuditCommon(
    problems,
    "demo",
    report,
    claimed,
    expected.audit.status,
    expected.audit.findings,
    "python",
    canonical.modules.length,
    canonical.edges.length,
  );
  if (report.coverage.totalClaims !== expected.audit.coverage.totalClaims || report.coverage.verifiedClaims !== expected.audit.coverage.verifiedClaims) {
    problems.push(`demo audit coverage: got ${JSON.stringify(report.coverage)}, want ${JSON.stringify(expected.audit.coverage)}`);
  }

  pushResult({
    fixture: "demo-shop",
    language: "python",
    kind: "demo",
    extractorMatch: problems.length === 0,
    graphMatch: problems.length === 0,
    auditMatch: problems.length === 0,
    match: problems.length === 0,
    problems: [...problems],
  });
  expect(problems, `demo: ${problems.join(" | ")}`).toEqual([]);
}

afterAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const matched = results.filter((r) => r.match).length;
  writeFileSync(
    join(EVIDENCE_DIR, "GOLDEN_REGRESSION.json"),
    JSON.stringify(
      {
        suite: "T011 golden regression",
        total: results.length,
        matched,
        s0: results.filter((r) => r.kind !== "boundary" && r.kind !== "demo").length,
        s0Matched: results.filter((r) => r.kind !== "boundary" && r.kind !== "demo" && r.match).length,
        boundary: results.filter((r) => r.kind === "boundary").length,
        boundaryMatched: results.filter((r) => r.kind === "boundary" && r.match).length,
        demo: results.filter((r) => r.kind === "demo").length,
        demoMatched: results.filter((r) => r.kind === "demo" && r.match).length,
        extractorMatched: results.filter((r) => r.extractorMatch).length,
        graphMatched: results.filter((r) => r.graphMatch).length,
        auditMatched: results.filter((r) => r.auditMatch).length,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );
});

describe("T011 golden regression: production output vs hand-written expectations, field-by-field", () => {
  test("S0 python fixtures (16): extractor + graph + audit vs golden.json", async () => {
    for (const name of listS0Fixtures("python", S0_ROOT)) {
      await checkS0Fixture("python", "python", name);
    }
  }, 300_000);

  test("S0 typescript fixtures (16): extractor + graph + audit vs golden.json", async () => {
    for (const name of listS0Fixtures("typescript", S0_ROOT)) {
      await checkS0Fixture("typescript", "typescript", name);
    }
  }, 300_000);

  test("S0 go fixtures (16): extractor + graph + audit vs golden.json", async () => {
    for (const name of listS0Fixtures("go", S0_ROOT)) {
      await checkS0Fixture("go", "go", name);
    }
  }, 300_000);

  test("T007 boundary fixtures (19 + 1 audit2 = 20 checks): extractor + graph + audit vs expected.json", async () => {
    const names = readdirSync(BOUNDARY_ROOT)
      .filter((n) => {
        try {
          return statSync(join(BOUNDARY_ROOT, n)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
    expect(names.length).toBe(19);
    for (const name of names) {
      await checkBoundaryFixture(name);
    }
  }, 300_000);

  test("demo repo: graph + audit vs hand-written demo.expected.json", async () => {
    await checkDemo();
  }, 300_000);
});
