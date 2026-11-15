# P024 T009 HANDOFF — CLI main flow + static HTML report

- Task: T009 (S3, 7h). Status: **COMPLETE — all 6 acceptance items PASS** (verified by real commands below, 2026-11-14 ~15:39 UTC).
- Input commit: `9100188` (S0 PASS, T001–T008 PASS, gate hash `7d4efa1d…`; tree clean at start).
- Output: uncommitted changes, left in the working tree per instructions (NO commit made).
- No external model call was needed; all work was done locally (no WorkBuddy/Qoder call made).

## Output files

| Path | What it is |
|---|---|
| `02_source/src/cli.ts` | Entry: `#!/usr/bin/env node`, `node dist/cli.js` → `main()` |
| `02_source/src/cli/parse.ts` | Arg parsing, `USAGE`, `UsageError` (exit 3, never a bare stack trace) |
| `02_source/src/cli/audit.ts` | `runAudit`: validate map → build ground truth → collect evidence → compare → write JSON and/or HTML → print summary; exit code = status |
| `02_source/src/cli/evidence.ts` | `collectEvidence`: re-runs the 3 frozen extractors (same field mapping as the T006 golden tests) → `ComparatorEvidence` + per-edge source evidence (file, line, import statement) |
| `02_source/src/cli/ground-truth.ts` | `runGroundTruth`: prints ONLY the ground-truth JSON; `--lang` filter |
| `02_source/src/cli/main.ts` | `main(argv)` dispatch, returns exit code, never calls `process.exit` (testable in-process) |
| `02_source/src/cli/index.ts` | Barrel |
| `02_source/src/report/build-report.ts` | `buildFullReport`: §6.3 JSON report + `infoFindings` + `canonicalSemanticHash` + SHA-256 evidence list + §7.1 own sections + aligned module/edge detail; redaction before hashing |
| `02_source/src/report/render-html.ts` | `renderHtmlReport`: single self-contained offline HTML (inline CSS, no JS, native `<details>` disclosure) |
| `02_source/src/report/template.ts` | `REPORT_CSS` + `escapeHtml` (template in-repo, embedded at build time; zero external references) |
| `02_source/src/report/index.ts` | Barrel |
| `02_source/src/index.ts` (modified, +2 lines) | Barrel now also exports `report`, `cli` |
| `02_source/package.json` (modified, +3 lines) | Added `"bin": {"repomapverify": "dist/cli.js"}` so the `repomapverify` command name resolves; frozen npm scripts untouched |
| `02_source/tests/cli/cli.test.ts` | 23 E2E tests through real `node dist/cli.js` |
| `02_source/tests/report/report.test.ts` | 10 unit tests (shape, hash, redaction, info sections, HTML escaping) |
| `03_evidence/T009/TEST_RUN.log` | Full-suite verbose log (226/226) |
| `03_evidence/T009/S0_GATE_RERUN.log` | S0 gate re-run log (PASS, same gate hash) |
| `03_evidence/T009/E2E.log` | All E2E commands with exit codes + offline grep proof + snapshot hashes |
| `03_evidence/T009/SHA256SUMS.txt` | SHA-256 of all 14 report snapshots (7 JSON + 7 HTML) |
| `03_evidence/T009/e2e/` | Report snapshots: py-c01 (control), py-p01 / ts-plant-01 / go-plant-01 (planted), ts-ctrl-08 (no-toml), py-p05 (duplicate content), py-dynamic-incomplete (synthetic repo + claimed map + reports), bad-map.json |
| `03_evidence/T009/run-e2e.sh` | Script that regenerates `e2e/` + `E2E.log` + `SHA256SUMS.txt` |
| `00_control/HANDOFF_T009.md` (this file) | |

No extractor, adapter, contract, graph, identity, comparator, findings, oracle, fixture, or golden file was modified. No T010+ work started.

## Acceptance commands — exact results

All run with `TMPDIR=~/workspace/p024-repomapverify/.tmp`.

### 0. Clean build + frozen scripts — PASS

```text
$ cd 02_source && npm run build   -> tsc -p tsconfig.build.json, exit 0; dist/cli.js exists
$ node dist/cli.js --help   -> exit 0, prints usage (audit / ground-truth)
$ npm run audit -- --repo tests/fixtures/s0/python/py-c01-basic-imports/repo --map .../claimed-map.json --out ...
  -> RESULT: PASS, exit 0 (frozen `audit` script works)
$ npm run ground-truth -- --repo ... --lang python   -> exit 0 (npm adds its own banner lines;
  direct `node dist/cli.js ground-truth` prints only the JSON — see item 1)
```

### 1. CLI end-to-end, exit codes strictly match status — PASS

```text
$ node dist/cli.js audit --repo tests/fixtures/s0/python/py-c01-basic-imports/repo \
    --map tests/fixtures/s0/python/py-c01-basic-imports/claimed-map.json --out <dir>
  -> RESULT: PASS, exit 0 (ground truth 4 modules / 3 edges, coverage 8/8)
$ node dist/cli.js audit --repo .../py-p01-hallucinated-edge/repo --map .../claimed-map.json
  -> RESULT: FAIL, exit 1 (HALLUCINATED_EDGE billing/api.py -> billing/refunds.py,
     HALLUCINATED_MODULE billing/refunds.py — exactly the golden findings)
$ node dist/cli.js audit --repo .../ts-plant-01/repo --map .../claimed-map.json
  -> RESULT: FAIL, exit 1 (HALLUCINATED_EDGE)
$ node dist/cli.js audit --repo .../go-plant-01/repo --map .../claimed-map.json
  -> RESULT: FAIL, exit 1 (HALLUCINATED_EDGE)
$ node dist/cli.js audit --repo <synthetic dynamic-import repo> --map <snapshot-bound map>
  -> RESULT: INCOMPLETE, exit 2 (exactly one finding: DYNAMIC_IMPORT_UNKNOWN loader.py;
     repo + map kept in 03_evidence/T009/e2e/py-dynamic-incomplete/)
$ node dist/cli.js audit --repo <missing> ...            -> exit 3 "repo path does not exist"
$ node dist/cli.js audit --repo <repo> --map bad-map.json -> exit 3 "invalid claimed map: ..."
$ node dist/cli.js audit --repo <repo> --map <missing>   -> exit 3 "claimed map file does not exist"
$ node dist/cli.js frobnicate / unknown flag / bad --format / bad --lang
  -> exit 3 with a clear "Error: ..." message, no stack trace
$ node dist/cli.js ground-truth --repo .../py-c01.../repo --lang python
  -> exit 0, stdout parses as JSON only, schema repomapverify.ground-truth/v1,
     4 modules / 3 edges, repoSnapshotSha256 a80ab95d7bba... (matches the fixture map binding)
```

### 2. JSON report (§6.3) + hash + evidence + redaction — PASS

- Shape (py-p01 snapshot): `schema` = `repomapverify.report/v1`, `mapId` = `map_id` = `synthetic-py-p01-hallucinated-edge`, `status` FAIL, `groundTruth` = `ground_truth` = {modules 4, edges 3}, `claimed` {5, 4}, `coverage` {verifiedClaims 8, totalClaims 10, verified_claims 8, total_claims 10}, findings with id/severity/from/to.
- `canonicalSemanticHash`: T008's `canonicalSemanticHash` over the redacted semantic core (computed AFTER redaction, so it is reproducible from the emitted report); identical across two builds of the same audit, different for a different audit (unit-tested).
- `evidenceSha256`: repo snapshot hash + one content SHA-256 per ground-truth module (4 entries for py-c01).
- Privacy: a repo under a realistic `/home/alice/work/billing-service` path (test overrides `HOME` to `/home/alice`) leaves neither `/home/alice` nor `alice` in the JSON or the HTML; relative paths (`billing/api.py`) still present. Unit test additionally redacts with an explicit `/home/alice/...` repoRoot.

### 3. Static HTML report, single file, offline — PASS

- One self-contained file: inline CSS only, NO JavaScript (native `<details>` disclosure), no images, no external links. Offline proof over all 7 emitted HTML files: `grep -c -E 'https?://'` = 0, `grep -c -E '<script|src=|href="https?:'` = 0 (recorded in `E2E.log`).
- Aligned tables: same module / edge on one row, claimed left, ground truth right; green = verified, red = fabricated/wrong, yellow = undetermined (dynamic / generated-code only).
- Clicking an edge shows source file path, line number, import statement (e.g. `billing/api.py`, line 1, `from billing.auth import login`); clicking a module shows §7.2 detail (normalized path, content SHA, language, generated flag, in/out edges real-vs-claimed, parse status).
- Header summary: real scale, claimed scale, coverage, finding counts by severity, completeness mode, snapshot status, canonical semantic hash.
- Wrong entrypoints / unclaimed reachable / isolated modules each have their OWN section, never mixed into the edge list (sections render even when empty, with "None.").

### 4. infoFindings rendered in JSON AND HTML — PASS

- The comparator's separate `infoFindings` list (ISOLATED_MODULE / ENTRYPOINT_CANDIDATE / DUPLICATE_CONTENT) is carried verbatim in the JSON report (`infoFindings` array + `sections` object) and in the HTML ("Informational findings" table + own sections). Never merged into `findings`, never dropped.
- Proof: ts-ctrl-08 (no toml) → PASS, 0 main findings, `infoFindings` = [ENTRYPOINT_CANDIDATE src/main.ts], `sections.entrypointCandidates` = ["src/main.ts"], HTML shows it; py-p05 → FAIL, DUPLICATE_CONTENT in `infoFindings` only (not in main findings, preserving the frozen golden), `sections.duplicateContent` = [{paths: [lib/utils.py, shop/utils.py]}].

### 5. CLI E2E + report snapshots — PASS

Snapshots in `03_evidence/T009/e2e/` (hashes in `SHA256SUMS.txt`, commands + exit codes in `E2E.log`, regenerable via `run-e2e.sh`): 1 control (py-c01, exit 0 PASS), 1 planted per language (py-p01, ts-plant-01, go-plant-01 — all exit 1 FAIL with the expected findings), 1 INCOMPLETE (py-dynamic-incomplete, exit 2), 1 input-error (bad-map.json, exit 3), plus ts-ctrl-08 and py-p05 for the infoFindings proof.

### 6. Full suite green + S0 gate still green — PASS

```text
$ cd 02_source && npx vitest run --reporter=verbose
  Test Files  14 passed (14); Tests  226 passed (226)
  (193 pre-existing + 33 new T009 tests; log: 03_evidence/T009/TEST_RUN.log)

$ npm --prefix 02_source run s0:gate -- --replays 100   -> exit 0
  THRESHOLDS: parity 48/48; planted 24/24; control false alarms 0/24;
  replay distinct=1; external=0; source writes=0; goldens changed=0
  S0 GATE VERDICT: PASS
  gate hash: 7d4efa1d97798819c2eee29950d57f0d24ffe5961c273f3c9cd37284e7c437cd
  (identical to the T004–T008 gate hash; log: 03_evidence/T009/S0_GATE_RERUN.log)
```

The gate run rewrote `03_evidence/S0/S0_GATE.json` / `.log` with only new timestamps; both were restored with `git checkout` (same gate hash). `git status --short` shows only `M 02_source/package.json` (bin) + `M 02_source/src/index.ts` (barrel) plus T009-owned new files. No golden, fixture, extractor, adapter, contract, graph, identity, comparator, findings, or oracle file was modified.

## Decisions T010+ must know

1. **Report field spellings (same tension as T008's input).** PROJECT_BOOK §6.3 spells report fields snake_case (`map_id`, `ground_truth`, `verified_claims`); the frozen contract `AuditReportV1` spells them camelCase. The report carries BOTH spellings with identical values (documented in `src/report/build-report.ts`), so a §6.3 reader and a contract reader agree. A future v2 should freeze one spelling.
2. **Evidence collection re-runs the extractors.** `buildGroundTruthGraphFromRepo` returns the graph but not edge source evidence or extractor unknowns, so the CLI re-runs the three extractors (same mapping as the T006 golden tests) to assemble `ComparatorEvidence` + edge evidence. Cost is one extra extractor pass per audit; correctness is identical (same extractors, same repo, read-only).
3. **TS/Go import statements are reconstructed, not quoted verbatim.** Python edges carry the exact statement text; TS/Go edges carry file + line + specifier/import path, rendered in written form from the edge kind (`import ... from "x"`, `require("x")`, `import "x"`). The file + line are exact; the statement text is the faithful written form, not a raw source slice.
4. **`ground-truth --lang` keeps the repo-wide external-import count.** The built graph does not split it per language; modules/edges/reachable/isolated/entrypoints/duplicate-content ARE filtered. Documented in `src/cli/ground-truth.ts`.
5. **Gate grep constraint respected.** No `https?://`, `fetch(`, `node:http` or similar token appears in `src/` (gate `external=0` confirms); the HTML template contains no external URL by construction. Future report work must keep it that way.
6. **No-args prints usage with exit 0** (standard CLI help behavior); every *missing/invalid* argument to a real command exits 3. If a stricter reading is wanted (bare invocation = 3), that is a one-line change in `parseArgs`.
7. **Test-only bug found and fixed in the tests, not the product:** the first CLI test run failed 23/33 because `SRC_DIR` resolved to `tests/` instead of `02_source/` (wrong fixture path). The product code was correct; only the test path was fixed.

## Next: T010 — CI mode, exit codes, README + Demo (S3, 5h)

- Owner files: README, docs, CI workflow, demo fixtures.
- Consume: this handoff, `src/cli` (`main`, `runAudit`, `runGroundTruth`, exit-code contract), `src/report` (JSON + HTML), `03_evidence/T009/e2e/` snapshots as demo/report examples.
- T010 acceptance reminder: CI workflow example; README first screen + out-of-the-box path; demo repo + demo map producing a report in one minute.
- Do NOT touch: extractors, adapters, contracts, graph, identity, comparator, findings, oracle, fixtures, goldens (T009 ownership is `src/cli`, `src/report`, `src/cli.ts`, the `bin` field in `package.json`, + tests).
