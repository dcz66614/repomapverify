# T003 deterministic parse samples

13 sample repos (6 TypeScript + 7 Go; go-05-nomod is an extra no-go.mod case),
each with a recorded extractor output (`<name>-output.json`, slim form:
modules with module_id/content_sha256, edges with evidence, generated
edges, external count, unknowns, excluded files).

Run: `cd 02_source && node scripts/poc-samples-t003.mjs`
(extracts each sample twice and asserts byte-identical output).

## TypeScript

| Sample | What it proves | Expected outcome |
|---|---|---|
| ts-01 | Kitchen sink: alias paths, package.json exports, `import type`, require, literal + variable dynamic import, `.js` specifier, external `react` | 11 modules, 9 edges (1 type-only), external 1, 1 unknown DYNAMIC_IMPORT_UNKNOWN |
| ts-02 | `import = require`, `export * as ns`, mixed `import def, {type T}` (runtime edge), deep relative `../../` | 8 modules, 6 edges (1 type-only) |
| ts-03 | `.mts` + TSX (JSX), no `type: module` tricks | 4 modules, 3 edges |
| ts-04 | baseUrl-only bare resolution (`lib/x` with baseUrl `.`, no paths) | 3 modules, 2 edges |
| ts-05 | UNKNOWN cases: `@/missing` with no tsconfig (ALIAS_NOT_RESOLVED), `./does-not-exist` (TARGET_NOT_FOUND) | 2 modules, 1 edge, 2 unknowns |
| ts-06 | package.json exports with condition objects (`types`/`import`/`default`, nested `node` condition); value imports never resolve through `types` | 4 modules, 2 edges (0 type-only) |

## Go

| Sample | What it proves | Expected outcome |
|---|---|---|
| go-01 | Kitchen sink: multi-file package, replace directive, generated + cgo, build tags, `_test.go` exclusion | 9 packages, 6 core edges, 2 generated edges, external 8, excluded 2 |
| go-02 | Legacy `// +build` lines (linux in, windows out), aliased + blank imports | 3 packages, 2 edges, external 1, excluded 1 |
| go-03 | Versioned replace to another module path (`=> example.com/renamed v2.0.0`) → external | 2 packages, 1 edge, external 2 |
| go-04 | `go1.N` tags (go1.21 in, go1.99 out) + compound `linux && (amd64 \|\| arm64)` | 2 packages, 1 edge, external 2, excluded 1 |
| go-05 | Undecidable custom tag (`//go:build mytag`) → UNKNOWN + excluded; missing in-module package → TARGET_PACKAGE_NOT_FOUND | 2 packages, 1 edge, 2 unknowns, excluded 1 |
| go-05-nomod | No go.mod at all: non-stdlib import → NO_GO_MOD | 1 package, 0 edges, 1 unknown |
| go-06 | `.mock.go` + stringer generated headers, `_test.go` excluded, `testdata/` skipped entirely | 3 packages, 2 core edges, 1 generated edge, excluded 1 |

## Notes

- `.mjs` files are OUT of the frozen scope (extension completion is
  `.ts/.tsx/.js/.jsx`); ts-03 uses `.mts` instead.
- go-01 cross-checked against real `go list ./...` (Go 1.25.5): package
  list and import lists agree exactly, modulo the deliberate GENERATED
  exclusion (go list shows gen→store / onlygen→store as real imports;
  the extractor correctly files them under generatedEdges, not core).
