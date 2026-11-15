/**
 * T006 golden tests (PROJECT_BOOK §5.1–§5.2, §10.1; PLAN T006).
 *
 * For all 48 S0 fixtures: build the ground-truth graph from the
 * fixture repo with the production `buildGroundTruthGraphFromRepo`
 * (T005), assemble comparator evidence from the production extractors
 * for the fixture's language (read-only use — no golden data is used
 * as input), load the fixture's claimed-map.json, run the T006
 * comparator, and compare the audit status + finding set to the
 * hand-written golden's expectedStatus / expectedFindings.
 *
 * - Python goldens carry full findings ({id, from, to}): EXACT set
 *   equality, like the S0 gate.
 * - TypeScript / Go goldens carry finding classes only ([string]):
 *   exact class-set equality, like the S0 gate.
 * - Every fixture's claimed snapshot must MATCH (a stale snapshot
 *   would short-circuit the audit to INCOMPLETE and fail the status
 *   comparison — that is the intended behaviour, not a test artifact).
 * - Controls must yield PASS + 0 findings; planted fixtures must
 *   yield FAIL with exactly the expected findings.
 *
 * This test does NOT reuse the S0 gate's `auditFromGT` or the Oracle:
 * it exercises the production comparator itself. The gate is re-run
 * separately (see 03_evidence/T006/S0_GATE_RERUN.log) to prove it is
 * still green.
 */
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
import { buildGroundTruthGraphFromRepo } from "../../src/graph/fromRepo.js";
import { extractPythonRepo } from "../../src/extractors/python/index.js";
import { extractTypeScriptRepo } from "../../src/extractors/typescript/index.js";
import { extractGoRepo } from "../../src/extractors/go/index.js";
import { compareMapsDetailed } from "../../src/comparator/compare.js";
import type { ComparatorEvidence } from "../../src/comparator/types.js";
import type { ClaimedMapV1 } from "../../src/contracts/claimed-map.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(HERE, "..", "fixtures", "s0");
const REPO_ROOT = join(HERE, "..", "..", "..");
const EVIDENCE_DIR = join(REPO_ROOT, "03_evidence", "T006");

interface GoldenFinding {
  id: string;
  from?: string;
  to?: string;
}

const results: {
  fixture: string;
  language: string;
  kind: string;
  expectedStatus: string;
  gotStatus: string;
  expectedFindings: string[];
  gotFindings: string[];
  snapshotStatus: string;
  match: boolean;
}[] = [];

function loadClaimed(dir: string): ClaimedMapV1 {
  const raw = JSON.parse(readFileSync(join(dir, "claimed-map.json"), "utf8"));
  // Fixtures are inconsistent: Python uses `map_id`, Go/TS use `mapId`.
  return {
    schema: "repomapverify.claimed-map/v1",
    mapId: raw.mapId ?? raw.map_id ?? raw.map_id,
    repo: raw.repo ?? "",
    ...(raw.agent !== undefined ? { agent: raw.agent } : {}),
    completeness: raw.completeness,
    repoSnapshotSha256: raw.repoSnapshotSha256,
    ...(raw.gitCommit !== undefined ? { gitCommit: raw.gitCommit } : {}),
    modules: (raw.modules ?? []).map((m: { id: string; path: string; kind: string }) => ({
      id: m.id,
      path: m.path,
      kind: m.kind as "module" | "package",
    })),
    entrypoints: raw.entrypoints ?? [],
    edges: (raw.edges ?? []).map((e: { from: string; to: string }) => ({
      from: e.from,
      to: e.to,
    })),
  };
}

async function evidenceFor(
  language: string,
  repoDir: string,
): Promise<ComparatorEvidence> {
  if (language === "python") {
    const r = await extractPythonRepo(repoDir);
    return {
      dynamicUnknowns: r.dynamicUnknown.map((d) => ({
        path: d.path,
        line: d.line,
        statement: d.statement,
        kind: d.kind,
      })),
      unknownImports: r.unknownImports.map((u) => ({
        from: u.from,
        specifier: u.specifier,
        reason: u.reason,
        line: u.line,
        statement: u.statement,
      })),
      generatedEdges: r.generatedExcludedEdges.map((e) => ({
        from: e.from,
        to: e.to,
      })),
    };
  }
  if (language === "typescript") {
    const r = await extractTypeScriptRepo(repoDir);
    return {
      unknownImports: r.unknowns.map((u) => ({
        from: u.from,
        specifier: u.specifier,
        reason: u.reason,
        ...(u.line !== undefined ? { line: u.line } : {}),
      })),
      generatedEdges: r.generatedEdges.map((e) => ({ from: e.from, to: e.to })),
    };
  }
  const r = await extractGoRepo(repoDir);
  return {
    unknownImports: r.unknowns.map((u) => ({
      from: u.from,
      specifier: u.importPath,
      reason: u.reason,
      line: u.line,
    })),
    generatedEdges: r.generatedEdges.map((e) => ({ from: e.from, to: e.to })),
  };
}

function listFixtures(langDir: string): string[] {
  return readdirSync(join(FIXTURES_ROOT, langDir))
    .filter((n) => /^(py|ts|go)-/.test(n))
    .sort();
}

function findingKey(f: GoldenFinding): string {
  return `${f.id}\0${f.from ?? ""}\0${f.to ?? ""}`;
}

async function checkFixture(langDir: string, language: string, name: string) {
  const dir = join(FIXTURES_ROOT, langDir, name);
  const golden = JSON.parse(readFileSync(join(dir, "golden.json"), "utf8"));
  const claimed = loadClaimed(dir);
  const built = await buildGroundTruthGraphFromRepo(join(dir, "repo"));
  const evidence = await evidenceFor(language, join(dir, "repo"));
  const { report, infoFindings } = compareMapsDetailed(built, claimed, evidence);

  const gotFindings = report.findings.map((f) => ({
    id: f.id,
    ...(f.from !== undefined ? { from: f.from } : {}),
    ...(f.to !== undefined ? { to: f.to } : {}),
  }));
  let match = true;
  const problems: string[] = [];
  if (report.status !== golden.expectedStatus) {
    match = false;
    problems.push(`status: got ${report.status}, want ${golden.expectedStatus}`);
  }
  if (report.snapshotStatus !== "MATCH") {
    match = false;
    problems.push(`snapshotStatus: ${report.snapshotStatus} (expected MATCH)`);
  }
  if (language === "python") {
    const want = (golden.expectedFindings as GoldenFinding[])
      .map(findingKey)
      .sort();
    const got = gotFindings.map(findingKey).sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      match = false;
      problems.push(`findings: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  } else {
    const want = [...new Set(golden.expectedFindings as string[])].sort();
    const got = [...new Set(report.findings.map((f) => f.id))].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      match = false;
      problems.push(`finding classes: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  }
  if (golden.kind === "control") {
    if (report.findings.length !== 0) {
      match = false;
      problems.push(`control fixture has findings: ${JSON.stringify(gotFindings)}`);
    }
    if (infoFindings.some((f) => f.id !== "ENTRYPOINT_CANDIDATE" && f.id !== "ISOLATED_MODULE")) {
      match = false;
      problems.push(`control info findings contain non-info types`);
    }
  }
  results.push({
    fixture: name,
    language,
    kind: golden.kind,
    expectedStatus: golden.expectedStatus,
    gotStatus: report.status,
    expectedFindings:
      language === "python"
        ? (golden.expectedFindings as GoldenFinding[]).map(findingKey).sort()
        : [...new Set(golden.expectedFindings as string[])].sort(),
    gotFindings: gotFindings.map(findingKey).sort(),
    snapshotStatus: report.snapshotStatus,
    match,
  });
  expect(problems, `${name}: ${problems.join("; ")}`).toEqual([]);
  return { report, infoFindings, golden };
}

afterAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const matched = results.filter((r) => r.match).length;
  writeFileSync(
    join(EVIDENCE_DIR, "GOLDEN_48.json"),
    JSON.stringify(
      {
        total: results.length,
        matched,
        controlPass: results.filter((r) => r.kind === "control" && r.match).length,
        plantedDetected: results.filter((r) => r.kind === "planted" && r.match).length,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );
});

describe("S0 fixtures: comparator reproduces the hand-written goldens (48/48)", () => {
  test("python fixtures (16): exact status + exact finding sets", async () => {
    for (const name of listFixtures("python")) {
      await checkFixture("python", "python", name);
    }
  }, 300_000);

  test("typescript fixtures (16): exact status + exact finding classes", async () => {
    for (const name of listFixtures("typescript")) {
      await checkFixture("typescript", "typescript", name);
    }
  }, 300_000);

  test("go fixtures (16): exact status + exact finding classes", async () => {
    for (const name of listFixtures("go")) {
      await checkFixture("go", "go", name);
    }
  }, 300_000);

  test("no-toml controls: no WRONG_ENTRYPOINT, candidates are info-only", async () => {
    // ts-ctrl-08 and go-ctrl-06 have no .repomapverify.toml.
    for (const [langDir, language, name] of [
      ["typescript", "typescript", "ts-ctrl-08"],
      ["go", "go", "go-ctrl-06"],
    ] as const) {
      const dir = join(FIXTURES_ROOT, langDir, name);
      expect(existsSync(join(dir, "repo", ".repomapverify.toml"))).toBe(false);
      const claimed = loadClaimed(dir);
      const built = await buildGroundTruthGraphFromRepo(join(dir, "repo"));
      const evidence = await evidenceFor(language, join(dir, "repo"));
      const { report, infoFindings } = compareMapsDetailed(built, claimed, evidence);
      expect(report.status).toBe("PASS");
      expect(report.findings).toEqual([]);
      expect(infoFindings.some((f) => f.id === "ENTRYPOINT_CANDIDATE")).toBe(true);
      expect(infoFindings.some((f) => f.id === "WRONG_ENTRYPOINT")).toBe(false);
    }
  }, 300_000);
});
