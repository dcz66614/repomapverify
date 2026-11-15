# P024 T008 HANDOFF — Map I/O, privacy redaction & canonical hashing

- Task: T008 (S2, 4h). Status: **COMPLETE — all 6 acceptance items PASS** (verified by real commands below, 2026-11-14 ~15:31 UTC).
- Input commit: `966464c` (S0 PASS, T001–T007 PASS, gate hash `7d4efa1d…`; tree clean at start).
- Output: uncommitted changes, left in the working tree per instructions (NO commit made).
- No external model call was needed; all work was done locally (no WorkBuddy/Qoder call made).

## Output files

| Path | What it is |
|---|---|
| `02_source/src/io/validate-claimed-map.ts` (+ `index.ts`) | Strict claimed-map/v1 validator: exact schema value, required mapId/repo/completeness/repoSnapshotSha256/modules/entrypoints/edges, 64-hex snapshot, safe relative paths only, unknown/mistyped fields are errors NAMING the field, exit-code class 3 (`CLAIMED_MAP_INPUT_EXIT_CODE`); documented snake_case aliases (`map_id` etc.) accepted only with an explicit warning, conflicting spellings rejected; optional `generated` boolean; error messages redacted so no absolute path/username can leak |
| `02_source/src/privacy/redact.ts` (+ `index.ts`) | Privacy redaction at the I/O boundary: repo-root paths → relative, home-dir paths → `~/…`, other absolute paths (POSIX + Windows) → `<redacted-absolute-path>`, username as a whole word → `<user>`; `redactText` / `redactValue` / `redactForOutput` / `findLeaks` (reports kind + JSON path only, never the sensitive text) |
| `02_source/src/adapters/` (all 5 files modified) | Strict consumed-field validation per adapter (rejections name the field), `generated` passthrough, redacted notes, post-mapping validation through the SAME validator as native input (`finishMapping`); `mapInput("claimed-map-v1")` now validates instead of erroring "needs no mapping" |
| `02_source/src/canonical/index.ts` (modified) | Frozen snapshot algorithm in words + code (`CANONICAL_SNAPSHOT_ALGORITHM`, `canonicalSnapshotLines` — NFC first, then sort, normalized path written in the line); `stripVolatileFields` + `VOLATILE_HASH_KEYS` + `canonicalSemanticHash` (hash only over normalized semantic results) |
| `02_source/src/contracts/claimed-map.ts` (modified, +13 lines) | **The one contract change in T008:** optional `generated?: boolean` on `ClaimedModuleRef` — see GENERATED_MISMATCH decision below. No other contract touched |
| `02_source/src/index.ts` (modified, +3 lines) | Barrel now also exports `io`, `privacy`, `adapters` |
| `02_source/tests/io/claimed-map-validation.test.ts` | 24 tests, incl. all 48 S0 fixture claimed maps validating |
| `02_source/tests/privacy/redact.test.ts` | 8 tests, incl. the realistic `/home/alice/…` leak test |
| `02_source/tests/adapters/adapters-t008.test.ts` | 26 tests: strictness, post-mapping validation, `generated`, redacted notes |
| `02_source/tests/canonical/canonical-t008.test.ts` | 7 tests: snapshot equality on all 16 Python fixtures, symlink collapse, semantic-hash stability |
| `03_evidence/T008/TEST_RUN.log` | Full-suite verbose log (193/193) |
| `03_evidence/T008/S0_GATE_RERUN.log` | S0 gate re-run log (PASS, same gate hash) |
| `03_evidence/T008/ADAPTER_SHAPES.md` | Adapter upstream-shape documentation (assumed shapes, what falsifies each) |
| `03_evidence/T008/GENERATED_MISMATCH_DECISION.md` | GENERATED_MISMATCH decision record |
| `03_evidence/T008/SNAPSHOT_FREEZE.md` | Canonical snapshot freeze record |
| `00_control/HANDOFF_T008.md` (this file) | |

No extractor, graph, identity, comparator, findings, oracle, fixture, or
golden file was modified. No T009+ work started.

## Acceptance commands — exact results

All run with `TMPDIR=~/workspace/p024-repomapverify/.tmp`.

### 0. Clean build — PASS

```text
$ cd 02_source && rm -rf dist && npm run build   -> tsc -p tsconfig.build.json, exit 0
```

### 1. Schema validation — PASS (24/24 in tests/io/claimed-map-validation.test.ts)

```text
$ npx vitest run tests/io/claimed-map-validation.test.ts
  Test Files  1 passed (1); Tests  24 passed (24)
```

- Exact `schema` value enforced; missing `completeness` / `repoSnapshotSha256`
  are errors ("never guessed"); malformed snapshot (not 64-hex) rejected.
- Unknown top-level / module / edge fields are errors listing the offending
  field (`bogusField`, `modules[0].weight`, `edges[0].weight`); mistyped
  fields likewise (`modules[0].kind`, `edges[0].to`, `entrypoints[0]`).
- Absolute / `..` paths rejected; the error message never echoes the path
  (asserted: no `/home/alice`, no `alice` in the serialized errors).
- Duplicate module id/path are errors; duplicate edge is a warning + dedupe.
- Go root `"."` accepted as a module/entrypoint path.
- **All 48 S0 fixture claimed maps validate** (16 Python fixtures each carry
  exactly one warning for the documented snake_case `map_id` alias; TS/Go
  use camelCase `mapId` — see "Decisions" below).

### 2. Adapters complete — PASS (26/26 in tests/adapters/adapters-t008.test.ts)

```text
$ npx vitest run tests/adapters/adapters-t008.test.ts
  Test Files  1 passed (1); Tests  26 passed (26)
```

- T002 PoC samples still map identically (Graphify: 2 EXTRACTED edges,
  1 INFERRED dropped; UA: 1 static edge, 2 dropped; Aider text forces
  PARTIAL_SUBGRAPH, no edges) — regression guards in the same file.
- Strictness (each a rejection naming the field): node without a string
  `path` (`nodes[i].path`), `kind` outside module|package, non-boolean
  `generated`, duplicate module path / node id, EXTRACTED/static edge with
  a missing endpoint (`edges[i].from`/`.to`), conflicting `from`/`source`
  spellings, absolute endpoint, non-string entrypoint/repo/agent, Aider
  JSON non-string `files[i]` / unknown top-level key / absolute path.
- Every adapter runs the SAME claimed-map/v1 validator over its mapped map
  (`finishMapping`); a malformed snapshot is rejected via post-mapping
  validation (`repoSnapshotSha256`).
- `generated: true/false` passes through from Graphify and UA nodes;
  `mapInput("claimed-map-v1")` now validates native input instead of
  erroring "needs no mapping".
- Dropped-edge notes and error messages never leak an absolute path or
  username (asserted with `/home/alice/…` inputs).
- Upstream shapes remain DOCUMENTED ASSUMPTIONS (no verified real
  Graphify graph.json / .ua sample / current Aider output was available):
  precise shapes + what would falsify each are in
  `03_evidence/T008/ADAPTER_SHAPES.md` and in each adapter's header.

### 3. Privacy redaction — PASS (8/8 in tests/privacy/redact.test.ts)

```text
$ npx vitest run tests/privacy/redact.test.ts
  Test Files  1 passed (1); Tests  8 passed (8)
```

- Realistic test: a report containing `/home/alice/work/billing-service/…`
  paths and the username `alice` (in paths, in prose, as a repo-root field)
  redacts to relative paths / `~/…` / `<user>`; the output JSON contains
  neither `/home/alice` nor `alice`, and `findLeaks` returns `[]`.
- Windows paths (`C:\Users\alice\…`, `C:/…`) redacted; unknown-root absolute
  paths become `<redacted-absolute-path>`; `https` URLs untouched,
  `file://` URLs redacted; a username inside an ordinary word (`sample`
  vs user `sam`) is not touched; redaction never mutates its input;
  `findLeaks` reports kind + JSON path only, never the sensitive text.

### 4. Canonical hash frozen — PASS (7/7 in tests/canonical/canonical-t008.test.ts)

```text
$ npx vitest run tests/canonical/canonical-t008.test.ts
  Test Files  1 passed (1); Tests  7 passed (7)
```

- Snapshot algorithm frozen: SHA-256 over sorted lines
  `relativePath + NUL + contentSha256 + "\n"` (NFC first, then sort;
  `CANONICAL_SNAPSHOT_ALGORITHM`, `canonicalSnapshotLines`,
  `computeCanonicalSnapshotSha256`).
- **Verified on all 16 Python fixtures:** the canonical snapshot computed
  from an INDEPENDENT file walk equals the Python extractor's snapshot,
  the graph snapshot, AND the snapshot bound in each fixture's claimed map
  (16/16, zero mismatches).
- **Symlink behavior (T005 note, frozen):** real temp repo with
  `pkg/mod.py` + symlink `aliasmod.py` — graph snapshot equals the
  canonical hash over the collapsed file list (one line, canonical
  spelling); extractor snapshot equals the canonical hash over the
  uncollapsed list (both spellings); the two hashes DIFFER, deliberately.
  The shipped snapshot is the graph (collapsed) form.
- `canonicalSemanticHash`: same semantic graph → same hash under shuffled
  order and NFD-vs-NFC spellings; content change moves the hash, never any
  module_id; volatile fields (timestamp, durations, temp dir, run id,
  absolute repo root) never move it; the same result under
  `/home/alice/…` vs `/home/bob/…` hashes identically once redacted with
  the respective repo roots (and differently without redaction — the
  normalize-first precondition is documented).

### 5. GENERATED_MISMATCH decision — DECIDED (option A)

**Add an OPTIONAL `generated` boolean assertion to module entries**
(`ClaimedModuleRef.generated` in `src/contracts/claimed-map.ts`).
`true` = agent asserts generated code; `false` = asserts hand-written;
absent = NO assertion (module-level GENERATED_MISMATCH is not judged).
Full reasoning in `03_evidence/T008/GENERATED_MISMATCH_DECISION.md`.

Why this option: backward-compatible by construction (all 48 fixtures omit
it; suite 193/193; S0 gate same hash); the ground-truth side already marks
generated code (T007 completed it), only the claimed side lacked its
assertion; absent is explicitly "no assertion", never silently defaulted to
`false` (that would manufacture findings from ignorance). The alternative —
record as a known v1 limitation — was rejected: it would leave the
comparator rule undefinable while the input it needs costs nothing.

What it does NOT do: no module-level GENERATED_MISMATCH comparator rule was
added (comparator is T006-owned, out of scope). The rule is now definable
and is follow-up work: when a claimed module asserts `generated: X` and
ground truth says `isGenerated` is `!X`, that is a module-level
GENERATED_MISMATCH (suggested P2, per spec §5.2; whether it flips PASS is
the follow-up's decision — the edge-level rule does not flip PASS).

### 6. Full suite green + S0 gate still green — PASS

```text
$ cd 02_source && npx vitest run --reporter=verbose
  Test Files  12 passed (12); Tests  193 passed (193)
  (128 pre-existing + 65 new T008 tests; log: 03_evidence/T008/TEST_RUN.log)

$ npm --prefix 02_source run s0:gate -- --replays 100   -> exit 0
  THRESHOLDS: parity 48/48; planted 24/24; control false alarms 0/24;
  replay distinct=1; external=0; source writes=0; goldens changed=0
  S0 GATE VERDICT: PASS
  gate hash: 7d4efa1d97798819c2eee29950d57f0d24ffe5961c273f3c9cd37284e7c437cd
  (identical to the T004/T005/T006/T007 gate hash; log: 03_evidence/T008/S0_GATE_RERUN.log)
```

The gate run rewrote `03_evidence/S0/S0_GATE.json` / `.log` with only new
timestamps; both were restored with `git checkout` (same gate hash).
`git status --short` shows only T008-owned files (see "Output files").
No golden, fixture, extractor, graph, identity, comparator, or oracle
file was modified.

## Real bugs / false alarms found by the tests (fixed in T008 code, not by weakening anything)

1. **Gate `external=1` false positive — a comment, not a request.**
   The first S0 re-run failed ONLY on `external=1` (all other thresholds
   green, same gate hash). Cause: the gate's no-external-request proof is a
   naive grep for `https?://` over `src`, and my comment in
   `src/privacy/redact.ts` contained the literal string `` `https://...` ``.
   No code in T008 makes any network call (no fetch/http imports). Fixed by
   rewording the comment to "HTTP(S) URLs"; the re-run passed with
   `external=0`. Lesson for later tasks: never write a literal URL scheme
   (`https://`, `http://`) or a `fetch(` call in `src/` or `scripts/` —
   the gate greps for them. (The privacy test file legitimately contains an
   `https://example.com` string, but tests are outside the grep scope.)
2. **`canonicalSnapshotLines` wrote the raw path.** The first version sorted
   by the NFC-normalized path but wrote the raw spelling into the line, so
   an NFD input hashed differently from its NFC twin and the NFD test
   failed. Fixed: the function normalizes the path (NFC) before writing
   the line. The extractor and graph already feed it normalized paths, so
   the 16-fixture equality still holds.
3. **Redactor re-redacting its own `~/…` output.** The first version's
   absolute-path regex matched the `/` in a just-produced `~/…` path, and a
   bare home dir at end-of-string was not replaced. Fixed with a proper
   prefix matcher (`replaceRootPrefix`: root + separator, or root at end)
   and by adding `~` to the regex lookbehind exclusions. Caught by the
   privacy tests, not by inspection.

## Decisions T009+ must know (all documented in code + evidence)

1. **snake_case vs camelCase map fields (unresolved spec tension).**
   PROJECT_BOOK §6.1 spells the map fields `map_id` / `repo_snapshot_sha256`
   / `git_commit`; the frozen interface contract (PLAN §4.1) spells them
   `mapId` / `repoSnapshotSha256` / `gitCommit` — and the 48 fixtures are
   split (16 Python use `map_id`, 32 TS/Go use `mapId`). v1 does NOT pick
   one spelling: the validator and the adapters accept a snake_case alias
   ONLY with an explicit warning naming the alias, and reject conflicting
   spellings when both are present with different values. A future v2
   should freeze a single spelling; until then the warning keeps the
   bridge explicit, never silent.
2. **Validator strictness choices.** Duplicate module id/path = error
   (identity ambiguity); duplicate edge = warning + dedupe (harmless
   redundancy); duplicate entrypoint = warning + dedupe. `modules: []`
   with zero modules is schema-valid (degenerate, but the comparator, not
   the validator, judges it). `repoSnapshotSha256` must be 64-char
   lowercase hex; `gitCommit` 40- or 64-hex. Error messages redact values
   via the privacy layer.
3. **Adapter strictness asymmetry (deliberate).** Graphify / UA unknown
   top-level keys are IGNORED (real upstream formats may carry version /
   metadata fields we do not consume), but every consumed field is
   validated strictly. Aider JSON is our own interchange shape, so unknown
   top-level keys are REJECTED there. Provenance drops (INFERRED edges,
   non-static origins) stay drop-and-count — a defined rule, not ambiguity.
4. **Privacy redaction scope.** Username redaction is whole-word only
   (`\b<username>\b`); a bare username inside ordinary prose words is
   untouched. `findLeaks` is a test/diagnostic helper only — it never
   writes to a report, and it returns kinds + JSON paths, never the
   sensitive text. The I/O boundary for T009: validator errors and adapter
   notes are already redacted; the report layer must run `redactForOutput`
   over anything it emits.
5. **Canonical hash contract for T009.** Report hashing must go through
   `canonicalSemanticHash` on an already-normalized semantic result (NFC
   paths, relative paths only); pass `redactOpts` (`{ repoRoot, homeDir }`)
   when the result may still carry absolute paths. The volatile-key list
   (`VOLATILE_HASH_KEYS`) is closed and explicit — a key not on it is
   hashed.
6. **Contract change in T008.** The ONLY contract edit is the optional
   `generated?: boolean` on `ClaimedModuleRef` (+13 lines incl. doc).
   It is backward-compatible and authorized by this task's acceptance
   item 5; it is reported here explicitly, not silently.

## Next: T009 — CLI main flow + static HTML report (S3, 7h)

- Owner files: `src/cli`, `src/report`, static HTML.
- Consume: this handoff, `src/io` (`validateClaimedMap`,
  `parseClaimedMapJson`, `CLAIMED_MAP_INPUT_EXIT_CODE` = 3 for
  usage/input errors), `src/privacy` (`redactForOutput` over everything
  the report emits), `src/canonical` (`canonicalSemanticHash` for the
  report hash), `src/adapters` (`mapInput` dispatch incl. validated
  native claimed-map/v1), the `generated` module assertion (a
  module-level GENERATED_MISMATCH comparator rule is now definable —
  implement it in the comparator as follow-up work, or leave it for a
  FIX task; see item 5 above).
- T009 acceptance reminder: one command runs; JSON + single-file offline
  HTML (claimed left, ground-truth right; red = invented/wrong, yellow =
  undetermined, green = verified; click an edge for source path, line,
  import statement; no graph database); exit codes strictly match status.
- Do NOT touch: extractors, graph, identity, comparator, findings,
  oracle, fixtures, goldens (T008 ownership is `src/io`,
  `src/canonical`, `src/privacy`, `src/adapters`, map schema + tests).
