/**
 * T011 mutation tests (PROJECT_BOOK §10.2; PLAN T011, §7.1).
 *
 * 25 single mutations (tests/mutation/mutations.json) across the
 * three languages — 5 of each type:
 *   - add-hallucinated-edge (5): the audit must FAIL with the exact
 *     HALLUCINATED_EDGE finding.
 *   - delete-real-edge (5): the audit must FAIL with the exact
 *     MISSING_EDGE finding (FULL_GRAPH controls).
 *   - change-entrypoint (5): the audit must FAIL with
 *     WRONG_ENTRYPOINT (every base fixture declares its entrypoint
 *     in .repomapverify.toml).
 *   - rename-module-path (5): the audit must FAIL with
 *     HALLUCINATED_MODULE for the renamed path.
 *   - flip-snapshot-hash (5): the audit must return INCOMPLETE with
 *     snapshotStatus STALE_SNAPSHOT and zero blame findings.
 *
 * Every mutation is applied to a COPY in a temp dir under TMPDIR
 * (see tests/mutation/mutator.ts) — never to a committed fixture.
 * The suite hashes each base fixture's claimed-map.json before and
 * after the run and fails if any committed file changed.
 *
 * Per-mutation results are written to
 * 03_evidence/T011/MUTATION_RESULTS.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  loadMutationCases,
  runMutationCase,
  sha256File,
  S0_ROOT,
  type MutationResult,
} from "./mutator.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(HERE, "..", "..", "..", "03_evidence", "T011");

const results: MutationResult[] = [];
let fixtureHashesBefore: Record<string, string> = {};

function fixtureClaimedPaths(): string[] {
  const cases = loadMutationCases();
  const seen = new Set<string>();
  for (const c of cases) {
    seen.add(join(S0_ROOT, c.langDir, c.base, "claimed-map.json"));
  }
  return [...seen].sort();
}

beforeAll(() => {
  fixtureHashesBefore = {};
  for (const p of fixtureClaimedPaths()) {
    fixtureHashesBefore[p] = sha256File(p);
  }
});

afterAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const detected = results.filter((r) => r.detected).length;
  writeFileSync(
    join(EVIDENCE_DIR, "MUTATION_RESULTS.json"),
    JSON.stringify(
      {
        suite: "T011 mutation testing",
        total: results.length,
        detected,
        undetected: results.length - detected,
        byType: Object.fromEntries(
          [...new Set(results.map((r) => r.type))].map((type) => [
            type,
            {
              total: results.filter((r) => r.type === type).length,
              detected: results.filter((r) => r.type === type && r.detected).length,
            },
          ]),
        ),
        byLanguage: Object.fromEntries(
          [...new Set(results.map((r) => r.language))].map((language) => [
            language,
            {
              total: results.filter((r) => r.language === language).length,
              detected: results.filter((r) => r.language === language && r.detected).length,
            },
          ]),
        ),
        results,
      },
      null,
      2,
    ),
    "utf8",
  );
});

describe("T011 mutation testing: every single mutation must be detected", () => {
  test("25 mutations across python/typescript/go (5 per type): all detected", async () => {
    const cases = loadMutationCases();
    expect(cases.length).toBe(25);
    const problems: string[] = [];
    for (const c of cases) {
      const result = await runMutationCase(c);
      results.push(result);
      if (!result.detected) {
        problems.push(`${result.id} [${result.type} on ${result.base}]: ${result.problems.join("; ")}`);
      }
    }
    expect(problems, problems.join(" | ")).toEqual([]);
  }, 300_000);

  test("committed fixtures untouched: claimed-map.json hashes identical before/after", () => {
    const problems: string[] = [];
    for (const p of fixtureClaimedPaths()) {
      const after = sha256File(p);
      if (after !== fixtureHashesBefore[p]) {
        problems.push(`${p}: hash changed ${fixtureHashesBefore[p]} -> ${after}`);
      }
    }
    expect(problems, problems.join(" | ")).toEqual([]);
  });
});
