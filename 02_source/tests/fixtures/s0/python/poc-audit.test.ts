/**
 * T002 PoC audit test (S0, Python only).
 *
 * For each of the 16 Python fixtures (tests/fixtures/s0/python/py-*):
 *   1. Run the production Python extractor on the fixture repo.
 *   2. Compare the extractor output to the HAND-WRITTEN golden.json
 *      field-by-field (nodes, edges + line/statement evidence, external
 *      imports, unknown imports, dynamic-unknown, entrypoints,
 *      reachable set, isolated set). Module/content hashes are recomputed
 *      INDEPENDENTLY here with node:crypto from the file bytes (never
 *      taken from the extractor) and compared to the extractor's values.
 *   3. Run the PoC audit (finding rules below — a minimal, clearly
 *      labelled PoC-only comparator; the real comparator is T006's
 *      src/comparator) of the fixture's claimed-map.json against the
 *      ground truth, and compare findings + status to the golden's
 *      expectedFindings / expectedStatus with EXACT set equality.
 *
 * Controls must yield PASS + 0 findings; planted fixtures must yield
 * FAIL with exactly the expected findings.
 *
 * This test also covers the three input-adapter PoC mappings
 * (Graphify / Understand-Anything / Aider) on the samples in
 * adapters/.
 *
 * Evidence: writes 03_evidence/T002/POC_RUN.json + POC_RUN.log
 * (per-fixture results). That write is the T002 evidence step, not part
 * of the assertions.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { extractPythonRepo } from "../../../../src/extractors/python/index.js";
import type { PythonExtractionResult } from "../../../../src/extractors/python/types.js";
import { checkSnapshot } from "../../../../src/contracts/snapshot.js";
import type { ClaimedMapV1 } from "../../../../src/contracts/claimed-map.js";
import { mapGraphify } from "../../../../src/adapters/graphify.js";
import { mapUnderstandAnything } from "../../../../src/adapters/understand-anything.js";
import { mapAiderRepoMap } from "../../../../src/adapters/aider.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = HERE;
const ADAPTER_DIR = join(HERE, "adapters");
const REPO_ROOT = join(HERE, "..", "..", "..", "..", "..");
const EVIDENCE_DIR = join(REPO_ROOT, "03_evidence", "T002");

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

interface GoldenModule {
  relativePath: string;
  language: string;
  nodeKind: string;
  isGenerated: boolean;
  isEntrypoint: boolean;
  parseStatus: string;
}
interface GoldenEdge {
  from: string;
  to: string;
  conditional: boolean;
  typeOnly: boolean;
  evidence: { line: number; statement: string };
}
interface GoldenFinding {
  id: string;
  from?: string;
  to?: string;
}
interface Golden {
  fixture: string;
  kind: "control" | "planted";
  plantedClass: string | null;
  expectedStatus: "PASS" | "FAIL" | "INCOMPLETE";
  expectedFindings: GoldenFinding[];
  entrypoints: string[];
  modules: GoldenModule[];
  edges: GoldenEdge[];
  externalImportCount: number;
  externalImports: {
    from: string;
    specifier: string;
    line: number;
    conditional: boolean;
  }[];
  unknownImports: {
    from: string;
    specifier: string;
    reason: string;
    line: number;
    statement: string;
  }[];
  dynamicUnknown: {
    path: string;
    line: number;
    statement: string;
    kind: string;
  }[];
  reachableFromEntrypoints: string[];
  isolatedModules: string[];
}

const sortStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Field-by-field golden comparison. Returns mismatch descriptions. */
function compareGolden(
  name: string,
  truth: PythonExtractionResult,
  golden: Golden,
): string[] {
  const bad: string[] = [];
  const repoDir = join(FIXTURE_DIR, name, "repo");

  const gotModules = [...truth.modules].sort((a, b) =>
    sortStr(a.relativePath, b.relativePath),
  );
  const wantModules = [...golden.modules].sort((a, b) =>
    sortStr(a.relativePath, b.relativePath),
  );
  if (gotModules.length !== wantModules.length) {
    bad.push(
      `modules: got ${gotModules.length}, want ${wantModules.length}`,
    );
  }
  for (let i = 0; i < Math.min(gotModules.length, wantModules.length); i++) {
    const g = gotModules[i] as (typeof gotModules)[number];
    const w = wantModules[i] as (typeof wantModules)[number];
    const prefix = `modules[${w.relativePath}]`;
    if (g.relativePath !== w.relativePath) bad.push(`${prefix}: path mismatch`);
    if (g.language !== w.language) bad.push(`${prefix}: language ${g.language} != ${w.language}`);
    if (g.nodeKind !== w.nodeKind) bad.push(`${prefix}: nodeKind ${g.nodeKind} != ${w.nodeKind}`);
    if (g.isGenerated !== w.isGenerated) bad.push(`${prefix}: isGenerated ${g.isGenerated} != ${w.isGenerated}`);
    if (g.isEntrypoint !== w.isEntrypoint) bad.push(`${prefix}: isEntrypoint ${g.isEntrypoint} != ${w.isEntrypoint}`);
    if (g.parseStatus !== w.parseStatus) bad.push(`${prefix}: parseStatus ${g.parseStatus} != ${w.parseStatus}`);
    if (g.evidenceLevel !== "STATIC_RULE") bad.push(`${prefix}: evidenceLevel ${g.evidenceLevel}`);
    // Hashes recomputed INDEPENDENTLY from the file bytes (not from the extractor).
    const wantModuleId = sha256Hex(`python\0${w.relativePath}`);
    if (g.moduleId !== wantModuleId) bad.push(`${prefix}: moduleId mismatch`);
    const bytes = readFileSync(join(repoDir, w.relativePath));
    const wantContent = sha256Hex(bytes);
    if (g.contentSha256 !== wantContent) bad.push(`${prefix}: contentSha256 mismatch`);
  }

  const edgeKey = (e: {
    from: string;
    to: string;
    conditional: boolean;
    typeOnly: boolean;
    evidence: { line: number; statement: string };
  }): string =>
    `${e.from}\0${e.to}\0${e.conditional}\0${e.typeOnly}\0${e.evidence.line}\0${e.evidence.statement}`;
  const gotEdges = [...truth.edges].map(edgeKey).sort();
  const wantEdges = [...golden.edges].map(edgeKey).sort();
  if (JSON.stringify(gotEdges) !== JSON.stringify(wantEdges)) {
    bad.push(`edges: got ${JSON.stringify(gotEdges)}, want ${JSON.stringify(wantEdges)}`);
  }

  const extKey = (e: {
    from: string;
    specifier: string;
    line: number;
    conditional: boolean;
  }): string => `${e.from}\0${e.specifier}\0${e.line}\0${e.conditional}`;
  if (
    JSON.stringify([...truth.externalImports].map(extKey).sort()) !==
    JSON.stringify([...golden.externalImports].map(extKey).sort())
  ) {
    bad.push(
      `externalImports: got ${JSON.stringify(truth.externalImports)}, want ${JSON.stringify(golden.externalImports)}`,
    );
  }
  if (truth.externalImports.length !== golden.externalImportCount) {
    bad.push(
      `externalImportCount: got ${truth.externalImports.length}, want ${golden.externalImportCount}`,
    );
  }

  const unkKey = (u: {
    from: string;
    specifier: string;
    reason: string;
    line: number;
    statement: string;
  }): string => `${u.from}\0${u.specifier}\0${u.reason}\0${u.line}\0${u.statement}`;
  if (
    JSON.stringify([...truth.unknownImports].map(unkKey).sort()) !==
    JSON.stringify([...golden.unknownImports].map(unkKey).sort())
  ) {
    bad.push(
      `unknownImports: got ${JSON.stringify(truth.unknownImports)}, want ${JSON.stringify(golden.unknownImports)}`,
    );
  }

  const dynKey = (d: {
    path: string;
    line: number;
    statement: string;
    kind: string;
  }): string => `${d.path}\0${d.line}\0${d.statement}\0${d.kind}`;
  if (
    JSON.stringify([...truth.dynamicUnknown].map(dynKey).sort()) !==
    JSON.stringify([...golden.dynamicUnknown].map(dynKey).sort())
  ) {
    bad.push(
      `dynamicUnknown: got ${JSON.stringify(truth.dynamicUnknown)}, want ${JSON.stringify(golden.dynamicUnknown)}`,
    );
  }

  if (JSON.stringify(truth.entrypoints) !== JSON.stringify(golden.entrypoints)) {
    bad.push(`entrypoints: got ${JSON.stringify(truth.entrypoints)}, want ${JSON.stringify(golden.entrypoints)}`);
  }
  if (
    JSON.stringify([...truth.reachableFromEntrypoints].sort()) !==
    JSON.stringify([...golden.reachableFromEntrypoints].sort())
  ) {
    bad.push(
      `reachable: got ${JSON.stringify(truth.reachableFromEntrypoints)}, want ${JSON.stringify(golden.reachableFromEntrypoints)}`,
    );
  }
  if (
    JSON.stringify([...truth.isolatedModules].sort()) !==
    JSON.stringify([...golden.isolatedModules].sort())
  ) {
    bad.push(
      `isolated: got ${JSON.stringify(truth.isolatedModules)}, want ${JSON.stringify(golden.isolatedModules)}`,
    );
  }
  return bad;
}

/* ------------------------------------------------------------------ */
/* PoC-only audit (NOT the T006 comparator): minimal finding rules   */
/* for the fixture classes T002 plants.                               */
/* ------------------------------------------------------------------ */

const FAIL_FINDINGS = new Set([
  "HALLUCINATED_EDGE",
  "HALLUCINATED_MODULE",
  "WRONG_ENTRYPOINT",
  "MISSING_EDGE",
  "UNCLAIMED_REACHABLE_MODULE",
  "NAME_COLLISION_CONFUSION",
]);

interface PocFinding {
  id: string;
  from?: string;
  to?: string;
}

function pocAudit(
  truth: PythonExtractionResult,
  claimed: ClaimedMapV1,
): { findings: PocFinding[]; status: "PASS" | "FAIL" | "INCOMPLETE"; snapshotStatus: string } {
  const findings: PocFinding[] = [];
  const snapshotStatus = checkSnapshot(
    { repoSnapshotSha256: claimed.repoSnapshotSha256, gitCommit: claimed.gitCommit },
    { repoSnapshotSha256: truth.repoSnapshotSha256, gitCommit: undefined },
  );
  const truthModules = new Set(truth.modules.map((m) => m.relativePath));
  const truthEdges = new Set(truth.edges.map((e) => `${e.from}\0${e.to}`));
  const claimedModules = new Set(claimed.modules.map((m) => m.path));
  const claimedEdges = new Set(claimed.edges.map((e) => `${e.from}\0${e.to}`));
  const basename = (p: string): string => {
    const parts = p.split("/");
    return parts[parts.length - 1] as string;
  };

  for (const m of claimed.modules) {
    if (!truthModules.has(m.path)) {
      findings.push({ id: "HALLUCINATED_MODULE", from: m.path });
    }
  }
  for (const e of claimed.edges) {
    if (!truthEdges.has(`${e.from}\0${e.to}`)) {
      findings.push({ id: "HALLUCINATED_EDGE", from: e.from, to: e.to });
      // Same-basename different-path target => name-collision confusion.
      const truthTargets = truth.edges
        .filter((t) => t.from === e.from)
        .map((t) => t.to);
      if (
        truthModules.has(e.to) &&
        truthTargets.some(
          (t) => t !== e.to && basename(t) === basename(e.to),
        )
      ) {
        findings.push({
          id: "NAME_COLLISION_CONFUSION",
          from: e.from,
          to: e.to,
        });
      }
    }
  }
  if (claimed.completeness === "FULL_GRAPH") {
    for (const e of truth.edges) {
      if (!claimedEdges.has(`${e.from}\0${e.to}`)) {
        findings.push({ id: "MISSING_EDGE", from: e.from, to: e.to });
      }
    }
    for (const r of truth.reachableFromEntrypoints) {
      if (!claimedModules.has(r)) {
        findings.push({ id: "UNCLAIMED_REACHABLE_MODULE", from: r });
      }
    }
  }
  if (truth.entrypoints.length > 0) {
    const declared = new Set(truth.entrypoints);
    for (const ep of claimed.entrypoints) {
      if (!declared.has(ep)) {
        findings.push({ id: "WRONG_ENTRYPOINT", from: ep });
      }
    }
  }
  for (const d of truth.dynamicUnknown) {
    findings.push({ id: "DYNAMIC_IMPORT_UNKNOWN", from: d.path });
  }
  for (const m of truth.modules) {
    if (m.parseStatus !== "OK") {
      findings.push({ id: "SOURCE_NOT_ENUMERATED", from: m.relativePath });
    }
  }

  let status: "PASS" | "FAIL" | "INCOMPLETE" = "PASS";
  if (findings.some((f) => FAIL_FINDINGS.has(f.id))) status = "FAIL";
  else if (
    snapshotStatus === "STALE_SNAPSHOT" ||
    findings.some(
      (f) =>
        f.id === "DYNAMIC_IMPORT_UNKNOWN" || f.id === "SOURCE_NOT_ENUMERATED",
    )
  ) {
    status = "INCOMPLETE";
  }
  return { findings, status, snapshotStatus };
}

const findingKey = (f: PocFinding): string =>
  `${f.id}|${f.from ?? ""}|${f.to ?? ""}`;

const fixtureNames = readdirSync(FIXTURE_DIR)
  .filter((n) => n.startsWith("py-") && existsSync(join(FIXTURE_DIR, n, "golden.json")))
  .sort();

const runLog: string[] = [];
const runSummary: Record<string, unknown>[] = [];

describe("T002 Python PoC audit — 16 fixtures", () => {
  for (const name of fixtureNames) {
    test(`${name}`, async () => {
      const golden = JSON.parse(
        readFileSync(join(FIXTURE_DIR, name, "golden.json"), "utf8"),
      ) as Golden;
      const claimed = JSON.parse(
        readFileSync(join(FIXTURE_DIR, name, "claimed-map.json"), "utf8"),
      ) as ClaimedMapV1;
      const truth = await extractPythonRepo(join(FIXTURE_DIR, name, "repo"));

      const goldenMismatches = compareGolden(name, truth, golden);
      expect(
        goldenMismatches,
        `golden parity failures for ${name}`,
      ).toEqual([]);

      const audit = pocAudit(truth, claimed);
      expect(
        audit.snapshotStatus,
        `snapshot must MATCH for ${name}`,
      ).toBe("MATCH");
      const gotFindings = [...audit.findings].map(findingKey).sort();
      const wantFindings = [...golden.expectedFindings]
        .map(findingKey)
        .sort();
      expect(
        gotFindings,
        `findings for ${name} (status ${audit.status})`,
      ).toEqual(wantFindings);
      expect(audit.status, `status for ${name}`).toBe(golden.expectedStatus);

      const line =
        `${name} kind=${golden.kind} planted=${golden.plantedClass ?? "-"} ` +
        `modules=${truth.modules.length} edges=${truth.edges.length} ` +
        `external=${truth.externalImports.length} ` +
        `status=${audit.status} findings=${gotFindings.join(";") || "-"}`;
      runLog.push(line);
      runSummary.push({
        fixture: name,
        kind: golden.kind,
        plantedClass: golden.plantedClass,
        modules: truth.modules.length,
        edges: truth.edges.length,
        externalImportCount: truth.externalImports.length,
        unknownImports: truth.unknownImports.length,
        dynamicUnknown: truth.dynamicUnknown.length,
        status: audit.status,
        findings: gotFindings,
        snapshotStatus: audit.snapshotStatus,
      });
    });
  }

  test("fixture count is 16 (8 control + 8 planted)", () => {
    const controls = fixtureNames.filter((n) => n.includes("-c0"));
    const planted = fixtureNames.filter((n) => n.includes("-p0"));
    expect(fixtureNames).toHaveLength(16);
    expect(controls).toHaveLength(8);
    expect(planted).toHaveLength(8);
  });
});

describe("T002 adapter PoC mappings", () => {
  test("graphify: only EXTRACTED edges pass through", () => {
    const input = JSON.parse(
      readFileSync(join(ADAPTER_DIR, "graphify-sample.json"), "utf8"),
    ) as unknown;
    const r = mapGraphify(input);
    expect(r.ok).toBe(true);
    expect(r.map?.completeness).toBe("FULL_GRAPH");
    expect(r.map?.modules.map((m) => m.path).sort()).toEqual([
      "billing/api.py",
      "billing/auth.py",
      "billing/refunds.py",
    ]);
    expect(r.map?.edges).toEqual([
      { from: "billing/api.py", to: "billing/auth.py" },
      { from: "billing/auth.py", to: "billing/refunds.py" },
    ]);
    expect(r.droppedEdges).toBe(1); // the INFERRED edge
  });

  test("graphify: missing completeness / snapshot is an error, not a guess", () => {
    const noCompleteness = { nodes: [], edges: [] };
    expect(mapGraphify(noCompleteness).ok).toBe(false);
    const noSnapshot = {
      nodes: [{ id: "n1", path: "a.py" }],
      edges: [],
      completeness: "FULL_GRAPH",
    };
    expect(mapGraphify(noSnapshot).ok).toBe(false);
    expect(mapGraphify(noSnapshot, { repoSnapshotSha256: "0".repeat(64) }).ok).toBe(true);
  });

  test("understand-anything: only static-origin edges pass through", () => {
    const input = JSON.parse(
      readFileSync(
        join(ADAPTER_DIR, "understand-anything-sample.ua.json"),
        "utf8",
      ),
    ) as unknown;
    const r = mapUnderstandAnything(input);
    expect(r.ok).toBe(true);
    expect(r.map?.edges).toEqual([
      { from: "billing/api.py", to: "billing/auth.py" },
    ]);
    expect(r.droppedEdges).toBe(2); // llm origin + missing origin
  });

  test("aider: text map forces PARTIAL_SUBGRAPH, asserts no edges", () => {
    const text = readFileSync(join(ADAPTER_DIR, "aider-sample.txt"), "utf8");
    const r = mapAiderRepoMap(text, { repoSnapshotSha256: "0".repeat(64) });
    expect(r.ok).toBe(true);
    expect(r.map?.completeness).toBe("PARTIAL_SUBGRAPH");
    expect(r.map?.modules.map((m) => m.path).sort()).toEqual([
      "billing/api.py",
      "billing/auth.py",
    ]);
    expect(r.map?.edges).toEqual([]);
    expect(r.droppedEdges).toBe(0);
  });

  test("aider: JSON input claiming FULL_GRAPH is still forced PARTIAL_SUBGRAPH", () => {
    const r = mapAiderRepoMap(
      {
        files: ["billing/api.py"],
        completeness: "FULL_GRAPH",
      },
      { repoSnapshotSha256: "0".repeat(64) },
    );
    expect(r.ok).toBe(true);
    expect(r.map?.completeness).toBe("PARTIAL_SUBGRAPH");
  });
});

afterAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const controls = runSummary.filter((s) => s["kind"] === "control");
  const planted = runSummary.filter((s) => s["kind"] === "planted");
  const controlPass = controls.filter((s) => s["status"] === "PASS").length;
  const plantedDetected = planted.filter(
    (s) => s["status"] === "FAIL" && (s["findings"] as string[]).length > 0,
  ).length;
  const payload = {
    task: "T002",
    seed: "P024-REPOMAPVERIFY-S0-2026-11-14",
    fixtures: runSummary,
    totals: {
      fixtures: runSummary.length,
      controlPass: `${controlPass}/8`,
      plantedDetected: `${plantedDetected}/8`,
    },
  };
  writeFileSync(
    join(EVIDENCE_DIR, "POC_RUN.json"),
    JSON.stringify(payload, null, 2) + "\n",
  );
  const log = [
    "T002 PoC audit run",
    `seed: P024-REPOMAPVERIFY-S0-2026-11-14`,
    `fixtures: ${runSummary.length} (control PASS ${controlPass}/8, planted detected ${plantedDetected}/8)`,
    "",
    ...runLog,
  ].join("\n") + "\n";
  writeFileSync(join(EVIDENCE_DIR, "POC_RUN.log"), log);
});
