# T007 — Extractor bugs found by boundary probing (all fixed, all with regression tests)

Probing was done with throwaway scripts in /tmp against the T003
extractors BEFORE writing fixtures, so the fixtures' expectations were
authored against the spec, not against buggy output. All three bugs
were confirmed by direct probe output, fixed in T007-owned files only,
and re-probed + regression-tested.

## 1. Go: generated/hand edge dedup lost the core edge (real bug)

**File:** `02_source/src/extractors/go/index.ts`

**Symptom (probe):** package `pkg` with `a.pb.go` (generated, imports
`example.com/m/target`, sorts first) and `z.go` (hand-written, imports
the same target) produced core edges `[]` and generatedEdges
`[[pkg, target]]` — the real hand-written edge vanished from the
ground truth, so a correct claimed edge would have been reported as a
generated-only / missing edge.

**Cause:** one shared `seenEdge` set keyed by package pair for both
core and generated edges; whichever file sorted first won.

**Fix:** separate dedup sets (`seenCoreEdge`, `seenGeneratedEdge`);
the same package pair now legitimately appears in both lists.

**Regression test:** `go-generated-dedup` fixture (core AND generated
edge present; audit PASS, 0 findings) in boundary.test.ts.

## 2. TS: value import resolved through the `types` export condition (real bug — T003 bug class)

**File:** `02_source/src/extractors/typescript/resolve.ts`
(`pickExportCondition`)

**Symptom (probe):** with
`package.json` exports `{".": {"types": "./dist/types.d.ts"}}`, a VALUE
import of the package resolved to `dist/types.d.ts` as a TYPE_ONLY
edge — a runtime import pointing at a declaration file.

**Cause:** after the condition-preference loop found no
import/require/default key, the nested-condition recursion iterated
over ALL values including strings, and returned the `"types"` string
itself as a candidate target.

**Fix:** nested recursion now recurses into OBJECT values only
(`typeof v === "object" && v !== null`); a string under an unselected
condition key is never returned. A type-only import still prefers
`types` first (unchanged path).

**Regression tests:** `ts-exports-types` fixture (value import →
OUT_OF_SCOPE unknown, no edge; type-only import → TYPE_ONLY edge via
`types`) + 5 unit tests on `resolveExportsTarget` (types-only /
nested types-only / nested import+types / type-only import / condition
order) in boundary.test.ts.

## 3. Go: replace to a `../` path outside the repo returned UNKNOWN (consistency bug)

**File:** `02_source/src/extractors/go/index.ts` (`resolveImport`)

**Symptom (probe):** `replace example.com/d => ../outside-d` produced
`TARGET_PACKAGE_NOT_FOUND` (UNKNOWN → audit INCOMPLETE), while an
absolute local replace target already returned `external` in the same
function.

**Cause:** only absolute (`/...`) local replace targets were treated
as outside-the-repo; a `../` target fell through to a directory
existence check against a path outside the repo.

**Fix:** a normalized local replace target of `..` or starting with
`../` returns `external` (counted, not expanded, not UNKNOWN),
consistent with the absolute-path case.

**Regression test:** `go-replace` fixture (local replace resolves;
versioned replace to another module → external; `../` replace →
external; externalImportCount 2; audit PASS).

## Boundaries probed and found CORRECT (no change; fixtures lock them in)

- TS baseUrl-only (no `paths`): resolves via baseUrl fallback
  (`paths` defaults to `{}` in the loader, so the fallback runs).
- TS paths wildcard with a missing first target: second target tried.
- TS `import = require`, literal `require()`, variable `require()` →
  DYNAMIC_IMPORT_UNKNOWN.
- TS `.d.ts` handling, `import type` / mixed clauses, `.js`→`.ts`
  mapping, index files, alias-without-tsconfig → ALIAS_NOT_RESOLVED.
- Go vendor/ resolution, missing vendor → EXTERNAL, cgo (`import "C"`
  is a marker only: no edge, no external count, no unknown; audit
  PASS), `_test.go` exclusion, build tags incl. `go1.N` and legacy
  `// +build`, package-level nodes.
- No S0 fixture depends on any changed behaviour: the S0 gate re-run
  is still PASS with the identical gate hash (see S0_GATE_RERUN.log).
