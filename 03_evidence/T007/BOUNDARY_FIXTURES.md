# T007 — Boundary fixtures (19 fixtures, 20 audit checks)

Generator: `gen-boundary-fixtures.py` (expectations are literals authored
by reasoning from PROJECT_BOOK §4.4–§4.5, never from extractor output).
Test: `02_source/tests/extractors/boundary.test.ts` — each fixture is
checked at three levels (extractor, ground-truth graph, comparator
audit) against its `expected.json`.

## TypeScript (10 fixtures)

| Fixture | Boundary | Audit status | Findings |
|---|---|---|---|
| ts-dyn-import | literal `import()` resolves; variable + template-substitution args → DYNAMIC_IMPORT_UNKNOWN | INCOMPLETE | DYNAMIC_IMPORT_UNKNOWN (src/main.ts) |
| ts-type-imports | `import type`, `import {type}`, `export type … from`, `export {type} from` → TYPE_ONLY; mixed `{type Qux, bar}` is runtime | PASS | — |
| ts-dts | .d.ts imports are TYPE_ONLY; value import of a .d.ts target is TYPE_ONLY, never runtime | PASS | — |
| ts-import-equals | `import = require()` + literal `require()` → edges (dedup to one, kind import-equals) | PASS | — |
| ts-tsconfig-paths | paths wildcard (2nd target hits), exact pattern, baseUrl fallback; matched-but-missing alias → ALIAS_NOT_RESOLVED | INCOMPLETE | — |
| ts-exports-conditions | exports condition objects: value import via `import` (never `types`); `./lib/*` wildcard subpath | PASS | — |
| ts-exports-types | **regression**: types-only exports — value import OUT_OF_SCOPE (no edge), type-only import resolves via `types` | INCOMPLETE | — |
| ts-ext-completion | `./a`→.ts, `./b.js`→.ts, `./c.jsx`→.tsx, `./d`→index.ts, `./e`→index.tsx; `./nope` → TARGET_NOT_FOUND | INCOMPLETE | — |
| ts-out-of-scope-alias | `@/x` with no tsconfig → ALIAS_NOT_RESOLVED (not external, not guessed) | INCOMPLETE | — |
| ts-out-of-scope-extends | tsconfig `extends` not followed; alias defined only in base.json → ALIAS_NOT_RESOLVED; relative import still resolves | INCOMPLETE | — |

## Go (9 fixtures)

| Fixture | Boundary | Audit status | Findings |
|---|---|---|---|
| go-generated | *.pb.go / *.mock.go / stringer output → GENERATED, edges in generatedEdges only; all-generated package isGenerated | PASS | — (audit2 below) |
| go-generated (audit2) | claiming a generated-only edge | PASS | GENERATED_MISMATCH (gen→target) |
| go-generated-dedup | **regression**: same pair imported by generated + hand file → BOTH core and generated edge | PASS | — |
| go-cgo | `import "C"` → hasCgo, no C-side edge, not external, no unknown; audit NOT incomplete on cgo alone | PASS | — |
| go-vendor | vendor/ content resolves the external import to the vendor package node | PASS | — |
| go-vendor-missing | no vendor/ → external deps counted EXTERNAL (2), not expanded, not UNKNOWN | PASS | — |
| go-buildtags | go1.21 in / go1.26 out, `linux && amd64` in / `linux && !amd64` out, legacy `+build linux` in / `windows` out, custom tag → UNDECIDABLE_BUILD_CONSTRAINT | INCOMPLETE | — |
| go-test-files | `_test.go` excluded (TEST_FILE): its imports produce no edge and no external count | PASS | — |
| go-replace | local replace resolves; versioned replace to another module → external; replace to `../outside` → external (T007 fix) | PASS | — |
| go-package-nodes | two files → one package node; package-level edges; no file-level / intra-package edges; entrypoint reachability | PASS | — |

## Notes

- INCOMPLETE fixtures have 0 findings by design: an unresolvable /
  dynamic import forces INCOMPLETE through the audit status (T006
  rule: no finding type fits a plain unresolvable import), except
  DYNAMIC_IMPORT_UNKNOWN, which has its own finding type.
- go-generated audit2 asserts the frozen T006 decision: a claimed
  generated-only edge is GENERATED_MISMATCH (P2) and does NOT flip
  PASS. The v1 claimed-map schema has no generated-ness assertion, so
  there is no module-level GENERATED_MISMATCH rule — that is T008's
  schema work. Extractor-side generated marking is complete (suffixes
  + headers, per-file flags, per-package all-generated flag).
- Known boundary NOT fixed here (T005 note, recorded): a symlinked
  .go file inside a package dir is not a package constituent. Locked
  by a documenting test in boundary.test.ts (pkg files == [pkg/a.go],
  no edge evidenced by pkg/b.go); the extractor was not worked around.
- All 20 audit checks (19 fixtures + go-generated audit2) match their
  hand-written expectations: see BOUNDARY_RESULTS.json.
