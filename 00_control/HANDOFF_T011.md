# P024 T011 HANDOFF — Golden / Property / Mutation regression

- Task: T011 (S4, 7h). Status: **COMPLETE — all 5 acceptance items PASS** (verified by real commands below, 2026-11-14 ~16:01 UTC).
- Input commit: `a37a419` (S0 PASS, T001–T010 PASS, gate hash `7d4efa1d…`; tree clean at start).
- Output: uncommitted changes, left in the working tree per instructions (NO commit made).
- No external model call was needed; all work was done locally (no WorkBuddy/Qoder call made).

## Output files

| Path | What it is |
|---|---|
| `02_source/tests/golden/golden.test.ts` | Unified golden regression: 48 S0 (extractor + graph + audit, field-by-field) + 19 boundary fixtures (20 audit checks incl. audit2) + demo, all vs hand-written expectations |
| `02_source/tests/golden/helpers.ts` | Shared helpers: claimed-map loading, comparator evidence assembly, independent hash recomputation (module_id / content_sha256 / snapshot from file bytes) |
| `02_source/tests/golden/demo.expected.json` | Hand-written demo expectation (authored from demo sources + `.repomapverify.toml` + claimed map, NOT from production output) |
| `02_source/tests/property/property.test.ts` | 4 properties × 120 cases, seeded PRNG (mulberry32, seed 20261114) |
| `02_source/tests/mutation/mutations.json` | 25 hand-written mutation cases (5 per type, 3 languages) |
| `02_source/tests/mutation/mutator.ts` | Mutation runner: copy fixture to TMPDIR temp dir, mutate the copy only, audit via production APIs |
| `02_source/tests/mutation/mutation.test.ts` | Mutation suite + committed-fixture-untouched hash check |
| `02_source/scripts/mutation-runner.mjs` | Standalone CLI-level mutation runner (`node scripts/mutation-runner.mjs`, needs `npm run build` first) |
| `03_evidence/T011/REGRESSION_REPORT.md` | Full regression report (golden counts, property seed + counts, 25-row mutation table, gate re-run) |
| `03_evidence/T011/GOLDEN_REGRESSION.json` | 68/68 per-fixture golden results |
| `03_evidence/T011/PROPERTY_RESULTS.json` | Seed 20261114, 480/480 property cases |
| `03_evidence/T011/MUTATION_RESULTS.json` | 25/25 per-mutation results |
| `03_evidence/T011/MUTATION_RUNNER_RESULTS.json` | 25/25 CLI-level runner results |
| `03_evidence/T011/S0_GATE_RERUN.log` | S0 gate re-run log (PASS, same hash) |
| `03_evidence/T011/TEST_RUN.log` | Full-suite verbose log (238/238) |
| `00_control/HANDOFF_T011.md` (this file) | |

No `src/`, oracle, fixture, or golden file was modified. `git status --short` shows only the T011-owned new files above.

## Acceptance commands — exact results

All run with `TMPDIR=~/workspace/p024-repomapverify/.tmp`.

### 1. Golden regression — PASS (68/68 fixture results, 69 audit checks)

```text
$ cd 02_source && npx vitest run tests/golden/golden.test.ts
  Test Files 1 passed (1); Tests 5 passed (5)
  # 48 S0 + 19 boundary + demo; extractor 68/68, graph 68/68, audit 68/68
  # (69 audit checks: 48 + 20 boundary incl. audit2 + 1 demo)
```

### 2. Property tests — PASS (480/480, seed 20261114)

```text
$ npx vitest run tests/property/property.test.ts
  Test Files 1 passed (1); Tests 5 passed (5)
  (a) edge direction preserved: 120/120
  (b) duplicate-edge normalization idempotent: 120/120
  (c) input order independent (3 shuffles/case): 120/120
  (d) no auto-generated reverse edges: 120/120
```

### 3. Mutation testing — PASS (25/25 detected)

```text
$ npx vitest run tests/mutation/mutation.test.ts
  Test Files 1 passed (1); Tests 2 passed (2)
  by type: 5/5 each (hallucinated-edge, delete-edge, change-entrypoint,
    rename-module, flip-snapshot); by language: python 10/10, typescript 9/9, go 6/6
$ npm run build && node scripts/mutation-runner.mjs   # independent CLI-level layer
  mutation-runner: 25/25 detected (exit 0)
```

### 4. Golden Oracle parity 100% — PASS

S0 gate re-run (see §5): parity 48/48. No T011 test reads the Oracle or gate output.

### 5. Full suite green + S0 gate still green — PASS

```text
$ npx vitest run --reporter=verbose
  Test Files 17 passed (17); Tests 238 passed (238)   # 226 pre-existing + 12 new T011
$ npm --prefix 02_source run s0:gate -- --replays 100   -> exit 0
  THRESHOLDS: parity 48/48; planted 24/24; control false alarms 0/24;
  replay distinct=1; external=0; source writes=0; goldens changed=0
  S0 GATE VERDICT: PASS
  gate hash: 7d4efa1d97798819c2eee29950d57f0d24ffe5961c273f3c9cd37284e7c437cd
  (identical to the input hash)
```

The gate run rewrote `03_evidence/S0/S0_GATE.json` / `.log` with only new timestamps; both were restored with `git checkout` (same gate hash).

## Notes for later tasks

1. The golden suite caught a real expectation error during development: my first hand-written `demo.expected.json` assumed no entrypoint declaration, but `demo/repo/.repomapverify.toml` declares `main.py` (plain `ls` hides dotfiles). The suite failed with field-level diffs; the expectation was corrected from the toml file itself, not from production output.
2. Boundary `expected.json` findings are full `{id, from, to}` objects for all languages, while S0 TS/Go goldens carry finding classes only — the golden suite handles both shapes explicitly.
3. `duplicateContent` groups have no golden field, so the suite does not assert them.
4. `applyMutation` throws on unmet preconditions — a broken mutation case fails loudly instead of passing vacuously.
5. Coverage numbers in the golden suite are re-derived from the claimed map under the frozen T006 rule, not copied from production.

## Next: T012 — E2E / Offline / Performance (S4, 5h)

- Owner files: `tests/e2e`, `tests/offline`, `tests/performance`, release rehearsal.
- Consume: this handoff, `03_evidence/T011/REGRESSION_REPORT.md`, the T011 suites as the regression base (do not weaken them; T012 performance fixtures must not disturb the golden/property/mutation suites).
- T012 acceptance reminder: E2E full chain; offline (no network) run; performance实测 (1,000 modules ≤ 60 s) recorded; release rehearsal package verifiable.
- Do NOT touch: `src/`, oracle, fixtures, goldens, or T011-owned test files except to report a genuine golden error with evidence (never silently).
