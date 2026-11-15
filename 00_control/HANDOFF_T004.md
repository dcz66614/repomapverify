# P024 T004 HANDOFF — Independent Python Oracle + S0 Gate

- Task: T004 (S0, 5h). Status: **COMPLETE — S0 GATE VERDICT: PASS** (all thresholds green, verified by real commands below).
- Input commit: `cb9b920` (T001/T002/T003 all PASS and committed).
- No commit made by T004 (per instructions; working tree contains only T004-owned new files).
- No external model call was needed; all work was done locally (no WorkBuddy/Qoder call made).

## Gate verdict — PASS

| Threshold | Required | Actual |
|---|---:|---:|
| Golden parity (three-way, no exemptions) | 48/48 | **48/48** |
| Planted detected | 24/24 | **24/24** |
| Control false alarms | 0/24 | **0/24** |
| Replay hashes (100 replays) | exactly 1 gate hash | **1** |
| External requests | 0 | **0** |
| Source-dir writes | 0 | **0** |
| Golden integrity (golden.json changed) | 0 | **0** |

- Gate hash: `7d4efa1d97798819c2eee29950d57f0d24ffe5961c273f3c9cd37284e7c437cd`
  (SHA-256 over normalized semantic results only — canonical GTs + audits +
  verdicts; excludes timestamps, durations, absolute paths, temp dirs).
  Reproduced identically on three separate full runs (14:35, 14:36, 14:37 GMT).
- Oracle main hash: `01be7fca15ec1c819a5847c211fd89921d2059e99096e1f0219ad934a3eec37a`
- Production main hash: `afebc49ef2b80a00092752dabb1fa93ba66182ad67e3ab79ac103325feba7ac6`
- Golden hash: `32901334c69208dff6618886c780e76c32440e820e89d0ced45dfe5753d2b8e6`
- Clean build: `tsc -p tsconfig.build.json`, exit 0.

## Output files (T004-owned only)

| Path | What it is |
|---|---|
| `02_source/oracle/python/oracle.py` (1,603 lines) | Independent Oracle, Python 3.12 STDLIB ONLY (`argparse ast hashlib json os re sys unicodedata`). Reads ONLY fixture repo source + claimed-map.json; never reads production extractor output, PoC audit scripts, or golden.json. Own parsers: Python via stdlib `ast`; TypeScript via hand-written line parser (import/export-from/require/dynamic-import/import-equals + tsconfig paths/baseUrl + package.json exports + relative extension completion); Go via hand-written parser (import blocks + go.mod module/replace + frozen GOOS=linux/GOARCH=amd64 build tags, `//go:build` + legacy `// +build`). Own audit (spec §5) + snapshot hash. |
| `02_source/scripts/s0-gate.mjs` (832 lines) | S0 gate runner behind the frozen `s0:gate` npm script (package.json already froze the script name — no package.json change was needed). Clean build, fixture-tree hashing before/after, network grep, Oracle + production runs + 100× replays, three-way parity, fresh Node audit from production GT, thresholds, evidence. Exit 0 = PASS, 1 = FAIL. |
| `02_source/scripts/prod-probe.mjs` (314 lines) | Gate scaffolding (NOT the Oracle): runs production extractors once per fixture (single Node process) and dumps canonical GT in the Oracle's schema; `--replay N` mode for the 100× production replay. |
| `03_evidence/S0/S0_GATE.json` (56,468 B) | 48 per-fixture results + thresholds + gate hash + external-request/source-write proofs. |
| `03_evidence/S0/ORACLE_PARITY.json` (8,606 B) | 48/48 parity proof (per-fixture mismatch lists, all empty). |
| `03_evidence/S0/REPEAT_HASH.json` (15,372 B) | 100 Oracle replay hashes + 100 production replay hashes (1 distinct each) + combined gate hash. |
| `03_evidence/S0/S0_GATE.log` (5,747 B) | Full gate log. |
| `00_control/HANDOFF_T004.md` (this file) | |

`git status --short` after the final run shows ONLY these new files
(`02_source/oracle/`, `02_source/scripts/prod-probe.mjs`,
`02_source/scripts/s0-gate.mjs`, `03_evidence/S0/`). No tracked file was
modified: no extractor, adapter, contract, fixture, golden, or package.json
change. T005–T014 not started.

## Acceptance commands — exact results

All run with `TMPDIR=~/workspace/p024-repomapverify/.tmp`.

```text
$ cd 02_source && rm -rf dist && npm run build   -> tsc, exit 0
$ npm run s0:gate -- --replays 100                -> exit 0, S0 GATE VERDICT: PASS
  (run 3x; gate hash 7d4efa1d… identical every time; ~20 s per run)
$ python3 02_source/oracle/python/oracle.py --fixtures-root 02_source/tests/fixtures/s0 --out .tmp/oracle-all.json
  -> 48 fixtures; Oracle audit vs golden: 0 mismatches / 48 (status + findings)
  -> Oracle GT vs golden GT (all golden-specified fields): 0 mismatches / 48
```

### 1. Independent Oracle — PASS

- Python: stdlib `ast` with context tracking (try/except + `if TYPE_CHECKING`
  => conditional/typeOnly); `from a.b import c` edges to `a.b` plus `a.b.c`
  only when a real module file; relative imports by package structure;
  `__init__.py` package boundary; search paths repo-root + `src`;
  external-vs-UNKNOWN split per the frozen T002 rule (top-level name with
  no repo-local candidate => EXTERNAL, else UNRESOLVABLE_REPO_LOCAL);
  dynamic `importlib.import_module` / `__import__` / exec-eval (literal
  resolves, variable => DYNAMIC_IMPORT_UNKNOWN); reachability = BFS over
  core edges + ancestor-`__init__.py` closure.
- TypeScript: comment-stripping scanner + line patterns; tsconfig paths +
  baseUrl; package.json exports incl. self-reference (value imports never
  through the `types` condition); relative completion (.ts/.tsx/.d.ts/.js/
  .jsx + index files, .js→.ts substitution); bare specifier starting `@/`
  => ALIAS_NOT_RESOLVED, valid package-name shape => external; literal
  `import()`/require resolve, variable argument => DYNAMIC_IMPORT_UNKNOWN;
  `import type` / `.d.ts` => TYPE_ONLY; unmatched import-like lines =>
  UNPARSED_STATEMENT unknown (never silently dropped).
- Go: `//go:build` expression evaluator + legacy `// +build` (frozen
  GOOS=linux/GOARCH=amd64, go1.N ≤ 25); go.mod module + replace (local-dir
  and module-path forms); vendor/ resolution; stdlib = first segment
  without a dot; package nodes (multi-file aggregation, files = composition
  evidence); GENERATED via `.pb.go`/`.mock.go` + header markers (edges go
  to generatedEdges); cgo via `import "C"`; `_test.go` excluded;
  root package relativePath `"."` with module_id over `""`.
- Hashes recomputed independently with hashlib per the frozen contracts
  (module_id = SHA256(language + NUL + normalized path); content_sha256 =
  SHA256(file content); Go package hash = SHA256 over sorted
  `path + NUL + content_sha256 + "\n"` lines; snapshot hash = same formula
  over every file under the repo root). All 48 claimed-map snapshots MATCH.

### 2. Three-way parity, no exemptions — 48/48 PASS

Per fixture the gate compares, field-by-field: golden canonical vs Oracle
canonical vs production canonical. Fields a golden does not specify are
still compared Oracle-vs-production (module_id/content_sha256 hashes,
TS/Go edge evidence line+specifier, TS/Go reachable/isolated sets, Go
hasCgo, Python generated edges, snapshot hash for Python). Any single
field mismatch = parity FAIL for that fixture. Result: 0 mismatches on
all 48 fixtures (nodes incl. hashes/language/nodeKind/isEntrypoint/
parseStatus/isDeclarationFile/packageName/files; edges incl. from/to,
conditional/typeOnly, evidence; generated edges; entrypoints;
reachable/isolated; external count + Python external-import list;
unknowns; dynamic unknowns; Go excluded files; expected findings +
audit status, from BOTH the Oracle audit and the independent Node audit
computed from production GT).

### 3. Gate runner — PASS

- Implements the frozen `s0:gate` script; clean build; production
  extraction over all 48 fixtures; Oracle run; three-way comparison;
  emits all four outputs into `03_evidence/S0/`.
- Replay: 100 Oracle replays (in-process) + 100 production replays
  (in-process, single Node process) => exactly 1 distinct hash each, and
  each replay hash equals the corresponding main-run hash.
- External requests 0: grep over `02_source/src` + `scripts` for URL
  schemes / fetch / WebSocket / node:http|https|net|dns / XMLHttpRequest /
  axios / node-fetch / undici returns exit 1, no matches (the grep pattern
  is assembled from fragments in s0-gate.mjs so the gate file cannot
  self-match; first run caught 5 self-matches and the pattern was fixed).
  Oracle imports are stdlib-only (verified by the gate).
- Source-dir writes 0: every fixture repo tree hashed before and after the
  full gate run — byte-identical (48/48). Golden.json files also hashed
  before/after — 0 changed.
- No golden.json was modified at any point; no GOLDEN_DISCREPANCY occurred
  (Oracle and production agreed with every golden).

## Negative controls (gate strictness, not vacuous)

```text
$ (mutate py-c01 golden edge statement -> 'from billing.auth import WRONG';
   mutate go-ctrl-01 golden modules[0].isEntrypoint -> false)
$ npm run s0:gate -- --replays 3
  py-c01-basic-imports: parity=FAIL mismatches=2
  go-ctrl-01: parity=FAIL mismatches=4
  THRESHOLDS: parity 46/48; S0 GATE VERDICT: FAIL (exit 1)
$ git checkout -- <both golden.json>   # restored byte-for-byte
  sha256 py-c01 golden: 21c9ecb2ae83db89d820dc8156e3c74eb1b7191ebe3adefad4fab3344a203db9 (unchanged)
  sha256 go-ctrl-01 golden: da8183cf8ccf4241f1792c2852f38d04c24bb12778cd13beb82ab400aad4d9fb (unchanged)
$ npm run s0:gate -- --replays 100    # final run: PASS, gate hash 7d4efa1d… again
```

## Frozen PoC decisions respected / findings for later tasks

1. **NAME_COLLISION_CONFUSION refined by evidence.** The first Oracle
   draft fired it whenever a hallucinated edge and a missing edge shared
   source + target basename — that over-fired on py-p08 (hallucinated
   target `utils.py` does not exist at all). The golden-correct rule,
   verified against all 8 name-collision-adjacent fixtures: the
   hallucinated target must be a REAL module (py-p05 `lib/utils.py`,
   ts-plant-05 `src/a/util.ts`, go-plant-05 `internal/a/util` fire;
   py-p08's invented `utils.py` does not). Both the Oracle audit and the
   gate's Node audit implement the refined rule and agree exactly.
2. **TS/Go goldens carry no reachable/isolated fields and no edge
   evidence.** Reachability for TS/Go is Oracle-computed (BFS over core
   edges from declared entrypoints) and cross-checked against the same
   BFS derived from production edges; TS/Go edge evidence is compared
   Oracle-vs-production as (line, specifier) / (file, line, importPath).
   Production exposes no statement text for TS edges, so the Oracle's
   canonical TS evidence carries `statement: null` (first gate run caught
   this as the only mismatch class; fixed in the Oracle, not by weakening
   the comparator).
3. **TS/Go production extractors expose no snapshot hash** (Python does);
   snapshot MATCH is verified by the Oracle for all 48 fixtures.
4. **Audit-status precedence** (spec §5.1): FAIL-class findings win over
   INCOMPLETE-forcing ones — py-p06 / ts-plant-06 carry both
   DYNAMIC_IMPORT_UNKNOWN and HALLUCINATED_EDGE and are FAIL, matching
   their goldens.
5. **Known Oracle limitations (no fixture exercises them):** Python
   literal dynamic imports inside try/TYPE_CHECKING inherit the enclosing
   conditional flags (implemented); Go `cgo` build-tag identifiers are
   UNDECIDABLE (no fixture uses them); Go replace to a module path that
   is neither vendored nor the main module counts as external.
6. **Adapter input shapes remain unconfirmed assumptions** (T002 note) —
   not part of the S0 gate, which covers extractors + goldens only.

## Next: T005 — S1 (BLOCKED until S0 PASS; S0 is now PASS)

- T005 may proceed per the plan (S0 gate green). Suggested inputs: this
  handoff, `02_source/oracle/python/oracle.py`, `02_source/scripts/s0-gate.mjs`,
  `03_evidence/S0/S0_GATE.json` (gate hash `7d4efa1d…`).
- Re-run the gate any time with: `TMPDIR=~/workspace/p024-repomapverify/.tmp npm --prefix 02_source run s0:gate -- --replays 100` (expect exit 0, same gate hash).
