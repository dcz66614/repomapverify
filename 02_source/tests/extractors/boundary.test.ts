/**
 * T007 boundary tests (PROJECT_BOOK §4.4–§4.5; PLAN T007).
 *
 * One test per boundary fixture under tests/fixtures/boundary/ (19
 * fixtures: 10 TypeScript + 9 Go). Each test checks THREE levels
 * against the fixture's hand-written expected.json (authored by
 * reasoning in 03_evidence/T007/gen-boundary-fixtures.py — never from
 * extractor output):
 *   1. extractor level (modules/packages, core + generated edges,
 *      external count, unknowns, excluded files),
 *   2. ground-truth graph level (buildGroundTruthGraphFromRepo:
 *      modules, edges, reachable / isolated sets),
 *   3. audit level (compareMapsDetailed over the built graph with
 *      extractor evidence: exact status + exact finding set, snapshot
 *      MATCH; audit2 when the fixture defines a second claimed map).
 *
 * Also included:
 *   - unit tests for resolveExportsTarget: a value import must NEVER
 *     resolve through the `types` export condition (T007 regression —
 *     the old nested-condition recursion returned the "types" string).
 *   - a documenting test for the KNOWN extractor-level boundary from
 *     T005: a symlinked .go file inside a package dir is NOT a package
 *     constituent (recorded, not worked around).
 *
 * Results are written to 03_evidence/T007/BOUNDARY_RESULTS.json.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { extractTypeScriptRepo } from "../../src/extractors/typescript/index.js";
import { extractGoRepo } from "../../src/extractors/go/index.js";
import { resolveExportsTarget } from "../../src/extractors/typescript/resolve.js";
import { buildGroundTruthGraphFromRepo } from "../../src/graph/fromRepo.js";
import { compareMapsDetailed } from "../../src/comparator/compare.js";
import type { ComparatorEvidence } from "../../src/comparator/types.js";
import type { ClaimedMapV1 } from "../../src/contracts/claimed-map.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(HERE, "..", "fixtures", "boundary");
const EVIDENCE_DIR = join(HERE, "..", "..", "..", "03_evidence", "T007");

interface ExpectedFinding {
  id: string;
  from?: string;
  to?: string;
}
interface ExpectedAudit {
  claimed: { modules: string[]; entrypoints: string[]; edges: [string, string][] };
  status: string;
  findings: ExpectedFinding[];
}
interface ExpectedDoc {
  fixture: string;
  language: string;
  extractor: Record<string, unknown>;
  graph: {
    modules: string[];
    edges: [string, string][];
    reachable: string[];
    isolated: string[];
  };
  audit: ExpectedAudit;
  audit2?: ExpectedAudit;
}

const results: {
  fixture: string;
  language: string;
  status: string;
  findings: string[];
  match: boolean;
}[] = [];

const sortStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const key = (v: unknown): string => JSON.stringify(v);
const sortedKeys = (arr: unknown[]): string[] => arr.map(key).sort();

function findingKey(f: ExpectedFinding): string {
  return `${f.id}\0${f.from ?? ""}\0${f.to ?? ""}`;
}

function loadExpected(dir: string): ExpectedDoc {
  return JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as ExpectedDoc;
}

function buildClaimed(
  doc: ExpectedDoc,
  audit: ExpectedAudit,
  snapshotSha256: string,
): ClaimedMapV1 {
  const kind = doc.language === "go" ? "package" : "module";
  return {
    schema: "repomapverify.claimed-map/v1",
    mapId: doc.fixture,
    repo: doc.fixture,
    completeness: "FULL_GRAPH",
    repoSnapshotSha256: snapshotSha256,
    modules: audit.claimed.modules.map((p, i) => ({
      id: `m${i}`,
      path: p,
      kind: kind as "module" | "package",
    })),
    entrypoints: audit.claimed.entrypoints,
    edges: audit.claimed.edges.map(([from, to]) => ({ from, to })),
  };
}

function checkAudit(
  doc: ExpectedDoc,
  audit: ExpectedAudit,
  built: Awaited<ReturnType<typeof buildGroundTruthGraphFromRepo>>,
  evidence: ComparatorEvidence,
): void {
  const claimed = buildClaimed(doc, audit, built.graph.repoSnapshotSha256);
  const { report } = compareMapsDetailed(built, claimed, evidence);
  expect(report.snapshotStatus).toBe("MATCH");
  expect(report.status).toBe(audit.status);
  const got = report.findings
    .map((f) => ({
      id: f.id,
      ...(f.from !== undefined ? { from: f.from } : {}),
      ...(f.to !== undefined ? { to: f.to } : {}),
    }))
    .map(findingKey)
    .sort();
  expect(got).toEqual(audit.findings.map(findingKey).sort());
  results.push({
    fixture: doc.fixture,
    language: doc.language,
    status: report.status,
    findings: report.findings.map((f) => f.id),
    match: true,
  });
}

async function checkFixture(name: string): Promise<void> {
  const dir = join(FIXTURES_ROOT, name);
  const doc = loadExpected(dir);
  const repoDir = join(dir, "repo");

  if (doc.language === "typescript") {
    const r = await extractTypeScriptRepo(repoDir);
    const exp = doc.extractor as {
      modules: Record<string, unknown>[];
      edges: Record<string, unknown>[];
      generatedEdges: Record<string, unknown>[];
      externalImportCount: number;
      unknowns: Record<string, unknown>[];
    };
    const gotModules = r.modules
      .map((d) => ({
        relativePath: d.module.relativePath,
        isGenerated: d.module.isGenerated,
        isEntrypoint: d.module.isEntrypoint,
        parseStatus: d.module.parseStatus,
        isDeclarationFile: d.isDeclarationFile,
      }))
      .sort((a, b) => sortStr(a.relativePath, b.relativePath));
    expect(gotModules).toEqual(
      [...exp.modules].sort((a, b) =>
        sortStr(a["relativePath"] as string, b["relativePath"] as string),
      ),
    );
    const edgeShape = (e: { from: string; to: string; typeOnly: boolean; kind: string }) => ({
      from: e.from,
      to: e.to,
      typeOnly: e.typeOnly,
      kind: e.kind,
    });
    expect(sortedKeys(r.edges.map(edgeShape))).toEqual(sortedKeys(exp.edges));
    expect(
      sortedKeys(r.generatedEdges.map((e) => ({ from: e.from, to: e.to }))),
    ).toEqual(sortedKeys(exp.generatedEdges));
    expect(r.externalImportCount).toBe(exp.externalImportCount);
    const gotUnknowns = r.unknowns.map((u) => ({
      from: u.from,
      reason: u.reason,
      ...(u.specifier !== "" ? { specifier: u.specifier } : {}),
    }));
    expect(sortedKeys(gotUnknowns)).toEqual(sortedKeys(exp.unknowns));

    const built = await buildGroundTruthGraphFromRepo(repoDir);
    checkGraph(doc, built);
    const evidence: ComparatorEvidence = {
      unknownImports: r.unknowns.map((u) => ({
        from: u.from,
        specifier: u.specifier,
        reason: u.reason,
        line: u.line,
      })),
      generatedEdges: r.generatedEdges.map((e) => ({ from: e.from, to: e.to })),
    };
    checkAudit(doc, doc.audit, built, evidence);
    if (doc.audit2 !== undefined) checkAudit(doc, doc.audit2, built, evidence);
    return;
  }

  if (doc.language === "go") {
    const r = await extractGoRepo(repoDir);
    const exp = doc.extractor as {
      packages: Record<string, unknown>[];
      edges: Record<string, unknown>[];
      generatedEdges: Record<string, unknown>[];
      externalImportCount: number;
      unknowns: Record<string, unknown>[];
      excludedFiles: Record<string, unknown>[];
    };
    const gotPackages = r.packages
      .map((p) => ({
        relativePath: p.module.relativePath,
        packageName: p.packageName,
        isGenerated: p.module.isGenerated,
        hasCgo: p.hasCgo,
        files: [...p.files]
          .map((f) => ({
            relativePath: f.relativePath,
            isGenerated: f.isGenerated,
            isCgo: f.isCgo,
          }))
          .sort((a, b) => sortStr(a.relativePath, b.relativePath)),
      }))
      .sort((a, b) => sortStr(a.relativePath, b.relativePath));
    expect(gotPackages).toEqual(
      [...exp.packages].sort((a, b) =>
        sortStr(a["relativePath"] as string, b["relativePath"] as string),
      ),
    );
    const pairShape = (e: { from: string; to: string }) => ({ from: e.from, to: e.to });
    expect(sortedKeys(r.edges.map(pairShape))).toEqual(sortedKeys(exp.edges));
    expect(sortedKeys(r.generatedEdges.map(pairShape))).toEqual(
      sortedKeys(exp.generatedEdges),
    );
    expect(r.externalImportCount).toBe(exp.externalImportCount);
    const gotUnknowns = r.unknowns.map((u) => ({ from: u.from, reason: u.reason }));
    expect(sortedKeys(gotUnknowns)).toEqual(sortedKeys(exp.unknowns));
    const gotExcluded = r.excludedFiles.map((f) => ({
      relativePath: f.relativePath,
      reason: f.reason,
    }));
    expect(sortedKeys(gotExcluded)).toEqual(sortedKeys(exp.excludedFiles));

    const built = await buildGroundTruthGraphFromRepo(repoDir);
    checkGraph(doc, built);
    const evidence: ComparatorEvidence = {
      unknownImports: r.unknowns.map((u) => ({
        from: u.from,
        specifier: u.importPath,
        reason: u.reason,
        line: u.line,
      })),
      generatedEdges: r.generatedEdges.map((e) => ({ from: e.from, to: e.to })),
    };
    checkAudit(doc, doc.audit, built, evidence);
    if (doc.audit2 !== undefined) checkAudit(doc, doc.audit2, built, evidence);
    return;
  }

  throw new Error(`unknown language ${doc.language} in fixture ${name}`);
}

function checkGraph(
  doc: ExpectedDoc,
  built: Awaited<ReturnType<typeof buildGroundTruthGraphFromRepo>>,
): void {
  const pathById = new Map(
    [...built.graph.modules.values()].map((m) => [m.moduleId, m.relativePath]),
  );
  const gotModules = [...built.graph.modules.values()]
    .map((m) => m.relativePath)
    .sort();
  expect(gotModules).toEqual([...doc.graph.modules].sort());
  const gotEdges = [...built.graph.edges.values()]
    .map((e) => [pathById.get(e.fromModuleId), pathById.get(e.toModuleId)] as [string, string])
    .map(([a, b]) => `${a}\0${b}`)
    .sort();
  expect(gotEdges).toEqual(
    doc.graph.edges.map(([a, b]) => `${a}\0${b}`).sort(),
  );
  const gotReachable = [...built.graph.reachableFromEntrypoints]
    .map((id) => pathById.get(id) as string)
    .sort();
  expect(gotReachable).toEqual([...doc.graph.reachable].sort());
  const gotIsolated = [...built.graph.isolatedModuleIds]
    .map((id) => pathById.get(id) as string)
    .sort();
  expect(gotIsolated).toEqual([...doc.graph.isolated].sort());
}

const FIXTURE_NAMES = readdirSync(FIXTURES_ROOT)
  .filter((n) => /^(ts|go)-/.test(n))
  .sort();

describe("T007 boundary fixtures (extractor + graph + audit)", () => {
  for (const name of FIXTURE_NAMES) {
    test(name, async () => {
      await checkFixture(name);
    });
  }
});

describe("resolveExportsTarget: value imports never resolve via `types`", () => {
  test("types-only condition object -> undefined for a value import", () => {
    expect(
      resolveExportsTarget({ ".": { types: "./dist/types.d.ts" } }, ".", false),
    ).toBeUndefined();
  });
  test("nested types-only condition object -> undefined for a value import", () => {
    expect(
      resolveExportsTarget(
        { ".": { node: { types: "./dist/types.d.ts" } } },
        ".",
        false,
      ),
    ).toBeUndefined();
  });
  test("nested condition with import + types -> import target for a value import", () => {
    expect(
      resolveExportsTarget(
        { ".": { node: { types: "./dist/types.d.ts", import: "./dist/index.js" } } },
        ".",
        false,
      ),
    ).toBe("./dist/index.js");
  });
  test("types-only condition object -> types target for a type-only import", () => {
    expect(
      resolveExportsTarget({ ".": { types: "./dist/types.d.ts" } }, ".", true),
    ).toBe("./dist/types.d.ts");
  });
  test("condition order import > require > default for a value import", () => {
    expect(
      resolveExportsTarget(
        { ".": { types: "./t.d.ts", default: "./f.js", require: "./r.cjs", import: "./i.js" } },
        ".",
        false,
      ),
    ).toBe("./i.js");
  });
});

describe("known boundary (T005 note, recorded not worked around)", () => {
  test("symlinked .go file inside a package dir is not a package constituent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "t007-symlink-go-"));
    const write = (rel: string, content: string): void => {
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    };
    write("go.mod", "module example.com/m\n\ngo 1.25\n");
    write("target/t.go", "package target\n");
    write("pkg/a.go", 'package pkg\n\nimport _ "example.com/m/target"\n');
    write("real/b.go", 'package pkg\n\nimport _ "example.com/m/target"\n');
    symlinkSync(join(dir, "real", "b.go"), join(dir, "pkg", "b.go"));
    expect(existsSync(join(dir, "pkg", "b.go"))).toBe(true);
    const r = await extractGoRepo(dir);
    const pkg = r.packages.find((p) => p.module.relativePath === "pkg");
    expect(pkg).toBeDefined();
    // The symlinked file contributes no content to pkg: the package is
    // made of a.go alone, and no edge is evidenced by pkg/b.go.
    expect(pkg?.files.map((f) => f.relativePath)).toEqual(["pkg/a.go"]);
    expect(
      r.edges.filter((e) => e.from === "pkg"),
    ).toEqual([expect.objectContaining({ from: "pkg", to: "target" })]);
    expect(
      r.edges.some((e) => e.evidence.file === "pkg/b.go"),
    ).toBe(false);
    // The symlink's real target (real/b.go) is itself a real file, so
    // it forms its own package `real` — that is ordinary extraction
    // of a real file, not the symlink being followed into pkg.
    expect(
      r.packages.find((p) => p.module.relativePath === "real"),
    ).toBeDefined();
  });
});

afterAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    join(EVIDENCE_DIR, "BOUNDARY_RESULTS.json"),
    JSON.stringify(
      {
        task: "T007",
        fixtures: results
          .slice()
          .sort((a, b) => sortStr(a.fixture, b.fixture)),
        total: results.length,
        passed: results.filter((r) => r.match).length,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
});
