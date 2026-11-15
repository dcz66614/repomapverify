# T008 — GENERATED_MISMATCH decision

**Date:** 2026-11-14 ~15:30 UTC
**Task:** T008 (S2), acceptance item 5
**Status:** DECIDED — option A adopted (add an OPTIONAL `generated` boolean assertion to module entries)

## The gap

The v1 claimed-map schema (PROJECT_BOOK §6.1, PLAN §4.1, `src/contracts/claimed-map.ts`)
carried no generated-ness assertion for modules. The comparator (T006) therefore had
only an **edge-level** GENERATED_MISMATCH rule: a claimed edge that matches an edge
which exists only in generated code is GENERATED_MISMATCH (P2, does not flip PASS),
using the extractors' `generatedEdges` evidence. There was no way for an agent to
assert "this module is generated code" or "this module is hand-written", so a
module-level GENERATED_MISMATCH rule was not definable. T006 and T007 both recorded
this as an open gap owned by T008.

## Decision

**Add an OPTIONAL `generated?: boolean` field to `ClaimedModuleRef`**
(`02_source/src/contracts/claimed-map.ts`), with the following semantics:

- `generated: true` — the agent asserts this module is generated code.
- `generated: false` — the agent asserts it is hand-written.
- **Absent — NO assertion.** Module-level GENERATED_MISMATCH is not judged for
  that module. This is the v1 default.

## Reasoning

1. **Backward-compatible by construction.** The field is optional and unasserted
   when absent. All 48 S0 fixture claimed maps omit it; all of them still pass
   strict validation (proven by `tests/io/claimed-map-validation.test.ts`, which
   validates all 48), the full suite stays green (193/193), and the S0 gate
   re-run passes with the identical gate hash
   `7d4efa1d97798819c2eee29950d57f0d24ffe5961c273f3c9cd37284e7c437cd`.
   No fixture, golden, or gate threshold was touched.
2. **The ground-truth side already exists.** Extractors already mark generated
   code per file/package (Python header markers, TS `.d.ts`/generated markers,
   Go `*.pb.go`/`*.mock.go`/stringer headers) and T007 completed the
   extractor-side generated marking including `generatedEdges` evidence. Only
   the *claimed* side was missing its assertion — this change closes exactly
   that half, with no new extractor work.
3. **A wrong assertion is detectable, not silently absorbed.** The validator
   rejects a non-boolean `generated` with an error naming `modules[i].generated`
   (tested). A boolean assertion that disagrees with ground truth is a future
   comparator finding, not a validation error — validation judges shape, the
   comparator judges truth.
4. **No silent default.** Defaulting absent to `false` would have been a silent
   misread: most agents do not know or do not say whether a module is generated,
   and treating silence as "hand-written" would manufacture GENERATED_MISMATCH
   findings from ignorance. Absent means unasserted, explicitly.
5. **Alternative considered and rejected — "record as a known v1 limitation for
   a future version".** Leaving it undecided would keep the edge-level-only rule
   and push the schema decision to an unspecified later version, while the
   comparator work that needs the assertion (a module-level rule) would have no
   input to consume. The optional field costs nothing to existing maps and
   unblocks that rule; deferring it buys nothing.

## What this change does NOT do

- **It does NOT add a module-level GENERATED_MISMATCH comparator rule.** The
  comparator is T006-owned and out of T008 scope. The rule is now *definable*:
  when a claimed module asserts `generated: X` and ground truth says the
  module's `isGenerated` is `!X`, that is a module-level GENERATED_MISMATCH
  (suggested severity P2, per spec §5.2). A follow-up task (T009+ or a FIX task)
  should implement it, with tests, and decide whether it flips PASS (the
  edge-level rule does not; consistency suggests the module-level rule should
  not either, but that is the follow-up's decision, not this note's).
- **It does NOT change the schema version.** The schema string stays
  `repomapverify.claimed-map/v1`; the field is an optional, backward-compatible
  addition inside v1, not a v1.1. If a future version freezes a single
  `mapId` spelling (see the snake_case note in `src/io/validate-claimed-map.ts`),
  that version should also review whether `generated` stays optional.
- **It does NOT change the contract file beyond this one field.** The only
  contract edit in T008 is the `generated?: boolean` member plus its doc
  comment in `src/contracts/claimed-map.ts`. No other contract was modified.

## Verification

- `tests/io/claimed-map-validation.test.ts`: `generated: true` / `false`
  accepted and carried through; `"yes"` rejected naming
  `modules[0].generated`; absent key stays absent in the validated map.
- `tests/adapters/adapters-t008.test.ts`: Graphify and Understand-Anything
  nodes with `generated: true/false` pass through to the mapped map;
  non-boolean `generated` rejected naming `nodes[i].generated`.
- Full suite: 193/193. S0 gate: PASS, same hash.
