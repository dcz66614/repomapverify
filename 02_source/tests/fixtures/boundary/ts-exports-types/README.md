# ts-exports-types — value imports never resolve via `types` (§4.4)

REGRESSION test for the T003 bug class (exports `types` condition
preference): with exports `{".": {"types": "./dist/types.d.ts"}}`,
a VALUE import is OUT_OF_SCOPE (unknown, no edge); only the
`import type` spelling resolves through `types`, to a TYPE_ONLY edge.
Audit is INCOMPLETE (unresolvable value import), findings [].
