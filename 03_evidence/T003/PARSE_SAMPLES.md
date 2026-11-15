# T003 — Deterministic parse samples

Runner: `02_source/scripts/poc-samples-t003.mjs`
Inputs: `03_evidence/T003/samples/{ts,go}-*/` (fixed repos)
Outputs: `03_evidence/T003/samples/<name>-output.json` (slim extractor output)
Log: `03_evidence/T003/parse-samples.log`
Index with per-sample rationale: `03_evidence/T003/samples/README.md`

## Final run (2026-11-14 ~14:25 GMT)

```text
$ cd 02_source && node scripts/poc-samples-t003.mjs
PASS  go-01 (go) modules=9 edges=6 genEdges=2 external=8 unknowns=0 deterministic=true outHash=046f537c3bcc1462
PASS  go-02 (go) modules=3 edges=2 genEdges=0 external=1 unknowns=0 deterministic=true outHash=67ce2cfd329bb4d3
PASS  go-03 (go) modules=2 edges=1 genEdges=0 external=2 unknowns=0 deterministic=true outHash=59d70c3a95bb9ff3
PASS  go-04 (go) modules=2 edges=1 genEdges=0 external=2 unknowns=0 deterministic=true outHash=182564f0e42d7c20
PASS  go-05 (go) modules=2 edges=1 genEdges=0 external=0 unknowns=2 deterministic=true outHash=cb4d3d8615e85bb1
PASS  go-05-nomod (go) modules=1 edges=0 genEdges=0 external=0 unknowns=1 deterministic=true outHash=21cd48e1f70089e4
PASS  go-06 (go) modules=3 edges=2 genEdges=1 external=0 unknowns=0 deterministic=true outHash=d39eb76d443b74ec
PASS  ts-01 (typescript) modules=11 edges=9 genEdges=0 external=1 unknowns=1 deterministic=true outHash=8a88f61a629118fc
PASS  ts-02 (typescript) modules=8 edges=6 genEdges=0 external=0 unknowns=0 deterministic=true outHash=f1a68c0b0d88aa46
PASS  ts-03 (typescript) modules=4 edges=3 genEdges=0 external=0 unknowns=0 deterministic=true outHash=d2135e76e12d3476
PASS  ts-04 (typescript) modules=3 edges=2 genEdges=0 external=0 unknowns=0 deterministic=true outHash=566d73558e900fbd
PASS  ts-05 (typescript) modules=2 edges=1 genEdges=0 external=0 unknowns=2 deterministic=true outHash=60460d4ad5fdc881
PASS  ts-06 (typescript) modules=4 edges=2 genEdges=0 external=0 unknowns=0 deterministic=true outHash=8320c5469a3165e3

SAMPLES: 13 samples, 13 pass, 0 fail
```

13 samples = 6 TypeScript + 7 Go (go-05-nomod is a 7th Go case: no go.mod).
Each sample was extracted twice; both runs byte-identical
(`deterministic=true`, output hash recorded per sample).

## Bugs the samples caught (fixed, re-verified)

1. `import foo = require("./b")` produced no edge: the `source` field
   lives on the `import_require_clause`, not the `import_statement`.
   Fixed in `src/extractors/typescript/index.ts` (fall back to the
   clause's source field). ts-02 then passes 6/6 edges.
2. package.json exports `{"types": ..., "import": ...}` resolved a VALUE
   import to the `types` target (a .d.ts → wrong TYPE_ONLY edge).
   Fixed in `src/extractors/typescript/resolve.ts`: value imports resolve
   via import/require/default only; type-only imports prefer `types`.
   ts-06 then passes with 0 type-only edges.

## Independent cross-check

go-01 (kitchen sink) was cross-checked against real `go list ./...`
(Go 1.25.5, `GOPROXY=off`): package list and per-package import lists
agree exactly, modulo the deliberate GENERATED exclusion (go list shows
gen→store / onlygen→store as real imports; the extractor correctly
files them under generatedEdges, not core edges). Note: the replaced
directory needed its own go.mod (`third_party/shared/go.mod`) for
`go list` to accept the replace — the extractor does not require it.
