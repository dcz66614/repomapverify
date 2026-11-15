/**
 * T012 E2E tests (PROJECT_BOOK §6.4, §10.2; PLAN T012 item 1).
 *
 * Full chain through the REAL built CLI (`node dist/cli.js`, no
 * vitest mocks, no in-process calls): fresh-checkout state is covered
 * by tests/e2e/run-e2e.sh (git worktree -> npm ci -> build -> these
 * same audits); this suite covers the audit chain itself.
 *
 * - control fixture py-c01 -> exit 0 PASS, ground truth 4 modules /
 *   3 edges (matches the hand-written golden).
 * - planted fixture per language (py-p01, ts-plant-01, go-plant-01)
 *   -> exit 1 FAIL with the expected HALLUCINATED_EDGE finding.
 * - demo repo -> exit 1 FAIL with exactly the findings the README
 *   shows (HALLUCINATED_EDGE auth.py -> pricing.py, MISSING_EDGE
 *   cart.py -> pricing.py).
 * - ground-truth JSON matches the fixture golden counts per language
 *   (py 4/3, ts 4/5, go 3/2).
 *
 * All audits write reports under TMPDIR (never into the fixtures).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "..", "..");
const FIXTURES = join(SRC_DIR, "tests", "fixtures", "s0");
const CLI = join(SRC_DIR, "dist", "cli.js");
const DEMO_REPO = join(SRC_DIR, "demo", "repo");
const DEMO_MAP = join(SRC_DIR, "demo", "claimed-map.json");

// Hand-written expectations (from the fixture golden.json files and
// the README demo sample — NOT copied from production output).
const GOLDEN_COUNTS = {
  "python/py-c01-basic-imports": { modules: 4, edges: 3 },
  "python/py-p01-hallucinated-edge": { modules: 4, edges: 3 },
  "typescript/ts-plant-01": { modules: 4, edges: 5 },
  "go/go-plant-01": { modules: 3, edges: 2 },
} as const;

function tmpOut(): string {
  return mkdtempSync(join(tmpdir(), "repomapverify-t012-e2e-"));
}

function runCli(args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function audit(
  repo: string,
  map: string,
): {
  status: number | null;
  stdout: string;
  stderr: string;
  json: any;
  html: string;
} {
  const out = tmpOut();
  const r = runCli(["audit", "--repo", repo, "--map", map, "--out", out]);
  const jsonPath = join(out, "repomapverify-report.json");
  const htmlPath = join(out, "repomapverify-report.html");
  return {
    ...r,
    json: existsSync(jsonPath)
      ? JSON.parse(readFileSync(jsonPath, "utf8"))
      : null,
    html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
  };
}

function groundTruth(repo: string, lang?: string): any {
  const args = ["ground-truth", "--repo", repo];
  if (lang) args.push("--lang", lang);
  const r = runCli(args);
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}

function hallucinatedEdges(report: any): { from: string; to: string }[] {
  return (report.findings ?? [])
    .filter((f: any) => f.id === "HALLUCINATED_EDGE")
    .map((f: any) => ({ from: f.from, to: f.to }));
}

describe("T012 E2E — real built CLI", () => {
  test("control fixture py-c01 audits to PASS, exit 0", () => {
    const dir = join(FIXTURES, "python", "py-c01-basic-imports");
    const r = audit(join(dir, "repo"), join(dir, "claimed-map.json"));
    expect(r.status).toBe(0);
    expect(r.json.status).toBe("PASS");
    expect(r.json.groundTruth).toEqual({ modules: 4, edges: 3 });
    expect(r.json.claimed).toEqual({ modules: 4, edges: 3 });
    expect(r.json.findings).toEqual([]);
    expect(r.stdout).toContain("RESULT: PASS");
    expect(r.html).toContain("PASS");
  });

  test.each([
    {
      lang: "python",
      fixture: "python/py-p01-hallucinated-edge",
      expectedEdge: { from: "billing/api.py", to: "billing/refunds.py" },
    },
    {
      lang: "typescript",
      fixture: "typescript/ts-plant-01",
      expectedEdge: null, // edge asserted only as HALLUCINATED_EDGE below
    },
    {
      lang: "go",
      fixture: "go/go-plant-01",
      expectedEdge: null,
    },
  ])(
    "planted fixture $lang ($fixture) audits to FAIL, exit 1",
    ({ fixture, expectedEdge }) => {
      const dir = join(FIXTURES, fixture);
      const r = audit(join(dir, "repo"), join(dir, "claimed-map.json"));
      expect(r.status).toBe(1);
      expect(r.json.status).toBe("FAIL");
      const edges = hallucinatedEdges(r.json);
      expect(edges.length).toBeGreaterThanOrEqual(1);
      if (expectedEdge) expect(edges).toContainEqual(expectedEdge);
      expect(r.stdout).toContain("RESULT: FAIL");
    },
  );

  test("demo repo audits to FAIL, exit 1, with the README findings", () => {
    const r = audit(DEMO_REPO, DEMO_MAP);
    expect(r.status).toBe(1);
    expect(r.json.status).toBe("FAIL");
    expect(r.json.groundTruth).toEqual({ modules: 5, edges: 5 });
    expect(r.json.claimed).toEqual({ modules: 5, edges: 5 });
    expect(r.json.coverage.verifiedClaims).toBe(10);
    expect(r.json.coverage.totalClaims).toBe(11);
    // Exactly the two findings the README first screen shows.
    expect(hallucinatedEdges(r.json)).toEqual([
      { from: "auth.py", to: "pricing.py" },
    ]);
    expect(
      (r.json.findings ?? [])
        .filter((f: any) => f.id === "MISSING_EDGE")
        .map((f: any) => ({ from: f.from, to: f.to })),
    ).toEqual([{ from: "cart.py", to: "pricing.py" }]);
    expect(r.json.findings).toHaveLength(2);
    expect(r.stdout).toContain("HALLUCINATED_EDGE: auth.py -> pricing.py");
    expect(r.stdout).toContain("MISSING_EDGE: cart.py -> pricing.py");
  });

  test.each(Object.entries(GOLDEN_COUNTS))(
    "ground-truth JSON matches golden counts for %s",
    (fixture, counts) => {
      const lang = fixture.split("/")[0];
      const gt = groundTruth(join(FIXTURES, fixture, "repo"), lang);
      expect(gt.schema).toBe("repomapverify.ground-truth/v1");
      expect(gt.modules).toHaveLength(counts.modules);
      expect(gt.edges).toHaveLength(counts.edges);
      expect(typeof gt.repoSnapshotSha256).toBe("string");
      expect(gt.repoSnapshotSha256).toHaveLength(64);
    },
  );

  test("ground-truth --lang filter matches the full-repo counts", () => {
    const gt = groundTruth(
      join(FIXTURES, "python", "py-c01-basic-imports", "repo"),
      "python",
    );
    expect(gt.modules).toHaveLength(4);
    expect(gt.edges).toHaveLength(3);
  });
});
