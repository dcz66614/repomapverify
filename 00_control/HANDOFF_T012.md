# P024 T012 HANDOFF — E2E / Offline / Performance / Release rehearsal

- Task: T012 (S4, 5h). Status: **COMPLETE — all 5 acceptance items PASS** (verified by real commands below, 2026-11-14 ~16:11–16:17 UTC).
- Input commit: `d9d92d6` (S0 PASS, T001–T011 PASS, gate hash `7d4efa1d…`; tree clean at start).
- Output: uncommitted changes, left in the working tree per instructions (NO commit made).
- No external model call was needed; all work was done locally (no WorkBuddy/Qoder call made).

## Output files

| Path | What it is |
|---|---|
| `02_source/tests/e2e/e2e.test.ts` | E2E vitest suite (10 tests) through the real built CLI: control, planted ×3, demo, ground-truth golden counts |
| `02_source/tests/e2e/run-e2e.sh` | Full chain: vitest suite + git worktree fresh checkout → `npm ci` → `npm run build` → all audits + golden counts; logs to `03_evidence/T012/E2E.log` |
| `02_source/tests/offline/offline.test.ts` | Offline vitest suite (5 tests): `unshare -n` namespace proof, fetch rejection, online/offline hash equality, control PASS in namespace, network grep re-run |
| `02_source/tests/offline/run-offline.sh` | Shell version of the offline proof; logs to `03_evidence/T012/OFFLINE.log` |
| `02_source/tests/performance/generate-perf-repo.mjs` | Deterministic generator: exactly 1,000 modules / 5,000 edges, py 400 / ts 300 / go 300 (fixed offsets, no RNG) |
| `02_source/tests/performance/build-perf-map.mjs` | Builds a perfect claimed map from a ground-truth JSON (for the timing run) |
| `02_source/tests/performance/measure.mjs` | Wall-time + peak-RSS measurer (polls /proc VmRSS/VmHWM; no `/usr/bin/time` on this VM) |
| `02_source/tests/performance/performance.test.ts` | Perf vitest suite (1 test, 180 s timeout): asserts counts + §10.3 targets, writes `PERF_RESULTS.json` |
| `02_source/tests/performance/run-performance.sh` | Runs the perf suite, formats `PERFORMANCE.md`; logs to `PERFORMANCE_RUN.log` |
| `02_source/scripts/release-rehearsal.mjs` | Release rehearsal: build → source.zip + dist.zip + SHA256SUMS.txt in `.tmp/rehearsal/` → independent verification (see item 4); writes `REHEARSAL.json` |
| `03_evidence/T012/E2E.log` | Full-chain log (vitest 10/10, npm ci 0, build 0, 5 audit checks PASS, golden counts PASS) |
| `03_evidence/T012/OFFLINE.log` | Offline proof log (namespace proof, hash equality, grep exit 1) |
| `03_evidence/T012/PERFORMANCE.md` | Perf results + machine facts (extraction 0.908 s, audit 2.888 s, RSS 141.2 / 228.5 MB) |
| `03_evidence/T012/PERF_RESULTS.json` | Exact perf numbers as JSON |
| `03_evidence/T012/PERFORMANCE_RUN.log` | Perf script run log |
| `03_evidence/T012/REHEARSAL.log` | Rehearsal run log |
| `03_evidence/T012/REHEARSAL.json` | Rehearsal package SHAs + baseline-vs-verify comparisons |
| `03_evidence/T012/S0_GATE_RERUN.log` | S0 gate re-run log (PASS, same gate hash) |
| `03_evidence/T012/TEST_RUN.log` | Full-suite verbose log (254/254) |
| `00_control/HANDOFF_T012.md` (this file) | |

No `src/`, oracle, fixture, or golden file was modified. `git status --short` shows only the T012-owned new files above. Nothing was written into `05_release/` (still empty — that is T014's). The gate run rewrote `03_evidence/S0/S0_GATE.json` / `.log` with only new timestamps and the full-suite run rewrote `03_evidence/T011/MUTATION_RESULTS.json` with only new temp-dir suffixes; all three were restored with `git checkout` (same gate hash).

## Acceptance commands — exact results

All run with `TMPDIR=~/workspace/p024-repomapverify/.tmp`.

### 1. E2E full chain — PASS

```text
$ bash tests/e2e/run-e2e.sh   (log: 03_evidence/T012/E2E.log)
  Part A: npm run build exit 0; vitest tests/e2e/e2e.test.ts: 10/10 passed
  Part B: git worktree add --detach .tmp/fresh-checkout HEAD (d9d92d6) exit 0
          npm ci (from the lockfile) exit 0
          npm run build exit 0; dist/cli.js present
          control py-c01:        exit 0 PASS, ground truth 4 modules / 3 edges, 0 findings
          planted py-p01:        exit 1 FAIL, HALLUCINATED_EDGE billing/api.py -> billing/refunds.py
                                 (+ HALLUCINATED_MODULE billing/refunds.py)
          planted ts-plant-01:   exit 1 FAIL, HALLUCINATED_EDGE src/main.ts -> src/services/api.ts
                                 (ground truth 4/5, claimed 4/6)
          planted go-plant-01:   exit 1 FAIL, HALLUCINATED_EDGE cmd/server -> internal/store
                                 (ground truth 3/2, claimed 3/3)
          demo:                  exit 1 FAIL, HALLUCINATED_EDGE auth.py -> pricing.py,
                                 MISSING_EDGE cart.py -> pricing.py — exactly the README findings
          ground-truth counts:   py 4/3 PASS, ts 4/5 PASS, go 3/2 PASS (match golden.json)
          worktree removed afterwards; all 5 CHECK PASS lines in the log
```

### 2. Offline run — PASS (method: `unshare -n` network namespace)

```text
$ bash tests/offline/run-offline.sh   (log: 03_evidence/T012/OFFLINE.log)
  unshare -n true -> exit 0 (namespace creation permitted on this VM)
  unshare -n cat /proc/net/dev -> only "lo" (0 bytes), no other interface
  unshare -n node -e fetch('http://example.com/') -> UNREACHABLE:EADDRNOTAVAIL
  demo audit online:  exit 1 FAIL, hash dfee636eeae469d131798a2fdb1bfc7399d9adb5bb9b0d4e327a94a4b7ebe369
  demo audit offline: exit 1 FAIL, hash dfee636eeae469d131798a2fdb1bfc7399d9adb5bb9b0d4e327a94a4b7ebe369
  -> hashes identical: True; findings identical: True; statuses FAIL vs FAIL
  control py-c01 inside the namespace: exit 0 PASS, 0 findings
  code-level proof (S0 gate network grep, re-run over src/ + scripts/): grep exit 1 = no matches
  NOTE: the env -i fallback was NOT used — unshare -n is permitted here and is
  the stronger method (it removes the network itself, not just proxy vars).
```

### 3. Performance — PASS (all targets met, nothing shrunk)

```text
$ bash tests/performance/run-performance.sh
  (log: 03_evidence/T012/PERFORMANCE_RUN.log; numbers: PERF_RESULTS.json, PERFORMANCE.md)
  Synthetic repo: 1,000 modules / 5,000 edges (py 400 / ts 300 / go 300),
  generated at test time; ground truth confirmed 1000 modules / 5000 edges,
  entrypoints main.py + ts/main.ts + cmd/main, externalImportCount 0.
  Ground-truth extraction: 0.908 s (target ≤ 30 s), peak RSS 141.2 MB (VmHWM)
  Full audit (PASS, 0 findings, coverage 6003/6003): 2.888 s (target ≤ 60 s),
  peak RSS 228.5 MB (VmHWM) (target ≤ 512 MB)
  Machine: Node v24.22.1, linux/x64, 4 CPUs (AMD EPYC 9D25), 7,934 MB total;
  free -m at run time showed 1,219 MB available (memory pressure noted).
  Peak RSS is the kernel high-water mark of the single Node CLI process,
  sampled from /proc (tests/performance/measure.mjs); /usr/bin/time does
  not exist on this VM. (An earlier run in the same session measured
  1.363 s / 141.2 MB extraction and 3.241 s / 228.1 MB audit — same order.)
```

### 4. Release rehearsal — PASS

```text
$ node scripts/release-rehearsal.mjs   (log: 03_evidence/T012/REHEARSAL.log)
  npm run build exit 0; source.zip + dist.zip + SHA256SUMS.txt in .tmp/rehearsal/
  source.zip sha256: 1f3eafd5e94aeb04e11fb72c76a401c1cb541f1eb505c6b04fcd4d5a76af97af
  dist.zip   sha256: ba2681ba61497ae155b40049335fb05e060c25b78a845565d680ae4eea1c5148
  Baseline (worktree CLI): demo exit 1 FAIL hash dfee636e..., control py-c01 exit 0
    PASS hash 1dab7bc5..., planted py-p01 exit 1 FAIL hash 88a4d7f9...
  Verify source.zip (fresh unzip, npm ci exit 0, rebuild exit 0, same 3 audits):
    all exit codes identical, all canonicalSemanticHash values identical.
  Verify dist.zip (fresh unzip, npm ci exit 0, demo audit with packaged dist,
    no rebuild): exit 1 FAIL, hash dfee636e... — identical to baseline.
  REHEARSAL PASS. Nothing written to 05_release/.
```

### 5. Full suite green + S0 gate still green — PASS

```text
$ cd 02_source && npx vitest run --reporter=verbose
  Test Files  20 passed (20); Tests  254 passed (254)
  (238 pre-existing + 16 new T012: 10 e2e + 5 offline + 1 performance;
   log: 03_evidence/T012/TEST_RUN.log)

$ npm --prefix 02_source run s0:gate -- --replays 100   -> exit 0
  THRESHOLDS: parity 48/48; planted 24/24; control false alarms 0/24;
  replay distinct=1; external=0; source writes=0; goldens changed=0
  S0 GATE VERDICT: PASS
  gate hash: 7d4efa1d97798819c2eee29950d57f0d24ffe5961c273f3c9cd37284e7c437cd
  (identical to the input hash; log: 03_evidence/T012/S0_GATE_RERUN.log)
```

## Decisions / notes for T013+

1. **Go module paths need a dot in the first segment.** My first perf generator used `module perfrepo`; the frozen extractor rule treats a dot-less first segment as stdlib, so all 1,500 Go edges vanished (3500/5000) and `cmd/main` was not recognised as an entrypoint. Fixed by using `module example.com/perfrepo` (mirroring the S0 Go fixtures) and declaring the Go entrypoint as the main.go FILE path (`cmd/main/main.go` — the extractor matches entrypoints to packages by directory). No product code was touched; the generator documents both rules.
2. **No `/usr/bin/time` on this VM** (already noted in T010). Peak RSS is the kernel VmHWM of the single Node CLI process, sampled from /proc by `tests/performance/measure.mjs` (25 ms poll). That helper is reusable for any future timed CLI run.
3. **The rehearsal script contains no network-call tokens** (verified: the S0 gate grep over `src` + `scripts` still exits 1). T014 can reuse `scripts/release-rehearsal.mjs` as the shape, pointing its output at `05_release/` and adding the release manifest.
4. **The perf repo is generated, never committed** (lives under TMPDIR, regenerated each run). Only the generator + expected counts are committed.
5. **The full-suite run rewrites `03_evidence/T011/MUTATION_RESULTS.json`** (new temp-dir suffixes) and the gate rewrites the S0 evidence files (new timestamps) — both were restored with `git checkout`. This is pre-existing behaviour, not a T012 change.

## Next: T013 — Independent review (S5, 8h)

- Owner files: `review/REVIEW_INDEX.md`, `REVIEW_PACK_XX.md`, independent review report; must NOT modify source.
- Consume: this handoff, `03_evidence/T012/` (E2E log, offline proof, PERFORMANCE.md, rehearsal SHAs + verification log, S0 gate re-run), the T011 regression report, `02_source/tests/` (254 tests green).
- T013 acceptance reminder: independent reviewer (different model/session) reviews source, rules and evidence; P0/P1 must be zero before T014.
- Do NOT touch: `src/`, oracle, fixtures, goldens, or T012-owned test/script files except to report a genuine error with evidence (never silently).
