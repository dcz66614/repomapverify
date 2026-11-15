# P024 T002 HANDOFF — Python import extraction PoC

- Task: T002 (S0, 4h). Status: **COMPLETE — all 3 acceptance items PASS** (verified by real commands below, 2026-11-14 ~14:20 UTC).
- Input commit: `eecdd4b` (T001 PASS). Note: HEAD moved to `7ac369f` ("Control: T001 PASS (eecdd4b), T002+T003 IN_PROGRESS") during this task (parent control commit); T002 files are uncommitted in the working tree per instructions (NO commit made by T002).
- No external model call was needed; all work was done locally (no WorkBuddy/Qoder call made).

## Output files (134 files in T002-owned paths)

| Path | What it is |
|---|---|
| `02_source/src/extractors/python/` (6 .ts files, 2,198 lines incl. adapters) | Python extractor: `index.ts` (orchestrator), `extract.ts` (AST statement extraction), `resolve.ts` (frozen-scope module index), `parser.ts` (tree-sitter bootstrap), `types.ts`, `stdlib.ts` (frozen CPython 3.12 stdlib top-level names, generated from local `sys.stdlib_module_names`) |
| `02_source/src/adapters/` (5 .ts files) | `graphify.ts`, `understand-anything.ts`, `aider.ts`, `shared.ts`, `index.ts` (dispatch) |
| `02_source/tests/fixtures/s0/python/` | 16 fixtures (`py-c01`–`py-c08`, `py-p01`–`py-p08`: each `repo/` + `claimed-map.json` + hand-written `golden.json`), `adapters/` (3 samples), `README.md`, `poc-audit.test.ts`, `extractor-units.test.ts` |
| `02_source/scripts/t002-poc-audit.mjs` | PoC runner (build + vitest; writes evidence). PoC-only; superseded by T004's `scripts/s0-gate.mjs` |
| `03_evidence/T002/POC_RUN.json`, `POC_RUN.log`, `FIXTURES.md` | PoC run evidence (per-fixture results) |

Contracts in `02_source/src/contracts/` were NOT modified (no spec conflict found).

## Acceptance commands — exact results

All run with `TMPDIR=~/workspace/p024-repomapverify/.tmp`.

### 0. Clean build — PASS

```text
$ cd 02_source && rm -rf dist && npm run build   -> tsc -p tsconfig.build.json, exit 0
```

### 1. Python extractor coverage — PASS

```text
$ node scripts/t002-poc-audit.mjs
  == build == exit 0
  == T002 vitest: npx vitest run tests/fixtures/s0/python/ ==
  Test Files  2 passed (2)
  Tests       37 passed (37)
```

- `poc-audit.test.ts` (22 tests): 16 fixtures — extractor output vs hand-written
  golden.json field-by-field (nodes incl. independently recomputed
  `module_id`/`content_sha256` from file bytes via node:crypto, edges with
  line + exact statement evidence, external imports, unknown imports,
  dynamic-unknown, entrypoints, reachable/isolated sets) + PoC audit of the
  claimed map vs ground truth with EXACT finding-set equality.
- `extractor-units.test.ts` (15 tests): rules the fixtures do not cover —
  PARSE_ERROR, GENERATED exclusion, relative escape, wildcard, `__import__` /
  importlib literal vs variable, exec/eval, unresolvable repo-local,
  duplicate collapse, src/root shadowing, namespace packages (no
  `__init__.py` => UNKNOWN), nested imports, no-toml, 1 MiB TOO_LARGE cap,
  attribute from-imports, `__init__` self-edge skip.
- Coverage: `import` / `from` / relative import / `__init__.py` re-export;
  `from a.b import c` is a sub-module edge ONLY when `a.b.c` is a real module
  file (py-c05 proves both directions); frozen search paths repo-root + `src`
  with `__init__.py` package boundary; out-of-scope => UNKNOWN, never guessed.

### 2. Input-mapping PoC — PASS (5 adapter tests in poc-audit.test.ts)

- Graphify sample: 3 modules, edges `[api→auth, auth→refunds]`, `droppedEdges=1`
  (the `INFERRED` edge dropped; only `EXTRACTED` passes through).
- Understand-Anything sample: edges `[api→auth]`, `droppedEdges=2` (one `llm`
  origin, one missing origin — unknown provenance is never a claim).
- Aider text sample: modules `[api, auth]`, edges `[]`, completeness forced
  `PARTIAL_SUBGRAPH`; JSON input claiming `FULL_GRAPH` is still forced
  `PARTIAL_SUBGRAPH` (contract `forcedCompleteness`).
- Missing `completeness` or missing snapshot => adapter error, never a guess.

### 3. 16 fixtures: 8/8 control PASS, 8/8 planted detected — PASS

From `03_evidence/T002/POC_RUN.log` (also `POC_RUN.json`):

```text
fixtures: 16 (control PASS 8/8, planted detected 8/8)
py-c01..py-c08  status=PASS findings=-            (modules 4/6/3/4/5/4/3/6, edges 3/9/2/3/4/2/1/4)
py-p01 hallucinated-edge      FAIL  HALLUCINATED_EDGE api→refunds.py; HALLUCINATED_MODULE refunds.py
py-p02 wrong-entrypoint       FAIL  WRONG_ENTRYPOINT billing/api.py
py-p03 missing-edge           FAIL  MISSING_EDGE api→auth.py
py-p04 unclaimed-reachable    FAIL  MISSING_EDGE api→migrations.py; UNCLAIMED_REACHABLE_MODULE migrations.py
py-p05 name-collision         FAIL  HALLUCINATED_EDGE cart→lib/utils.py; MISSING_EDGE cart→shop/utils.py; NAME_COLLISION_CONFUSION cart→lib/utils.py
py-p06 dynamic-import-misread FAIL  DYNAMIC_IMPORT_UNKNOWN loader.py; HALLUCINATED_EDGE loader→plugins/alpha.py
py-p07 reexport-misread       FAIL  HALLUCINATED_EDGE main→pkg/core.py; MISSING_EDGE main→pkg/__init__.py
py-p08 alias-misparse         FAIL  HALLUCINATED_EDGE main→utils.py; HALLUCINATED_MODULE utils.py; MISSING_EDGE main→pkg/utils.py
```

Production extractor output matches the hand-written Golden Expected Graphs
field-by-field on all 16 fixtures (nodes, edges + evidence, external,
unknown, dynamic, entrypoints, reachable, isolated).

### Negative control (proves the test is strict, not vacuous)

Corrupting one golden edge statement made `py-c01` fail; adding the missing
edge back into `py-p03`'s claimed map made `py-p03` fail (it became PASS
against expected FAIL). Both files were restored byte-for-byte afterwards and
the suite re-run green (37/37).

## Frozen PoC rules T004/T006/T008 must know (all documented in code)

1. **External vs UNKNOWN split** (`src/extractors/python/index.ts`,
   `classifyUnresolved`): an unresolvable absolute import is EXTERNAL when
   its top-level name has NO repo-local candidate (stdlib list or
   third-party — both are "not a repo module"), and UNKNOWN
   (`UNRESOLVABLE_REPO_LOCAL`) when the top-level name IS repo-local but the
   deeper path is missing. A repo-local file shadows a stdlib name.
   Consequence: `import made_up_pkg` counts external, not unknown — a
   deliberate, documented PoC rule; T008 may refine it.
2. **`import a.b` is ONE edge** (to `a.b` only, spec §4.3 formula), while
   `from a.b import c` edges to `a.b` PLUS `a.b.c` when the latter is a
   module file. Asymmetry is literal-spec, documented in `index.ts`.
3. **Reachability has a package-init closure**: importing a submodule
   executes ancestor `__init__.py` files, so they count as reachable
   (edges do NOT include these implicit executions). Without this, every
   fixture with a package would show a spurious isolated `__init__.py`.
4. **Snapshot hash is a PoC algorithm** (`computeRepoSnapshotSha256`):
   SHA-256 over sorted `relativePath + NUL + contentSha256 + "\n"` lines for
   every file under the repo root. T005/T008 freeze the canonical snapshot
   algorithm; fixture claimed maps were bound with an INDEPENDENT Python
   hashlib computation of the same formula (never by running the extractor).
5. **Adapter input shapes are DOCUMENTED ASSUMPTIONS** (headers of
   `graphify.ts` / `understand-anything.ts` / `aider.ts`): no verified
   Graphify graph.json or real .ua sample was available to T002. T008 must
   confirm exact upstream field names against real inputs before the
   complete adapters ship. PoC stance throughout: missing/non-static
   provenance => edge dropped + counted, never passed through.
6. **web-tree-sitter 0.27 Node API quirks** (verified by probe, in
   `parser.ts`): NO `childByFieldName`/`childrenByFieldName` — iterate
   `child(i)` + `fieldNameForChild(i)`; wildcard imports carry NO field
   name; comments are NAMED nodes (filter by `type`, never by index).
7. **PoC audit lives in the test file** (`poc-audit.test.ts`, function
   `pocAudit`) — it is NOT the T006 comparator. T006 replaces it; T004's
   S0 gate supersedes `scripts/t002-poc-audit.mjs`.
8. **T002 did not touch** `src/extractors/typescript`, `src/extractors/go`,
   or T003's fixture dirs (sibling T003 built those in parallel; its files
   are present in the tree, untouched by T002). `src/index.ts` was left
   alone (T001's barrel); extractors/adapters are imported by path.

## Notes / caveats

- `src/extractors/python/stdlib.ts` (300 top-level names) is DATA generated
  from the local Python 3.12.3 `sys.stdlib_module_names`, not output of the
  extractor.
- Golden `module_id`/`content_sha256` values are NOT stored in golden.json;
  the test recomputes them independently from file bytes each run.
- The 1 MiB `TOO_LARGE` cap (`PYTHON_MAX_FILE_BYTES`) is a T002 PoC freeze,
  not a spec value — T008 may adjust it.

## Next: T004 — Independent Python Oracle + S0 Gate (S0, 5h)

- Owner files: `oracle/python`, `tests/golden/s0`, `scripts/s0-gate`,
  `evidence/s0` (per PLAN §2.1). T004 consumes: this extractor, the 16
  Python fixtures + goldens here, and T003's 32 TS/Go fixtures.
- T004 must NOT reuse this extractor (or the PoC audit in
  `poc-audit.test.ts`) to generate expected answers; the 48 Goldens are
  hand-written and the Oracle is independently implemented.
