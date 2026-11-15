/**
 * FIX T013 regression (T013 FAIL: 3 x P1 + P2-01).
 *
 * One fixture + golden per fixed divergence, OUTSIDE the S0 gate's
 * 48-fixture set (the gate count and hash must not change):
 *
 * - go-literal-entrypoint: Go map claims the literal toml spelling
 *   "cmd/server/main.go" (P1-01). Production accepted it; the Oracle
 *   said WRONG_ENTRYPOINT. Both must now PASS.
 * - py-snake-snapshot: map binds with snake_case repo_snapshot_sha256
 *   (P1-02). Production accepted it (with a warning); the Oracle said
 *   STALE_SNAPSHOT / INCOMPLETE. Both must now PASS.
 * - py-symlink-snapshot: repo has docs.txt + symlink docs-link.txt ->
 *   docs.txt, map bound to the production (collapsed) snapshot
 *   (P1-03). Production passed; the Oracle hashed every spelling and
 *   said STALE_SNAPSHOT / INCOMPLETE. Both must now PASS.
 * - py-generated-assert: map asserts billing/auth.py generated=true
 *   (hand-written) and main.py generated=false (right) (P2-01).
 *   Both must now PASS with exactly one GENERATED_MISMATCH finding
 *   (P2, non-verdict-flipping) for billing/auth.py.
 * - FIX T013 R2 (R2-P1-01 audit, one fixture per reproduced excluded-dir
 *   divergence; all PASS, 0 findings -- the extra dir is invisible to
 *   both implementations):
 *   - py-venv / py-dotvenv: py-c01 repo + venv/lib/pkg.py /
 *     .venv/lib/pkg.py ("x=1\n", the reviewer's exact probe content);
 *     maps are the reviewer's 03_evidence/T013_R2/venv/edge-*-map.json
 *     verbatim (production snapshot a80ab95d...).
 *   - ts-venv / ts-pycache: ts-ctrl-01 repo + venv/lib/foo.ts /
 *     __pycache__/stray.ts (production TS used to list them as modules
 *     while the Oracle skipped them).
 *   - go-nodemod / go-venv / go-dotvenv / go-pycache: go-ctrl-01 repo +
 *     node_modules/pkg/x.go / venv/lib/x.go / .venv/lib/x.go /
 *     __pycache__/x.go (production Go used to list them as packages
 *     while the Oracle skipped them; node_modules also contradicts
 *     PROJECT_BOOK section 0.3 / DEFAULT_EXCLUDED_DIRS).
 *   Maps for the ts/go fixtures were generated from the post-fix
 *   production ground truth (same module set + snapshot both sides now
 *   compute).
 * - FIX T013 R3 (R3-P1-01 stale-snapshot short-circuit; all INCOMPLETE,
 *   0 findings -- production Rule 1 short-circuits on STALE_SNAPSHOT
 *   while the Oracle used to let FAIL-class findings win):
 *   - py-stale-missing: py-c01 repo + extra.py at the root
 *     (`import billing.api`, a real unclaimed edge), map bound to the
 *     clean snapshot (the coordinator's probe).
 *   - py-stale-halluc: py-c01 clean repo, map with snapshot all-zeros
 *     + claimed hallucinated edge billing/api.py ->
 *     billing/nonexistent.py (+ module) (the reviewer's probe).
 *   - ts-stale-missing: ts-ctrl-01 repo + extra.ts at the root
 *     importing ./src/util, map bound to the clean snapshot (the
 *     reviewer's probe).
 *   - py-stale-dynamic: py-p06 repo (dynamic import in loader.py +
 *     claimed hallucinated edge loader.py -> plugins/alpha.py), map
 *     snapshot all-zeros -- pins that the DYNAMIC_IMPORT_UNKNOWN
 *     finding is suppressed too, not just FAIL-class findings.
 *
 * - FIX T013 R4 (R4-P1-01 unresolvable declared entrypoint; all
 *   INCOMPLETE / MATCH, 0 findings unless noted -- production Rule 9
 *   forces INCOMPLETE with status only while the Oracle used to say
 *   PASS and list the ghost as a ground-truth entrypoint):
 *   - py-ghost-entrypoint: py-c01 repo + toml declaring
 *     ["main.py", "ghost.py"], map claims both entrypoints (the
 *     reviewer's R4 probe map verbatim). Both sides must now return
 *     INCOMPLETE with 0 findings, ground-truth entrypoints
 *     ["main.py"] on both sides, and the Oracle must record
 *     unresolvedEntrypoints ["ghost.py"].
 *   - py-ghost-ctrl: py-c01 repo as shipped (toml ["main.py"]), map
 *     claims ghost.py too (the reviewer's R4 control map verbatim).
 *     Both sides must FAIL with WRONG_ENTRYPOINT ghost.py.
 *   - go-ghost-entrypoint: go-ctrl-01 repo + toml declaring
 *     ["cmd/server/main.go", "cmd/ghost/main.go"], map claims both
 *     literal spellings. Both sides must now return INCOMPLETE with
 *     0 findings, ground-truth entrypoints ["cmd/server"], and the
 *     Oracle must record unresolvedEntrypoints ["cmd/ghost/main.go"]
 *     (pins the Go package-dir resolution branch).
 *
 * Each test runs BOTH implementations on the same fixture dir --
 * production in-process (validator + ground-truth builder + evidence
 * collector + comparator) and the independent Oracle via python3 --
 * and asserts the two verdicts AND finding sets agree with each other
 * and with the hand-written expected.json. A future divergence fails
 * loudly here instead of waiting for the next independent review.
 *
 * This suite does NOT touch the S0 gate: fixtures live under
 * tests/fixtures/regression/, never under tests/fixtures/s0/.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parseClaimedMapJson } from "../../src/io/validate-claimed-map.js";
import { buildGroundTruthGraphFromRepo } from "../../src/graph/fromRepo.js";
import { canonicalizeGraph } from "../../src/canonical/index.js";
import { collectEvidence } from "../../src/cli/evidence.js";
import { compareMapsDetailed } from "../../src/comparator/compare.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", "..");
const REGRESSION_ROOT = join(HERE, "..", "fixtures", "regression");
const ORACLE_PY = join(SRC_ROOT, "oracle", "python", "oracle.py");

interface ExpectedFinding {
  id: string;
  from?: string;
  to?: string;
}

interface Expected {
  expectedStatus: string;
  expectedFindings: ExpectedFinding[];
  /** When present, both sides' snapshotStatus must equal it. */
  expectedSnapshotStatus?: string;
  /** When present, both sides' ground-truth entrypoints must equal
   * it (resolved module paths only -- FIX T013 R4). */
  expectedEntrypoints?: string[];
  /** When present, the Oracle audit's unresolvedEntrypoints must
   * equal it (FIX T013 R4; production records the same list in
   * built.unresolvedEntrypoints, not in its report). */
  expectedUnresolvedEntrypoints?: string[];
}

function listRegressionFixtures(): string[] {
  return readdirSync(REGRESSION_ROOT)
    .filter((name) => /^(py|ts|go)-/.test(name))
    .filter((name) =>
      statSync(join(REGRESSION_ROOT, name)).isDirectory(),
    )
    .sort();
}

function findingKey(f: ExpectedFinding): string {
  return `${f.id}\0${f.from ?? ""}\0${f.to ?? ""}`;
}

function sortFindings(fs: ExpectedFinding[]): string[] {
  return fs.map(findingKey).sort();
}

describe("FIX T013 regression: production vs Oracle agreement", () => {
  for (const name of listRegressionFixtures()) {
    test(
      name,
      async () => {
        const dir = join(REGRESSION_ROOT, name);
        const expected: Expected = JSON.parse(
          readFileSync(join(dir, "expected.json"), "utf8"),
        );

        // Production, in-process through the real entry points.
        const checked = parseClaimedMapJson(
          readFileSync(join(dir, "claimed-map.json"), "utf8"),
        );
        expect(
          checked.ok,
          `production validator rejected ${name}: ${JSON.stringify(
            (checked as { errors?: unknown }).errors ?? null,
          )}`,
        ).toBe(true);
        if (!checked.ok) return;
        const built = await buildGroundTruthGraphFromRepo(join(dir, "repo"));
        const { evidence } = await collectEvidence(join(dir, "repo"));
        const { report } = compareMapsDetailed(built, checked.map, evidence);
        const prodEntrypoints: string[] =
          canonicalizeGraph(built).entrypoints;
        const prodFindings: ExpectedFinding[] = report.findings.map((f) => ({
          id: f.id,
          ...(f.from !== undefined ? { from: f.from } : {}),
          ...(f.to !== undefined ? { to: f.to } : {}),
        }));

        // Independent Oracle, via its CLI on the same fixture dir.
        const tmpOut = mkdtempSync(
          join(process.env.TMPDIR ?? tmpdir(), "regression-t013-"),
        );
        try {
          const outFile = join(tmpOut, "oracle.json");
          const r = spawnSync(
            "python3",
            [ORACLE_PY, "--fixture-dir", dir, "--out", outFile],
            { encoding: "utf8" },
          );
          expect(
            r.status,
            `oracle failed on ${name}: ${r.stderr ?? ""}`,
          ).toBe(0);
          const oracle = JSON.parse(readFileSync(outFile, "utf8"));
          const oracleFindings: ExpectedFinding[] = (
            oracle.audit.findings as ExpectedFinding[]
          ).map((f) => ({
            id: f.id,
            ...(f.from !== undefined ? { from: f.from } : {}),
            ...(f.to !== undefined ? { to: f.to } : {}),
          }));

          expect(
            report.status,
            `${name}: production status ${report.status} != expected ${expected.expectedStatus}`,
          ).toBe(expected.expectedStatus);
          expect(
            oracle.audit.status,
            `${name}: oracle status ${oracle.audit.status} != expected ${expected.expectedStatus}`,
          ).toBe(expected.expectedStatus);
          expect(
            report.status,
            `${name}: production (${report.status}) != oracle (${oracle.audit.status})`,
          ).toBe(oracle.audit.status);
          expect(
            sortFindings(prodFindings),
            `${name}: production findings != expected`,
          ).toEqual(sortFindings(expected.expectedFindings));
          expect(
            sortFindings(oracleFindings),
            `${name}: oracle findings != expected`,
          ).toEqual(sortFindings(expected.expectedFindings));
          expect(
            sortFindings(prodFindings),
            `${name}: production findings != oracle findings`,
          ).toEqual(sortFindings(oracleFindings));
          if (expected.expectedSnapshotStatus !== undefined) {
            expect(
              report.snapshotStatus,
              `${name}: production snapshotStatus ${report.snapshotStatus} != expected ${expected.expectedSnapshotStatus}`,
            ).toBe(expected.expectedSnapshotStatus);
            expect(
              oracle.audit.snapshotStatus,
              `${name}: oracle snapshotStatus ${oracle.audit.snapshotStatus} != expected ${expected.expectedSnapshotStatus}`,
            ).toBe(expected.expectedSnapshotStatus);
          }
          if (expected.expectedEntrypoints !== undefined) {
            expect(
              prodEntrypoints,
              `${name}: production GT entrypoints ${JSON.stringify(prodEntrypoints)} != expected ${JSON.stringify(expected.expectedEntrypoints)}`,
            ).toEqual(expected.expectedEntrypoints);
            expect(
              oracle.groundTruth.entrypoints,
              `${name}: oracle GT entrypoints ${JSON.stringify(oracle.groundTruth.entrypoints)} != expected ${JSON.stringify(expected.expectedEntrypoints)}`,
            ).toEqual(expected.expectedEntrypoints);
            expect(
              prodEntrypoints,
              `${name}: production GT entrypoints != oracle GT entrypoints`,
            ).toEqual(oracle.groundTruth.entrypoints);
          }
          if (expected.expectedUnresolvedEntrypoints !== undefined) {
            expect(
              oracle.audit.unresolvedEntrypoints ?? [],
              `${name}: oracle unresolvedEntrypoints ${JSON.stringify(oracle.audit.unresolvedEntrypoints ?? [])} != expected ${JSON.stringify(expected.expectedUnresolvedEntrypoints)}`,
            ).toEqual(expected.expectedUnresolvedEntrypoints);
          }
        } finally {
          rmSync(tmpOut, { recursive: true, force: true });
        }
      },
      120_000,
    );
  }

  test("regression set is exactly the FIX T013 + FIX T013 R2 + FIX T013 R3 + FIX T013 R4 fixtures", () => {
    expect(listRegressionFixtures()).toEqual([
      "go-dotvenv",
      "go-ghost-entrypoint",
      "go-literal-entrypoint",
      "go-nodemod",
      "go-pycache",
      "go-venv",
      "py-dotvenv",
      "py-generated-assert",
      "py-ghost-ctrl",
      "py-ghost-entrypoint",
      "py-snake-snapshot",
      "py-stale-dynamic",
      "py-stale-halluc",
      "py-stale-missing",
      "py-symlink-snapshot",
      "py-venv",
      "ts-pycache",
      "ts-stale-missing",
      "ts-venv",
    ]);
    for (const name of listRegressionFixtures()) {
      expect(existsSync(join(REGRESSION_ROOT, name, "repo"))).toBe(true);
      expect(
        existsSync(join(REGRESSION_ROOT, name, "claimed-map.json")),
      ).toBe(true);
      expect(existsSync(join(REGRESSION_ROOT, name, "expected.json"))).toBe(
        true,
      );
    }
  });
});
