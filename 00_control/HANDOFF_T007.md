# P024 T007 HANDOFF — TypeScript / Go adapter completion

- Task: T007 (S2, 6h). Status: **COMPLETE — all 4 acceptance items PASS** (verified by real commands below, 2026-11-14 ~15:14 UTC).
- Input commit: `455440a` (S0 PASS, T001–T006 PASS, gate hash `7d4efa1d…`; tree clean at start).
- Output: uncommitted changes, left in the working tree per instructions (NO commit made).
- No external model call was needed; all work was done locally (no WorkBuddy/Qoder call made).

## Output files

| Path | What it is |
|---|---|
| `02_source/src/extractors/typescript/resolve.ts` (modified) | Fix: `pickExportCondition` nested recursion only recurses into object values — a value import can never resolve through the `types` condition (bug #2) |
| `02_source/src/extractors/go/index.ts` (modified) | Fixes: separate core/generated edge dedup sets (bug #1); local replace target escaping the repo (`..` / `../…`) → external (bug #3) |
| `02_source/tests/extractors/boundary.test.ts` | 25 tests: 19 boundary fixtures (extractor + graph + audit) + 5 `resolveExportsTarget` unit tests + 1 symlink-boundary documenting test |
| `02_source/tests/fixtures/boundary/` (19 fixtures) | Each: `repo/` + hand-written `expected.json` + `README.md` (10 TS + 9 Go) |
| `03_evidence/T007/gen-boundary-fixtures.py` | Fixture generator; expectations are literals authored by reasoning, never from extractor output |
| `03_evidence/T007/BOUNDARY_FIXTURES.md` | Fixture list, per-fixture expected status/findings, notes |
| `03_evidence/T007/FIXES.md` | The 3 real bugs found by probing, with cause/fix/regression test each |
| `03_evidence/T007/BOUNDARY_RESULTS.json` | 20/20 audit checks match hand-written expectations (written by the test run) |
| `03_evidence/T007/TEST_RUN.log` | Full-suite verbose log (128/128) |
| `03_evidence/T007/S0_GATE_RERUN.log` | S0 gate re-run log (PASS, same gate hash) |
| `00_control/HANDOFF_T007.md` (this file) | |

No contracts were modified (no spec conflict found). No files outside
the T007 ownership set were touched (`src/extractors/python`,
`src/adapters`, `src/contracts`, `src/graph`, `src/identity`,
`src/comparator`, `src/oracle`, S0 fixtures, goldens untouched).
T008+ not started.

## Acceptance commands — exact results

All run with `TMPDIR=~/workspace/p024-repomapverify/.tmp`.

### 0. Clean build — PASS

```text
$ cd 02_source && rm -rf dist && npm run build   -> tsc -p tsconfig.build.json, exit 0
```

### 1. TypeScript boundaries — PASS (10 fixtures + 5 unit tests)

```text
$ npx vitest run tests/extractors/boundary.test.ts
  (all 10 ts-* fixtures pass; see full-suite log)
```

- Dynamic import(): literal resolves (kind dynamic-import); variable
  and template-with-substitution args → DYNAMIC_IMPORT_UNKNOWN;
  audit INCOMPLETE, never PASS (ts-dyn-import).
- `import type` / `import { type … }` / `export type … from` /
  `export { type … } from` → TYPE_ONLY; mixed `{ type Qux, bar }`
  is a runtime edge (ts-type-imports).
- `.d.ts` files: own imports TYPE_ONLY; value import of a .d.ts
  target is TYPE_ONLY, never runtime (ts-dts).
- `import = require()` handled (kind import-equals); literal
  `require()` resolves; both spellings dedup to one edge
  (ts-import-equals).
- tsconfig paths wildcard (2nd target hits) + exact pattern +
  baseUrl fallback; matched-but-missing alias → ALIAS_NOT_RESOLVED
  (ts-tsconfig-paths).
- package.json exports condition objects: value import via `import`
  (never `types`), `./lib/*` wildcard subpath (ts-exports-conditions).
- **Regression (bug #2, fixed):** types-only exports — value import
  is OUT_OF_SCOPE with no edge; only `import type` resolves via
  `types` (ts-exports-types + 5 `resolveExportsTarget` unit tests).
- Relative extension completion: `.ts` / `.js`→`.ts` / `.jsx`→`.tsx`
  / index.ts / index.tsx; missing target → TARGET_NOT_FOUND
  (ts-ext-completion).
- Out of frozen scope → UNKNOWN, never guessed: alias with no
  tsconfig (ts-out-of-scope-alias); tsconfig `extends` not followed
  (ts-out-of-scope-extends).

### 2. Go boundaries — PASS (9 fixtures + 1 documenting test)

```text
$ npx vitest run tests/extractors/boundary.test.ts
  (all 9 go-* fixtures pass; see full-suite log)
```

- Generated: *.pb.go / *.mock.go (suffix) + stringer output (header)
  marked GENERATED, edges in generatedEdges only; all-generated
  package isGenerated; claiming a generated-only edge →
  GENERATED_MISMATCH, status PASS per the frozen T006 decision
  (go-generated, incl. audit2); unclaimed generated edges are not
  MISSING_EDGEs.
- **Regression (bug #1, fixed):** same package pair imported by a
  generated file AND a hand-written file yields BOTH a core edge and
  a generated edge (go-generated-dedup; previously the core edge was
  silently lost).
- cgo: `import "C"` marks hasCgo; no C-side expansion, not counted
  external, no unknown — audit PASS, not INCOMPLETE on that account
  alone (go-cgo).
- vendor/: resolves to the vendor package node (go-vendor); missing
  vendor/ → external deps counted EXTERNAL (2), not expanded, not
  UNKNOWN (go-vendor-missing).
- Build tags (frozen GOOS=linux/GOARCH=amd64): go1.21 in, go1.26 out,
  `linux && amd64` in, `linux && !amd64` out, legacy `// +build
  linux` in / `windows` out, custom tag → UNDECIDABLE_BUILD_CONSTRAINT
  (excluded + unknown, audit INCOMPLETE) (go-buildtags).
- `_test.go` excluded (TEST_FILE): its imports produce no edge and no
  external count — the test file deliberately imports a different
  in-repo package so wrongful inclusion would show (go-test-files).
- Replace directives honored: local in-repo replace resolves;
  versioned replace to another module → external; **(bug #3, fixed)**
  replace to `../outside` → external, not UNKNOWN (go-replace).
- Package-level nodes: two files → one package node; package-level
  edges only; no file-level / intra-package edges; entrypoint
  reachability over all four packages (go-package-nodes).
- Known boundary NOT fixed (T005 note, recorded): a symlinked `.go`
  file inside a package dir is not a package constituent — locked by
  a documenting test (pkg files == [pkg/a.go], no edge evidenced by
  pkg/b.go); the extractor was not worked around.

### 3. Three-language reports complete — PASS

Every boundary fixture is checked at three levels in
`tests/extractors/boundary.test.ts` against its hand-written
`expected.json`: extractor output, `buildGroundTruthGraphFromRepo`
(modules / edges / reachable / isolated), and `compareMapsDetailed`
(exact status + exact finding set, snapshot MATCH). 20/20 audit
checks match (19 fixtures + go-generated audit2):
`03_evidence/T007/BOUNDARY_RESULTS.json` — 20 fixtures, 20 passed.
(The graph/comparator themselves are T005/T006-owned and were not
modified; T007 exercises them over the new fixtures.)

### 4. Full suite green + S0 gate still green — PASS

```text
$ cd 02_source && npx vitest run --reporter=verbose
  Test Files  8 passed (8); Tests  128 passed (128)
  (103 pre-existing + 25 new T007 tests; log: 03_evidence/T007/TEST_RUN.log)

$ npm --prefix 02_source run s0:gate -- --replays 100   -> exit 0
  THRESHOLDS: parity 48/48; planted 24/24; control false alarms 0/24;
  replay distinct=1; external=0; source writes=0; goldens changed=0
  S0 GATE VERDICT: PASS
  gate hash: 7d4efa1d97798819c2eee29950d57f0d24ffe5961c273f3c9cd37284e7c437cd
  (identical to the T004/T005/T006 gate hash; log: 03_evidence/T007/S0_GATE_RERUN.log)
```

The gate run rewrote `03_evidence/S0/S0_GATE.json` / `.log` with only
new timestamps; both were restored with `git checkout` (same gate
hash). `git status --short` shows only the two modified extractor
files plus T007-owned new files. No golden, fixture, contract,
graph, identity, comparator, or oracle file was modified.

## Real bugs found and fixed (not by weakening anything)

See `03_evidence/T007/FIXES.md` for the full record. Summary:

1. **Go generated/hand dedup** (`src/extractors/go/index.ts`): one
   shared dedup set dropped the core edge when a generated file
   sorted before a hand-written file importing the same target.
   Fixed with separate core/generated dedup sets; regression fixture
   go-generated-dedup.
2. **TS exports `types` fall-through**
   (`src/extractors/typescript/resolve.ts`): nested-condition recursion
   returned the `"types"` string itself, so value imports resolved to
   .d.ts files. Fixed by recursing into object values only; regression
   fixture ts-exports-types + 5 unit tests.
3. **Go replace to `../` outside the repo**
   (`src/extractors/go/index.ts`): returned TARGET_PACKAGE_NOT_FOUND
   (UNKNOWN) instead of external, unlike the absolute-path case.
   Fixed; regression fixture go-replace.

Boundaries probed and found correct (fixtures lock them in): TS
baseUrl-only fallback, paths wildcard 2nd-target, `.d.ts` / type
imports, `.js`→`.ts` mapping, index files, alias-without-tsconfig;
Go vendor resolution, missing vendor → EXTERNAL, cgo marker-only,
`_test.go` exclusion, build tags, package-level nodes.

## Decisions / findings for later tasks

1. **Extractor-side generated marking is complete** (T006 gap note):
   Go suffixes + headers, per-file flags, per-package all-generated
   flag, generatedEdges evidence — all present and tested. What is
   still missing is the *schema* side: the v1 claimed-map schema has
   no generated-ness assertion, so GENERATED_MISMATCH stays edge-level
   only (a claimed generated-only edge is P2 and does not flip PASS,
   per the frozen T006 decision). T008 owns the schema.
2. **INCOMPLETE fixtures carry 0 findings by design** (except the
   dynamic-import fixture): a plain unresolvable import forces
   INCOMPLETE through the status with no invented finding (T006 rule);
   DYNAMIC_IMPORT_UNKNOWN is the exception with its own finding type.
3. **Graph edge merge (T005, confirmed by ts-type-imports):** the
   extractor keeps type-only and runtime spellings of one pair as two
   edges; the graph AND-merges them into one runtime edge. Fixture
   expectations encode both levels explicitly.
4. **Symlinked `.go` file (T005 note):** still not a package
   constituent; now locked by a documenting test, not worked around.

## Next: T008 — Map I/O, privacy redaction & canonical hashing (S2, 4h)

- Owner files: `src/io`, `src/canonical`, `src/privacy`, `src/adapters`, map schema.
- Consume: this handoff, `src/comparator` / `src/findings`
  (GENERATED_MISMATCH is edge-level only — T008 owns the
  generated-ness assertion in the claimed-map schema if it adds one),
  the T007 boundary fixtures + `src/extractors/{typescript,go}`.
- T008 acceptance reminder: claimed-map/v1 schema validation (incl.
  completeness + snapshot fields); Graphify / Understand-Anything /
  Aider adapters complete; absolute-path redaction; canonical hash
  (NFC first, then sort) stable and over normalized semantic results
  only.
- Do NOT touch: extractors/python, extractors/typescript,
  extractors/go, graph, identity, comparator, oracle, fixtures,
  goldens (T007 ownership is `src/extractors/{typescript,go}` +
  `tests/extractors` + boundary fixtures).
