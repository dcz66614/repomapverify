# P024 T003 HANDOFF — TypeScript + Go extraction PoC

- Task: T003 (S0, 5h). Status: **COMPLETE — all 5 acceptance criteria PASS** (verified by real commands below, 2026-11-14 ~14:26 GMT).
- Input commit: `eecdd4b` (T001 PASS; working tree also contains the sibling T002 agent's uncommitted Python work — untouched).
- Output: uncommitted changes, left in the working tree per instructions (NO commit made).

## Output files

| File | What it is |
|---|---|
| `02_source/src/extractors/typescript/parser.ts` | tree-sitter TS/TSX grammar loader + string-literal helpers |
| `02_source/src/extractors/typescript/resolve.ts` | tsconfig paths/baseUrl + package.json exports + relative extension completion; out-of-scope → UNKNOWN |
| `02_source/src/extractors/typescript/index.ts` | TS extractor: import/export-from/require/dynamic-import/import-equals, TYPE_ONLY, DYNAMIC_IMPORT_UNKNOWN |
| `02_source/src/extractors/go/parser.ts` | tree-sitter-go grammar loader + import-spec helpers |
| `02_source/src/extractors/go/gomod.ts` | go.mod parser (module/go/replace/require) |
| `02_source/src/extractors/go/buildtags.ts` | `//go:build` + legacy `// +build` evaluator for GOOS=linux/GOARCH=amd64; undecidable → UNKNOWN |
| `02_source/src/extractors/go/index.ts` | Go extractor: package-level nodes, replace/vendor resolution, GENERATED/CGO marking, `_test.go` exclusion |
| `02_source/scripts/poc-audit-t003.mjs` | PoC audit runner: extractor vs hand-written golden (field-by-field) + minimal FULL_GRAPH audit, 32 fixtures |
| `02_source/scripts/poc-samples-t003.mjs` | Parse-sample runner: 13 samples, each extracted twice, determinism + hand-reasoned expectations asserted |
| `02_source/tests/fixtures/s0/typescript/` (16 fixtures) | 8 control + 8 planted, each with repo/ + claimed-map.json + golden.json + README.md |
| `02_source/tests/fixtures/s0/go/` (16 fixtures) | 8 control + 8 planted, same layout |
| `03_evidence/T003/gen-fixtures.py` | Fixture generator (goldens are literal data in this script, authored by reasoning — never from extractor output) |
| `03_evidence/T003/samples/` | 13 deterministic parse-sample repos + `<name>-output.json` + README.md |
| `03_evidence/T003/GO_INSTALL.md` | Go 1.25.5 install record (official checksum verified) |
| `03_evidence/T003/PARSE_SAMPLES.md` | Sample results + 2 bugs the samples caught |
| `03_evidence/T003/FIXTURES.md` | Fixture list, planted-class mapping, golden correction record |
| `03_evidence/T003/POC_RUN.md` | PoC audit log + determinism note + run history |
| `03_evidence/T003/poc-audit-final.json` / `.log` | Final PoC audit report + log (32/32) |
| `03_evidence/T003/poc-audit-final-2.json` | Second run, identical modulo timestamp |
| `03_evidence/T003/parse-samples.log` | Final sample run log (13/13) |
| `00_control/HANDOFF_T003.md` (this file) | |

No contracts were modified (no spec conflict found). No files outside
the T003 ownership set were touched (`src/extractors/python`,
`src/adapters`, T002 fixture dirs untouched). T004+ not started.

## Acceptance commands — exact results

### 0. Go install — PASS

```text
$ curl -fsSL -o go.tar.gz https://go.dev/dl/go1.25.5.linux-amd64.tar.gz
$ tar -C ~/workspace/.local -xzf go.tar.gz
$ sha256sum go.tar.gz
9e9b755d63b36acf30c12a9a3fc379243714c1c6d3dd72861da637f336ebb35b
  == official go.dev/dl/?mode=json&include=all entry for go1.25.5.linux-amd64.tar.gz
$ export PATH=$HOME/workspace/.local/go/bin:$PATH; go version
go version go1.25.5 linux/amd64
```

### 1. TypeScript extractor — PASS

Covers import / export ... from / require / dynamic import() /
import = require; tsconfig paths + baseUrl + package.json exports;
relative extension completion (.ts/.tsx/.js/.jsx, index files).
Out-of-scope → UNKNOWN (e.g. `@/x` with no tsconfig →
ALIAS_NOT_RESOLVED; missing relative target → TARGET_NOT_FOUND).
Literal dynamic import() resolves; variable argument →
DYNAMIC_IMPORT_UNKNOWN. `import type` / `.d.ts` → TYPE_ONLY edges.
Value imports never resolve through the package.json `types` export
condition (bug found by sample ts-06, fixed).

### 2. Go extractor — PASS

Covers import blocks + go.mod module-path parsing incl. replace
directives (local + versioned-to-other-module) and vendor/.
Nodes are PACKAGES (multi-file aggregation, files = composition
evidence; intra-package refs produce no edge). Frozen default build
tags GOOS=linux/GOARCH=amd64 (incl. `go1.N` and legacy `// +build`);
undecidable constraints → UNKNOWN. Generated files (*.pb.go,
*.mock.go, "Code generated" headers) marked GENERATED, edges in
generatedEdges (excluded from core). cgo files marked CGO, no C-side
expansion. `_test.go` excluded; `testdata/` skipped.
Cross-check: real `go list ./...` (Go 1.25.5, GOPROXY=off) on the
kitchen-sink sample agrees exactly with the extractor, modulo the
deliberate GENERATED exclusion.

### 3. Parse samples — PASS (13 samples: 6 TS + 7 Go)

```text
$ cd 02_source && node scripts/poc-samples-t003.mjs
SAMPLES: 13 samples, 13 pass, 0 fail
```

Every sample extracted twice, byte-identical output (determinism
asserted in-run; output hashes in the log). Inputs + slim outputs in
`03_evidence/T003/samples/`. Two real extractor bugs were found and
fixed by these samples (import-equals source field; exports `types`
condition preference) — see PARSE_SAMPLES.md.

### 4. Fixtures — PASS (16 TS + 16 Go; 8 control + 8 planted each)

```text
$ cd 02_source && node scripts/poc-audit-t003.mjs --out ../03_evidence/T003/poc-audit-final.json
SUMMARY: 32 fixtures, parity 32/32, audit 32/32, control PASS 16/16, planted detected 16/16
```

Per-language planted classes: TS covers all 8 menu classes exactly.
Go covers 6 menu classes + 2 documented analogues (dynamic-import →
build-tag-misread; re-export → transitive-closure; alias = replace
directive). Golden Expected Graphs are hand-written literals in
`gen-fixtures.py`; one golden error was found and corrected by
re-reasoning (go-ctrl-07 externalImportCount 2 → 3), never by copying
extractor output.

### 5. PoC audit — PASS

Production extractor output matches the hand-written Golden Expected
Graphs field-by-field on all 32 fixtures (modules incl. module_id /
content_sha256 recomputed via frozen contracts, edges incl. typeOnly,
generated edges, external count, unknowns, excluded files), and the
minimal FULL_GRAPH audit yields the golden status + finding set on all
32 (16/16 control PASS with 0 findings; 16/16 planted detected).
Audit run twice: reports identical modulo timestamp.

## Other verification

```text
$ cd 02_source && npm run build
src/extractors/python/parser.ts(56,14): error TS2304: Cannot find name 'SyntaxNode'.
  -> the ONLY build error is the sibling T002 agent's in-progress python
     file (not mine, not touched). My TS + Go extractors compile clean
     (dist/extractors/{typescript,go}/*.js present).

$ cd 02_source && npm test   (vitest run; sibling T002's tests)
Test Files  2 passed (2); Tests  37 passed (37)
  -> my work did not break the sibling's tests.
```

## Notes / caveats for the next tasks

- `externalImportCount` counts import-spec occurrences resolving to
  external (stdlib / third-party), not distinct paths. Documented in
  the extractor; goldens follow it.
- TS bare specifiers that are not plausible package names (e.g. `@/x`
  with no tsconfig) resolve to UNKNOWN (ALIAS_NOT_RESOLVED), not
  external. `@lib/util` (valid scoped-name shape) with no tsconfig is
  still treated as external.
- Go root package stores relativePath `"."`; its module_id is computed
  over the normalized path `""` (normalize strips `.`), per the
  frozen contract function.
- Parse-error Go files stay composition evidence of their package
  (package parseStatus becomes PARSE_ERROR) but contribute no edges.
- The PoC mini-audit in `poc-audit-t003.mjs` is T003-only scaffolding:
  reachability uses runtime (non-typeOnly) edges; NAME_COLLISION is
  detected when a hallucinated edge's target basename matches a
  missing edge's target basename from the same source. T004's
  independent Oracle + S0 gate must not reuse this harness's
  expectations; T006 owns the real comparator.
- No external model call was needed for T003; no WorkBuddy/Qoder call made.

## Next: T004 — Independent Python Oracle + S0 Gate (S0, 5h)

- Owner files: `oracle/python`, `tests/golden/s0`, `scripts/s0-gate`, `evidence/s0`.
- Consume: this handoff, the 32 T003 fixtures + goldens (as INPUT
  fixtures — T004 writes its own independent Oracle and must verify
  the 48-fixture set incl. T002's 16 Python fixtures; T004 must not
  reuse `poc-audit-t003.mjs` logic to generate expectations), the
  extractors (`src/extractors/{typescript,go}` + T002's python one),
  the frozen contracts.
- T004 acceptance reminder: independent Python Oracle + 48 hand-written
  Golden Expected Graphs; 48/48 parity; 24/24 planted detected; 0/24
  control false alarms; 100 replays, 1 gate hash; external requests 0;
  source-dir writes 0.
