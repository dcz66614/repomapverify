/**
 * T009 report tests (PROJECT_BOOK §6.3, §7; PLAN T009).
 *
 * Pure report-layer checks on real fixture graphs: JSON shape
 * (§6.3, both spellings), canonical semantic hash stability,
 * privacy redaction, infoFindings surfacing, and HTML rendering
 * (offline, escaping, own sections, edge evidence).
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildGroundTruthGraphFromRepo } from "../../src/graph/fromRepo.js";
import { collectEvidence } from "../../src/cli/evidence.js";
import { compareMapsDetailed } from "../../src/comparator/compare.js";
import { parseClaimedMapJson } from "../../src/io/validate-claimed-map.js";
import { buildFullReport, type FullReport } from "../../src/report/build-report.js";
import { renderHtmlReport } from "../../src/report/render-html.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "fixtures", "s0");

async function buildReport(
  fixtureDir: string,
  repoRootOverride?: string,
): Promise<{ report: FullReport; repoRoot: string }> {
  const repoRoot = join(fixtureDir, "repo");
  const mapText = readFileSync(join(fixtureDir, "claimed-map.json"), "utf8");
  const checked = parseClaimedMapJson(mapText);
  if (!checked.ok) throw new Error(`fixture map invalid: ${JSON.stringify(checked.errors)}`);
  const built = await buildGroundTruthGraphFromRepo(repoRoot);
  const { evidence, edgeEvidence } = await collectEvidence(repoRoot);
  const detailed = compareMapsDetailed(built, checked.map, evidence);
  const report = buildFullReport({
    built,
    claimed: checked.map,
    detailed,
    edgeEvidence,
    repoRoot: repoRootOverride ?? repoRoot,
    mapWarnings: checked.warnings.map((w) => `${w.field}: ${w.message}`),
  });
  return { report, repoRoot };
}

describe("JSON report shape (§6.3)", () => {
  test("control py-c01: schema, dual spellings, counts, coverage, hash", async () => {
    const { report } = await buildReport(join(FIXTURES, "python", "py-c01-basic-imports"));
    expect(report.schema).toBe("repomapverify.report/v1");
    expect(report.mapId).toBe("synthetic-py-c01-basic-imports");
    expect(report.map_id).toBe(report.mapId);
    expect(report.status).toBe("PASS");
    expect(report.groundTruth).toEqual({ modules: 4, edges: 3 });
    expect(report.ground_truth).toEqual(report.groundTruth);
    expect(report.claimed).toEqual({ modules: 4, edges: 3 });
    expect(report.coverage.verifiedClaims).toBe(8);
    expect(report.coverage.totalClaims).toBe(8);
    expect(report.coverage.verified_claims).toBe(8);
    expect(report.coverage.total_claims).toBe(8);
    expect(report.findings).toEqual([]);
    expect(report.canonicalSemanticHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.evidenceSha256.repoSnapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.evidenceSha256.modules).toHaveLength(4);
    for (const m of report.evidenceSha256.modules) {
      expect(m.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("planted py-p01: findings carry id/severity/from/to; edge detail aligns", async () => {
    const { report } = await buildReport(
      join(FIXTURES, "python", "py-p01-hallucinated-edge"),
    );
    expect(report.status).toBe("FAIL");
    expect(report.findings).toHaveLength(2);
    for (const f of report.findings) {
      expect(f.id).toBeDefined();
      expect(["P1", "P2", "INFO"]).toContain(f.severity);
    }
    const hallucinated = report.edges.find(
      (e) => e.from === "billing/api.py" && e.to === "billing/refunds.py",
    );
    expect(hallucinated?.status).toBe("hallucinated");
    expect(hallucinated?.claimed).toBe(true);
    expect(hallucinated?.real).toBe(false);
    const verified = report.edges.find(
      (e) => e.from === "billing/api.py" && e.to === "billing/auth.py",
    );
    expect(verified?.status).toBe("verified");
    expect(verified?.evidence?.file).toBe("billing/api.py");
    expect(verified?.evidence?.line).toBe(1);
    expect(verified?.evidence?.statement).toBe("from billing.auth import login");
    // Hallucinated claimed module is listed with no ground-truth detail.
    const ghost = report.modules.find((m) => m.path === "billing/refunds.py");
    expect(ghost?.claimed).toBe(true);
    expect(ghost?.inGroundTruth).toBe(false);
    expect(ghost?.contentSha256).toBeNull();
  });
});

describe("canonical semantic hash", () => {
  test("same audit twice hashes identically; a different audit hashes differently", async () => {
    const a = await buildReport(join(FIXTURES, "python", "py-c01-basic-imports"));
    const b = await buildReport(join(FIXTURES, "python", "py-c01-basic-imports"));
    expect(a.report.canonicalSemanticHash).toBe(b.report.canonicalSemanticHash);
    const c = await buildReport(join(FIXTURES, "python", "py-p01-hallucinated-edge"));
    expect(c.report.canonicalSemanticHash).not.toBe(a.report.canonicalSemanticHash);
  });
});

describe("privacy redaction at the report layer", () => {
  test("a repo under /home/alice/... leaves no absolute path or username", async () => {
    const { report } = await buildReport(
      join(FIXTURES, "python", "py-c01-basic-imports"),
      "/home/alice/work/billing-service",
    );
    const text = JSON.stringify(report);
    expect(text).not.toContain("/home/alice");
    expect(text).not.toContain("alice");
    expect(text).toContain("billing/api.py");
  });
});

describe("infoFindings + own sections", () => {
  test("ts-ctrl-08: candidate in infoFindings and in its own section, not in findings", async () => {
    const { report } = await buildReport(join(FIXTURES, "typescript", "ts-ctrl-08"));
    expect(report.status).toBe("PASS");
    expect(report.findings).toEqual([]);
    expect(report.infoFindings.some((f) => f.id === "ENTRYPOINT_CANDIDATE")).toBe(true);
    expect(report.sections.entrypointCandidates).toContain("src/main.ts");
    expect(report.sections.isolatedModules).toEqual([]);
  });

  test("py-p05: duplicate content in infoFindings + section, never in main findings", async () => {
    const { report } = await buildReport(
      join(FIXTURES, "python", "py-p05-name-collision"),
    );
    expect(report.findings.map((f) => f.id)).not.toContain("DUPLICATE_CONTENT");
    expect(report.infoFindings.map((f) => f.id)).toContain("DUPLICATE_CONTENT");
    expect(report.sections.duplicateContent.length).toBe(1);
    expect(report.sections.duplicateContent[0]?.paths).toEqual([
      "lib/utils.py",
      "shop/utils.py",
    ]);
  });

  test("py-p04: unclaimed reachable module has its own section", async () => {
    const { report } = await buildReport(
      join(FIXTURES, "python", "py-p04-unclaimed-reachable"),
    );
    expect(report.sections.unclaimedReachableModules).toContain("billing/migrations.py");
    expect(report.findings.map((f) => f.id)).toContain("UNCLAIMED_REACHABLE_MODULE");
  });
});

describe("HTML rendering", () => {
  test("offline: no external references, no scripts; sections + evidence present", async () => {
    const { report } = await buildReport(
      join(FIXTURES, "python", "py-p01-hallucinated-edge"),
    );
    const html = renderHtmlReport(report);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script/);
    expect(html).not.toMatch(/\ssrc=/);
    expect(html).not.toMatch(/href="https?:/);
    expect(html).toContain("Wrong entrypoints");
    expect(html).toContain("Unclaimed reachable modules");
    expect(html).toContain("Isolated modules");
    expect(html).toContain("Informational findings");
    expect(html).toContain("Duplicate content");
    expect(html).toContain("SHA-256 evidence");
    expect(html).toContain("from billing.auth import login");
    expect(html).toContain("fabricated");
  });

  test("escaping: hostile path/statement text is escaped, never raw HTML", () => {
    const hostile: FullReport = {
      schema: "repomapverify.report/v1",
      mapId: "test-<script>",
      map_id: "test-<script>",
      status: "FAIL",
      completeness: "FULL_GRAPH",
      snapshotStatus: "MATCH",
      groundTruth: { modules: 1, edges: 1 },
      ground_truth: { modules: 1, edges: 1 },
      claimed: { modules: 1, edges: 1 },
      coverage: { verifiedClaims: 0, totalClaims: 1, verified_claims: 0, total_claims: 1 },
      findings: [
        {
          id: "HALLUCINATED_EDGE",
          severity: "P1",
          from: "x/<img>.py",
          to: "y.py",
          detail: 'detail with <script>alert(1)</script> and "quotes"',
        },
      ],
      infoFindings: [],
      canonicalSemanticHash: "0".repeat(64),
      evidenceSha256: { repoSnapshotSha256: "1".repeat(64), modules: [] },
      sections: {
        wrongEntrypoints: [],
        unclaimedReachableModules: [],
        isolatedModules: [],
        entrypointCandidates: [],
        duplicateContent: [],
      },
      modules: [
        {
          path: "x/<img>.py",
          moduleId: "abc",
          language: "python",
          nodeKind: "module",
          contentSha256: "2".repeat(64),
          isGenerated: false,
          isEntrypoint: false,
          parseStatus: "OK",
          aliases: [],
          claimed: true,
          inGroundTruth: true,
          reachable: true,
          isolated: false,
          inEdgesReal: [],
          outEdgesReal: ["y.py"],
          inEdgesClaimed: [],
          outEdgesClaimed: ["y.py"],
        },
      ],
      edges: [
        {
          from: "x/<img>.py",
          to: "y.py",
          claimed: true,
          real: false,
          status: "hallucinated",
          evidence: { file: "x/<img>.py", line: 1, statement: "<script>alert(1)</script>" },
        },
      ],
      mapWarnings: [],
    };
    const html = renderHtmlReport(hostile);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("x/&lt;img&gt;.py");
    expect(html).not.toMatch(/<script/);
  });

  test("module detail (§7.2) lists path, content SHA, language, generated, edges, parse status", async () => {
    const { report } = await buildReport(join(FIXTURES, "python", "py-c01-basic-imports"));
    const html = renderHtmlReport(report);
    expect(html).toContain("Content SHA-256");
    expect(html).toContain("Generated code");
    expect(html).toContain("Parse status");
    expect(html).toContain("In-edges (real)");
    expect(html).toContain("Out-edges (claimed)");
    expect(html).toContain("billing/api.py");
  });
});
