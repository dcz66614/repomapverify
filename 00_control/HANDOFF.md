# P024 T001 HANDOFF — Environment probe, engineering skeleton, interface contracts

- Task: T001 (S0, 3h). Status: **COMPLETE — all 4 acceptance criteria PASS** (verified by real commands below, 2026-11-14 ~14:02 UTC).
- Input commit: `9e28c41` (specs v1.1.0 SPEC_FROZEN, clean tree at start).
- Output: uncommitted changes, left in the working tree per instructions (NO commit made).

## Output files

| File | What it is |
|---|---|
| `02_source/package.json` | repomapverify 0.1.0, Node ≥24, §3.3 npm-scripts contract, frozen deps |
| `02_source/package-lock.json` | lockfileVersion 3, sha256 `2e42c636…5b3d5` (62,988 B) |
| `02_source/tsconfig.json`, `02_source/tsconfig.build.json` | strict TS, NodeNext, build = `tsc -p tsconfig.build.json` |
| `02_source/src/contracts/*.ts` (8 files + `index.ts`) | §4 contracts: claimed-map, module identity, snapshot, entrypoints, findings, report, adapters, frozen-scope |
| `02_source/src/index.ts` | skeleton barrel re-exporting contracts |
| `02_source/scripts/env/verify-tree-sitter.mjs` | parser-scheme verification script (real run, exit 0) |
| `.gitignore` | `.tmp/`, `02_source/node_modules/`, `02_source/dist/` (verified ignored) |
| `.tmp/` | persistent scratch dir (created; `/tmp` is 512 MB tmpfs) |
| `03_evidence/T001/ENVIRONMENT.md` | §3.1 probe record |
| `03_evidence/T001/BUILD.log` | `npm run build` log + contract smoke-test output |
| `03_evidence/T001/PARSER_VERIFICATION.log` | tree-sitter verification log (15/15 PASS) |
| `00_control/HANDOFF.md` (this file) | |

LICENSE (MIT) was already at the repo root and was NOT touched: 1,065 B,
sha256 `50b8b302ffcb53aec1866ad4b94721c200400e6aac8cee12db03b85f24e39ed2`,
"Copyright (c) 2026 dcz66614".

## Acceptance commands — exact results

### 1. Environment probe (§3.1) — PASS

```text
$ uname -a
Linux htch-runtime 7.0.0-44-generic #1 SMP PREEMPT_DYNAMIC Fri Nov  6 01:23:31 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux
$ node --version        -> v24.22.1
$ npm --version         -> 10.9.4
$ python --version      -> /bin/bash: line 1: python: command not found
$ python3 --version     -> Python 3.12.3
$ go version            -> /bin/bash: line 1: go: command not found  (exit 127)
$ git --version         -> git version 2.43.0
```

Recorded in `03_evidence/T001/ENVIRONMENT.md`. Two facts T002–T004 must
carry forward: **Go is NOT installed** (T003 needs a Go install before the
Go extractor PoC can run); bare `python` is absent — Oracle scripts must
invoke `python3`.

### 2. Skeleton builds — PASS

```text
$ cd 02_source && npm install            -> added 48 packages in 17s, exit 0
$ npm install --save-dev @types/node     -> added 3 packages, exit 0
                                            (first build failed only on missing
                                            Node type defs: TS2307 node:crypto,
                                            TS2580 Buffer; fixed by this dep)
$ rm -rf dist && npm run build           -> tsc -p tsconfig.build.json, exit 0
                                            (dist/ + dist/contracts/*.js + *.d.ts)
```

Contract smoke test (node against `dist/index.js`, output in BUILD.log):
`module_id` differs for `billing/api.py` vs `billing/auth.py` while
`content_sha256` is equal for identical content; Go package hash is
order-independent; `checkSnapshot` returns STALE_SNAPSHOT on mismatch and
MATCH on match; TOML parse of `[entrypoints] paths = ["src/main.ts",
"src/cli.ts"]` works; `forcedCompleteness('aider-repo-map')` =
PARTIAL_SUBGRAPH, `graphify` = undefined.

Contracts landed (spec v1.1.0 §4):
- `claimed-map.ts`: ClaimedMapV1 with REQUIRED `completeness`
  (FULL_GRAPH | PARTIAL_SUBGRAPH) and `repoSnapshotSha256` + optional
  `gitCommit`; schema `repomapverify.claimed-map/v1`.
- `module.ts`: `module_id = SHA256(language + normalized_relative_path)`
  SEPARATED from `content_sha256 = SHA256(file_content)`; frozen encoding
  is SHA256(language + NUL + normalized path) to rule out concatenation
  ambiguity; Go package hash = SHA256 over sorted
  `path + NUL + content_sha256 + "\n"` lines; `normalizeRelativePath`
  (NFC, backslash→slash, strip `./`); unsafe-path rejection.
- `snapshot.ts`: `checkSnapshot` — any snapshot mismatch (or missing
  declared snapshot) = STALE_SNAPSHOT.
- `entrypoints.ts`: `.repomapverify.toml` `[entrypoints] paths = [...]`
  type + minimal strict parser (unknown sections/keys rejected; absent
  file = empty declaration = no WRONG_ENTRYPOINT, only candidates).
- `findings.ts`: all 12 finding types with spec-default severities;
  FULL_GRAPH-only set {MISSING_EDGE, UNCLAIMED_REACHABLE_MODULE};
  INCOMPLETE-forcing set {DYNAMIC_IMPORT_UNKNOWN, SOURCE_NOT_ENUMERATED};
  exit codes PASS 0 / FAIL 1 / INCOMPLETE 2 / usage 3.
- `report.ts`: GroundTruthGraph, AuditReportV1 (`repomapverify.report/v1`).
- `adapters.ts`: Graphify / Understand-Anything / Aider kinds; Aider
  FORCES PARTIAL_SUBGRAPH.
- `frozen-scope.ts`: Python search paths (repo root + `src`, `__init__.py`
  boundary, from-import needs a real module file); TS resolution scope
  (tsconfig paths/baseUrl/moduleResolution, package.json exports, relative
  extension completion); Go default build tags (GOOS=linux, GOARCH=amd64,
  no custom tags; undecidable constraint = UNKNOWN).

### 3. Tree-sitter WASM verification — PASS (frozen runtime dependency)

```text
$ node scripts/env/verify-tree-sitter.mjs   -> exit 0, ALL CHECKS PASSED (15/15)
```

Log: `03_evidence/T001/PARSER_VERIFICATION.log`. Real run under Node
v24.22.1: WASM runtime initialised; Python sample parsed with no error
(2 `import_statement` + 4 `import_from_statement` found by query);
TypeScript sample (3 `import_statement` + 1 `export_statement`); TSX
sample (2 `import_statement`); Go sample (1 `import_declaration` +
3 `import_spec`); broken Python sample correctly reports an error
(hasError / ERROR node — the property PARSE_ERROR depends on).

**FROZEN runtime-dependency decision** (the "zero runtime dependencies"
promise is NOT made — the parser IS a runtime dependency, verified):

| Package | Version | License |
|---|---|---|
| web-tree-sitter | 0.27.2 | MIT |
| tree-sitter-python | 0.25.0 | MIT |
| tree-sitter-typescript | 0.23.2 | MIT (ships both `tree-sitter-typescript.wasm` and `tree-sitter-tsx.wasm`) |
| tree-sitter-go | 0.25.0 | MIT |

All four are runtime `dependencies` in `package.json`, pinned in the
lockfile. Dev-only: typescript 5.9.3, vitest 4.0.18, @types/node 26.6.6
(all MIT). One API note for T002/T003: web-tree-sitter 0.27 ESM has NO
default export — use named imports `{ Language, Parser, Query }`
(the first verification run failed on `import Parser from
'web-tree-sitter'`; fixed in the script).

### 4. LICENSE (MIT) in repo root — PASS

Present, untouched, 1,065 B, sha256 `50b8b302…ed2` (see above).

## Notes / caveats for the next tasks

- `npm test` (vitest) has NO test files yet — not run, not claimed; tests
  arrive with T002–T004.
- `npm run s0:gate`, `verify:all`, `release:build`, `release:verify` are
  frozen script names per PLAN §3.3 but their target files
  (`scripts/s0-gate.mjs` etc.) belong to T004/T014 and do not exist yet;
  `audit` / `ground-truth` scripts point at `dist/cli.js` (T009).
- `git status`: only new files (`.gitignore`, `02_source/`,
  `03_evidence/`, `00_control/HANDOFF.md`); `node_modules/` and `dist/`
  are git-ignored; tree left uncommitted as instructed.
- No external model call was needed for T001; no WorkBuddy/Qoder call made.

## Next: T002 — Python import extraction PoC (S0, 4h)

- Owner files: `src/extractors/python`, `src/adapters` (input-mapping
  PoC), `tests/fixtures/s0/python`.
- Consume: `src/contracts` (this handoff), `scripts/env/verify-tree-sitter.mjs`
  (proven grammar loading + query pattern — reuse it, do not re-prove
  from scratch), frozen Python scope in `contracts/frozen-scope.ts`.
- T002 acceptance reminder: import/from/relative/`__init__` re-export;
  `from a.b import c` only an edge when `a.b.c` is a real module file;
  Graphify / Understand-Anything / Aider (PARTIAL_SUBGRAPH) input-mapping
  PoC; 8 control PASS + 8 planted detected on the 16 Python fixtures.
- Pre-condition for T003 (not T002): install Go — `go version` currently
  exit 127 on this VM.
