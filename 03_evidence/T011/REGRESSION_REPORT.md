# P024 T011 Regression Report — Golden / Property / Mutation

- Task: T011 (S4, 7h). Status: **COMPLETE — all 5 acceptance items PASS.**
- Input commit: `a37a419` (S0 PASS, T001–T010 PASS). No commit made by T011.
- Date: 2026-11-14 ~16:00 UTC. No external model call was needed; all work done locally.
- All commands run with `TMPDIR=~/workspace/p024-repomapverify/.tmp`.

## 1. Golden regression — PASS (68/68 fixture results, 69 audit checks)

Suite: `02_source/tests/golden/golden.test.ts` (+ `helpers.ts`, `demo.expected.json`).

| Set | Fixtures | Levels checked per fixture | Result |
|---|---:|---|---|
| S0 Python (16) | 16 | extractor + graph + audit vs `golden.json` | 16/16 |
| S0 TypeScript (16) | 16 | extractor + graph + audit vs `golden.json` | 16/16 |
| S0 Go (16) | 16 | extractor + graph + audit vs `golden.json` | 16/16 |
| T007 boundary (19) | 19 | extractor + graph + audit vs `expected.json` | 19/19 |
| Demo repo | 1 | graph + audit vs hand-written `demo.expected.json` | 1/1 |
| **Total** | **68** | extractor 68/68, graph 68/68, audit 68/68 | **68/68** |

Audit checks total 69 (48 S0 + 20 boundary — go-generated has a second claimed map, audit2 — + 1 demo).
Evidence: `03_evidence/T011/GOLDEN_REGRESSION.json`.

What "field-by-field" means here (beyond the pre-existing comparator/golden tests):
- Extractor level: modules/packages incl. per-file lists, isGenerated/isEntrypoint/parseStatus/isDeclarationFile/packageName, edges incl. Python evidence (line + statement) and TS kind/typeOnly, generated edges, external counts, unknowns, excluded files, declared entrypoints.
- Graph level: canonical modules/edges/entrypoints/reachable/isolated; module_id / content_sha256 / snapshot hashes **recomputed in the test from file bytes with node:crypto** (never taken from production output); reachable/isolated for TS/Go from a test-side BFS over GOLDEN edges.
- Audit level: exact status + exact finding sets (Python exact id/from/to; TS/Go class sets for S0, exact id/from/to for boundary/demo), snapshotStatus MATCH, coverage total/verified re-derived from the claimed map under the frozen T006 rule.
- Mismatches fail loudly: every check collects per-field problem strings (`<fixture> <level> <field>: got …, want …`) and asserts the list is empty, so vitest prints the field-level diff. This was demonstrated during development: the suite initially failed 5/5 tests with exact field diffs (see §6).

No golden, fixture, or expected file was modified. No expectation was regenerated from production output.

## 2. Property tests — PASS (480/480)

Suite: `02_source/tests/property/property.test.ts`.
Seed: **20261114** (mulberry32 PRNG; seed reproducibility checked by a dedicated test that regenerates case 0 from a fresh PRNG and compares). Evidence: `03_evidence/T011/PROPERTY_RESULTS.json`.

| Property | Cases | Passed |
|---|---:|---:|
| (a) edge direction preserved (every output edge is an input edge, same direction) | 120 | 120 |
| (b) duplicate-edge normalization idempotent (normalize twice == once; tripling edges changes nothing) | 120 | 120 |
| (c) input file order does not change the normalized result (3 shuffles per case, same canonical hash + JSON) | 120 | 120 |
| (d) no auto-generated reverse edges | 120 | 120 |
| **Total** | **480** | **480** |

Generated inputs: 2–8 synthetic modules per case, languages rotating python/typescript/go, random edge subsets (p=0.35, no self-edges — buildGraph drops those by design), random entrypoint subsets. Properties run over the pure `buildGraph` + `canonicalizeGraph`/`canonicalGraphHash` only; independent of the Oracle.

## 3. Mutation testing — PASS (25/25 detected)

Case table: `02_source/tests/mutation/mutations.json` (hand-written, 5 per type).
Runner: `02_source/tests/mutation/mutator.ts` + `mutation.test.ts` (vitest, src APIs).
Independent second layer: `02_source/scripts/mutation-runner.mjs` (built CLI audit) — also **25/25 detected**, exit 0; evidence `03_evidence/T011/MUTATION_RUNNER_RESULTS.json`.
Per-case evidence: `03_evidence/T011/MUTATION_RESULTS.json`.
By type: 5/5 each. By language: python 10/10, typescript 9/9, go 6/6.
Mutations applied only to copies in temp dirs under TMPDIR; the suite hashes each base fixture's `claimed-map.json` before/after and fails if any committed file changed (verified unchanged; `git status` shows no fixture/golden modification).

| ID | Base | Language | Mutation | Expected | Got | Expected finding | Result |
|---|---|---|---|---|---|---|---|
| M01 | py-c01-basic-imports | python | add-hallucinated-edge | FAIL | FAIL | HALLUCINATED_EDGE billing/api.py -> main.py | DETECTED |
| M02 | ts-ctrl-01 | typescript | add-hallucinated-edge | FAIL | FAIL | HALLUCINATED_EDGE src/util.ts -> src/main.ts | DETECTED |
| M03 | go-ctrl-01 | go | add-hallucinated-edge | FAIL | FAIL | HALLUCINATED_EDGE internal/store -> cmd/server | DETECTED |
| M04 | py-c08-multi-entrypoint | python | add-hallucinated-edge | FAIL | FAIL | HALLUCINATED_EDGE core/db.py -> cli.py | DETECTED |
| M05 | ts-ctrl-03 | typescript | add-hallucinated-edge | FAIL | FAIL | HALLUCINATED_EDGE src/barrel/a.ts -> src/main.ts | DETECTED |
| M06 | py-c01-basic-imports | python | delete-real-edge | FAIL | FAIL | MISSING_EDGE main.py -> billing/auth.py | DETECTED |
| M07 | ts-ctrl-01 | typescript | delete-real-edge | FAIL | FAIL | MISSING_EDGE src/main.ts -> src/util.ts | DETECTED |
| M08 | go-ctrl-01 | go | delete-real-edge | FAIL | FAIL | MISSING_EDGE internal/app -> internal/store | DETECTED |
| M09 | py-c02-relative-imports | python | delete-real-edge | FAIL | FAIL | MISSING_EDGE shop/cart.py -> shop/items.py | DETECTED |
| M10 | ts-ctrl-02 | typescript | delete-real-edge | FAIL | FAIL | MISSING_EDGE src/main.ts -> src/lib/util.ts | DETECTED |
| M11 | py-c01-basic-imports | python | change-entrypoint | FAIL | FAIL | WRONG_ENTRYPOINT billing/api.py | DETECTED |
| M12 | ts-ctrl-01 | typescript | change-entrypoint | FAIL | FAIL | WRONG_ENTRYPOINT src/app.ts | DETECTED |
| M13 | go-ctrl-01 | go | change-entrypoint | FAIL | FAIL | WRONG_ENTRYPOINT internal/app | DETECTED |
| M14 | py-c08-multi-entrypoint | python | change-entrypoint | FAIL | FAIL | WRONG_ENTRYPOINT core/api.py | DETECTED |
| M15 | ts-ctrl-02 | typescript | change-entrypoint | FAIL | FAIL | WRONG_ENTRYPOINT src/app.ts | DETECTED |
| M16 | py-c01-basic-imports | python | rename-module-path | FAIL | FAIL | HALLUCINATED_MODULE billing/auth2.py | DETECTED |
| M17 | ts-ctrl-01 | typescript | rename-module-path | FAIL | FAIL | HALLUCINATED_MODULE src/util2.ts | DETECTED |
| M18 | go-ctrl-01 | go | rename-module-path | FAIL | FAIL | HALLUCINATED_MODULE internal/store2 | DETECTED |
| M19 | py-c02-relative-imports | python | rename-module-path | FAIL | FAIL | HALLUCINATED_MODULE shop/items2.py | DETECTED |
| M20 | ts-ctrl-02 | typescript | rename-module-path | FAIL | FAIL | HALLUCINATED_MODULE src/models/user2.ts | DETECTED |
| M21 | py-c01-basic-imports | python | flip-snapshot-hash | INCOMPLETE | INCOMPLETE | STALE_SNAPSHOT, 0 findings | DETECTED |
| M22 | ts-ctrl-01 | typescript | flip-snapshot-hash | INCOMPLETE | INCOMPLETE | STALE_SNAPSHOT, 0 findings | DETECTED |
| M23 | go-ctrl-01 | go | flip-snapshot-hash | INCOMPLETE | INCOMPLETE | STALE_SNAPSHOT, 0 findings | DETECTED |
| M24 | py-c02-relative-imports | python | flip-snapshot-hash | INCOMPLETE | INCOMPLETE | STALE_SNAPSHOT, 0 findings | DETECTED |
| M25 | go-ctrl-02 | go | flip-snapshot-hash | INCOMPLETE | INCOMPLETE | STALE_SNAPSHOT, 0 findings | DETECTED |

## 4. Golden Oracle parity 100% — PASS

S0 gate re-run as part of this task (see §5): parity **48/48**, planted 24/24, control false alarms 0/24. The new property/mutation tests are independent of the Oracle (pure graph/canonical functions + production comparator over mutated claimed maps; no Oracle code or Oracle output is read by any T011 test).

## 5. Full suite green + S0 gate still green — PASS

```text
$ cd 02_source && npx vitest run --reporter=verbose
  Test Files 17 passed (17); Tests 238 passed (238)   # 226 pre-existing + 12 new T011
$ npm --prefix 02_source run s0:gate -- --replays 100
  THRESHOLDS: parity 48/48; planted 24/24; control false alarms 0/24;
  replay distinct=1; external=0; source writes=0; goldens changed=0
  S0 GATE VERDICT: PASS (exit 0)
  gate hash: 7d4efa1d97798819c2eee29950d57f0d24ffe5961c273f3c9cd37284e7c437cd
  (identical to the input hash; log: 03_evidence/T011/S0_GATE_RERUN.log)
```

Full-suite log: `03_evidence/T011/TEST_RUN.log`. The gate run rewrote `03_evidence/S0/S0_GATE.json` / `.log` with only new timestamps; both were restored with `git checkout` (same gate hash). `git status --short` after all runs shows only T011-owned new files; no `src/`, oracle, fixture, or golden file was modified.

## 6. Notes / findings for later tasks

1. **The golden suite caught a real expectation error during development (negative control).** My first hand-written `demo.expected.json` assumed the demo repo had no entrypoint declaration (plain `ls` hides dotfiles). The suite failed the demo test with field-level diffs (main.py isEntrypoint, entrypoints, reachable, isolated). Inspection found `demo/repo/.repomapverify.toml` with `paths = ["main.py"]`; the expectation was corrected from that toml file itself, not from production output. The suite also failed loudly on three test-side bugs of mine (Python external count lives in the `externalImports` array, not a count field; the test-side BFS must include edgeless modules; boundary Go unknowns omit an empty `importPath` key) — all fixed in the tests, none by weakening anything.
2. **Boundary expected findings are full objects for all languages**, while S0 TS/Go goldens carry finding classes only — the golden suite handles both shapes explicitly (`exactFindings` flag).
3. **Duplicate-content consistency is not golden-specified**: the canonical graph's `duplicateContent` groups have no golden field, so the suite does not assert them (py-p05's deliberate duplicate content is covered at the audit level by the frozen golden findings).
4. **Mutation runner precondition checks**: `applyMutation` throws if a case's precondition is unmet (edge already claimed / edge to delete absent / module absent) — a broken case fails loudly instead of passing vacuously.
5. **Coverage re-derivation**: the golden suite re-derives coverage totals from the claimed map under the frozen T006 rule (total = dedup modules + edges + entrypoints; verified subtracts HALLUCINATED_MODULE / HALLUCINATED_EDGE / GENERATED_MISMATCH / WRONG_ENTRYPOINT findings) rather than copying production numbers.
