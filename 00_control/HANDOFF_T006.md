# P024 T006 HANDOFF — Comparison engine + finding classification

- Task: T006 (S1, 4h). Status: **COMPLETE — all 5 acceptance items PASS** (verified by real commands below, 2026-11-14 ~15:03 UTC).
- Input commit: `a236461` (S0 PASS, T005 PASS, gate hash `7d4efa1d…`; tree clean at start).
- Output: uncommitted changes, left in the working tree per instructions (NO commit made).
- No external model call was needed; all work was done locally (no WorkBuddy/Qoder call made).

## Output files

| Path | What it is |
|---|---|
| `02_source/src/comparator/compare.ts` (568 lines) | `compareMaps` / `compareMapsDetailed` / `informationalFindings` — pure, deterministic audit over (BuiltGraph, ClaimedMapV1, ComparatorEvidence) |
| `02_source/src/comparator/types.ts` | `ComparatorEvidence`: dynamicUnknowns, unknownImports, generatedEdges (all optional, default empty) |
| `02_source/src/comparator/index.ts` | Barrel |
| `02_source/src/findings/findings.ts` (255 lines) | One builder per finding type (all 12, spec-default severities), FAIL_FINDING_IDS, sort/dedupe, status predicates |
| `02_source/src/findings/index.ts` | Barrel |
| `02_source/src/index.ts` (modified, +2 lines) | Barrel now also exports `findings`, `comparator` (only change to a non-T006-owned file; no extractor/adapter/contract/graph/identity/oracle/fixture/golden touched) |
| `02_source/tests/comparator/comparator.test.ts` (32 tests) | Unit tests: every rule in isolation |
| `02_source/tests/comparator/golden.test.ts` (4 tests) | All 48 S0 fixtures vs hand-written goldens; writes `03_evidence/T006/GOLDEN_48.json` |
| `03_evidence/T006/TEST_RUN.log` | Full-suite verbose log (103/103) |
| `03_evidence/T006/GOLDEN_48.json` | 48/48 golden reproduction proof (24 control PASS, 24 planted detected) |
| `03_evidence/T006/S0_GATE_RERUN.log` | S0 gate re-run log (PASS, same gate hash) |
| `00_control/HANDOFF_T006.md` (this file) | |

Contracts in `02_source/src/contracts/` were NOT modified (no spec conflict found).

## Acceptance commands — exact results

All run with `TMPDIR=~/workspace/p024-repomapverify/.tmp`.

### 0. Clean build — PASS

```text
$ cd 02_source && rm -rf dist && npm run build   -> tsc -p tsconfig.build.json, exit 0
```

### 1. Comparator + all 12 finding types — PASS (32 unit tests + golden tests)

```text
$ npx vitest run tests/comparator/
  Test Files  2 passed (2); Tests  36 passed (36)
```

All 12 types covered with spec severities (table-driven test: one builder
per type, severity == FINDING_DEFAULT_SEVERITY): HALLUCINATED_EDGE (P1),
HALLUCINATED_MODULE (P1), WRONG_ENTRYPOINT (P1), MISSING_EDGE (P2),
UNCLAIMED_REACHABLE_MODULE (P2), ISOLATED_MODULE (P2, info only),
ENTRYPOINT_CANDIDATE (INFO), NAME_COLLISION_CONFUSION (P1),
DYNAMIC_IMPORT_UNKNOWN (P1), SOURCE_NOT_ENUMERATED (P1),
DUPLICATE_CONTENT (P2), GENERATED_MISMATCH (P2).

### 2. Rules enforced — PASS (unit tests, see comparator.test.ts)

- PARTIAL_SUBGRAPH never produces MISSING_EDGE / UNCLAIMED_REACHABLE_MODULE
  (and therefore no NAME_COLLISION_CONFUSION either); hallucinated claimed
  edges are still checked under PARTIAL_SUBGRAPH.
- Snapshot mismatch → STALE_SNAPSHOT / INCOMPLETE with NO blame findings
  (short-circuit; coverage verifiedClaims 0). Missing declared snapshot
  also STALE. Never blames the agent for a stale map.
- WRONG_ENTRYPOINT only with an explicit `.repomapverify.toml` declaration;
  without one, candidates surface only as ENTRYPOINT_CANDIDATE info
  findings (verified on ts-ctrl-08 / go-ctrl-06, which have no toml).
- UNKNOWN never PASS: DYNAMIC_IMPORT_UNKNOWN alone → INCOMPLETE;
  DYNAMIC + hallucinated → FAIL carrying the UNKNOWN finding
  (FAIL+INCOMPLETE); unresolvable non-dynamic import → INCOMPLETE with no
  invented finding; UNREADABLE / TOO_LARGE / PARSE_ERROR module →
  SOURCE_NOT_ENUMERATED + INCOMPLETE; claimed path that does not exist →
  HALLUCINATED, never UNKNOWN.
- NAME_COLLISION_CONFUSION only when the hallucinated target is a REAL
  module (T004-evidence rule): py-p05-style fires; py-p08-style (invented
  target) is plain HALLUCINATED_EDGE/MODULE.

### 3. BuiltGraph passthroughs — PASS (unit tests; all explicit, none silent)

- `duplicateContent` → DUPLICATE_CONTENT (P2) in the INFORMATIONAL
  findings (see "Decisions" — main-list emission would break py-p05's
  frozen golden). Empty-content (0-byte) groups are not reported at all.
- `conflicts` → NAME_COLLISION_CONFUSION (P1) each, verbatim conflict
  detail carried in the finding; FAIL-class per the frozen FAIL set.
- `droppedEdges` UNKNOWN_ENDPOINT / CONFLICT_DROPPED_ENDPOINT → INCOMPLETE
  (status only, no finding — no type fits a builder-dropped edge);
  SELF_EDGE drops are benign modelling and do not affect status.
- `unresolvedEntrypoints` → INCOMPLETE (status only, no WRONG_ENTRYPOINT
  invented — that finding is about CLAIMED entrypoints, not the declaration).
- `entrypointCandidates` → ENTRYPOINT_CANDIDATE info findings, only when
  no entrypoint is declared.

### 4. Tests: unit + golden — PASS

```text
$ npx vitest run --reporter=verbose   -> Test Files 7 passed (7); Tests 103 passed (103)
  (67 pre-existing + 32 comparator unit + 4 golden; log: 03_evidence/T006/TEST_RUN.log)
```

Golden reproduction (golden.test.ts, `03_evidence/T006/GOLDEN_48.json`):
48/48 matched — 24/24 control PASS with 0 findings, 24/24 planted detected
with exactly the expected status + finding sets (Python: exact
(id,from,to) sets; TS/Go: exact finding-class sets; snapshot MATCH on all
48). Evidence assembled from the production extractors per language
(read-only use; no golden data used as input).

### 5. S0 gate still green, same hash — PASS

```text
$ npm --prefix 02_source run s0:gate -- --replays 100   -> exit 0
  THRESHOLDS: parity 48/48; planted 24/24; control false alarms 0/24;
  replay distinct=1; external=0; source writes=0; goldens changed=0
  S0 GATE VERDICT: PASS
  gate hash: 7d4efa1d97798819c2eee29950d57f0d24ffe5961c273f3c9cd37284e7c437cd
  (identical to the T004/T005 gate hash; log: 03_evidence/T006/S0_GATE_RERUN.log)
```

The gate run rewrote `03_evidence/S0/S0_GATE.json` / `.log` with only new
timestamps; both were restored with `git checkout` (same gate hash).
`git status --short` after the run shows only `M 02_source/src/index.ts`
(barrel) plus T006-owned new files. No golden, fixture, extractor,
adapter, contract, graph, identity, or oracle file was modified.

## Real bugs / conflicts found by the tests (fixed in the comparator, not by weakening anything)

1. **Go root package spelling (go-ctrl-08).** The claimed map spells the
   root package `"."`; `normalizeRelativePath(".")` collapses it to `""`
   while the graph's display path is `"."`, so the claim matched nothing
   (5 spurious findings on a control). Fix: the comparator's
   `normalizeClaimPath` reads a normalized empty path back as `"."` —
   an empty normalized path can only come from a root spelling. Now
   covered by a unit test + go-ctrl-08 passes.
2. **py-c05 empty `__init__.py` files.** Two empty `__init__.py` files
   share the empty-content hash; the control golden expects 0 findings.
   Empty-content groups are excluded from DUPLICATE_CONTENT (see below).
3. **py-p05 deliberate duplicate content.** `lib/utils.py` and
   `shop/utils.py` intentionally share identical non-empty content while
   the frozen golden expects exactly 3 findings. This forced the
   DUPLICATE_CONTENT placement decision below — the golden was not
   altered and the gate was not weakened.

## Decisions T007+ must know (all documented in `src/comparator/compare.ts`)

1. **Finding split: main report list vs informational findings.**
   `compareMaps` returns the AuditReportV1 whose findings list is the
   S0-gate/Oracle audit set (status-driving + claim-relevant). Three
   repo-property finding types live in `compareMapsDetailed(...).infoFindings`
   instead: ISOLATED_MODULE, ENTRYPOINT_CANDIDATE, DUPLICATE_CONTENT.
   They never change the status and are meant for the report's own
   sections (spec §7.1: isolated modules get their own section). The
   split is forced by the frozen goldens: no-toml controls have every
   module isolated + several candidates, and py-p05 has deliberate
   duplicate content — emitting any of the three in the main list would
   break exact golden reproduction. All 12 types are still produced by
   the comparator with spec severities and unit tests.
2. **Stale snapshot short-circuits.** On STALE_SNAPSHOT the audit returns
   INCOMPLETE with findings [] (never FAIL, never blame findings). The
   gate's own audit does not short-circuit, but no golden exercises a
   stale snapshot, and the brief + spec §5.1 ("不得把旧地图的错误归咎于
   Agent") require it.
3. **Status precedence is gate-exact.** FAIL iff any FAIL-class finding
   (gate FAIL_FINDING_IDS); else INCOMPLETE iff any INCOMPLETE-forcing
   finding, any unresolvable import, any non-OK parseStatus, any
   unknown/conflict-dropped edge, or any unresolved entrypoint; else
   PASS. DUPLICATE_CONTENT / GENERATED_MISMATCH alone do NOT flip PASS:
   §5.1's FAIL enumeration is exactly hallucinated edge/module, wrong
   entrypoint, missing edge, unclaimed reachable module (+ the gate's
   NAME_COLLISION_CONFUSION).
4. **GENERATED_MISMATCH rule.** A claimed edge matching a generated-code
   edge (evidence.generatedEdges) is GENERATED_MISMATCH, NOT
   HALLUCINATED_EDGE — the edge exists, but only in generated code
   (spec §4.3/§4.4/§4.5 "声称地图引用它时仍须核验存在性"). The v1
   claimed-map schema carries no generated-ness assertion for modules,
   so there is no module-level GENERATED_MISMATCH rule in v1.
5. **Go entrypoint spellings.** A claimed entrypoint is accepted if it
   equals the declared module path (Go package dir, e.g. `cmd/server`)
   OR the toml path as written (e.g. `cmd/server/main.go`). The gate
   compares against module paths only; accepting the literal toml
   spelling as well is strictly more lenient, and no golden exercises
   the difference.
6. **Unresolvable imports force INCOMPLETE with no finding.** No finding
   type fits a resolved-but-unresolvable import; the Oracle + gate agree
   the status carries it. DYNAMIC_IMPORT_UNKNOWN is the exception: it
   has its own finding type.
7. **Coverage definition.** totalClaims = deduplicated claimed modules +
   edges + entrypoints; verifiedClaims subtracts claim items a finding
   references (HALLUCINATED_MODULE / HALLUCINATED_EDGE /
   GENERATED_MISMATCH / WRONG_ENTRYPOINT). Omission findings are not
   claims and do not reduce coverage. Findings carry `claimedJsonPath`
   (`modules[i]` / `edges[i]` / `entrypoints[i]`) for traceability.
8. **Claimed paths are normalized (NFC, slashes, `./` stripped) and
   resolved through the spelling map (canonical path + symlink aliases),
   so a claim using an alias spelling counts as claiming that module.
   Absolute / `..` paths are never normalized into the repo — they are
   HALLUCINATED.

## Next: T007 — TypeScript / Go adapter completion (S2, 6h)

- Owner files: `src/extractors/typescript`, `src/extractors/go`, `tests/extractors`.
- Consume: this handoff, `src/comparator` (`compareMaps`,
  `compareMapsDetailed`, `ComparatorEvidence` — T007's boundary work
  feeds `dynamicUnknowns` / `unknownImports` / `generatedEdges`),
  `src/findings` (builders + severities).
- T007 acceptance reminder: TS dynamic import (literal resolves, variable
  → DYNAMIC_IMPORT_UNKNOWN) / type import / declaration-file boundaries;
  Go generated code / cgo / vendor / build-tag boundaries; three-language
  reports complete. Note the open gap in (4) above: if T007/T008 adds a
  generated-ness assertion to the claimed-map schema, a module-level
  GENERATED_MISMATCH rule becomes definable.
- Do NOT touch: extractors/python, adapters, contracts, graph, identity,
  oracle, fixtures, goldens (T006 ownership is `src/comparator`,
  `src/findings`, `tests/comparator`).
