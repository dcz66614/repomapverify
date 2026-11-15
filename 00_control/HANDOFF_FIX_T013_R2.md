# Handoff — FIX T013 R2 (R2-P1-01 + R2-P2-01)

- **Task:** FIX round 2 for T013 re-review round 2 (T013 FAIL: 0 P0, 1 P1, 3 new P2).
- **Date:** 2026-11-14 ~16:51–17:15 GMT
- **Base commit:** `c3f0ac7` (FIX T013) + control `864c131`
- **Result: R2-P1-01 FIXED (systematic excluded-dir alignment, 8 new regression fixtures) + R2-P2-01 FIXED (reproducible release zips).** All acceptance criteria met (see §7).
- **T014 NOT started. `04_review/`, `00_control/HANDOFF_T013.md`, `00_control/HANDOFF_T013_R2.md` untouched.**

## 0. Baseline: every candidate divergence reproduced BEFORE fixing

Verified personally with real commands (never `dist/cli/index.js`, always
`node dist/cli.js`; never taken from the reviewer's word), from `02_source/`
with `TMPDIR=~/workspace/p024-repomapverify/.tmp`. Probe runner:
`03_evidence/FIX_T013_R2/probe-excluded-dirs.py` (builds probe fixture dirs
under `$TMPDIR/probes/`, compares production GT vs Oracle GT module sets +
snapshots + audit verdicts; the claimed map is built from the production GT
so production PASSes by construction and any Oracle disagreement is the
divergence). Pre-fix summary (11 probes):

| Probe | Production | Oracle | Verdict |
|---|---|---|---|
| A py-venv (py-c01 + `venv/lib/pkg.py`, `x = 1\n`) | 4 modules, snap `a80ab95d…`, PASS exit 0 | 5 modules (incl. `venv/lib/pkg.py`), snap `2cdc478e…`, INCOMPLETE | **DIVERGE** (R2-P1-01 as reported; my Oracle snap differs from the reviewer's `d80fefd2…` only because my probe content was `x = 1\n` vs the reviewer's `x=1\n` — same class) |
| A2 py-dotvenv (`.venv/lib/pkg.py`) | 4 modules, snap `a80ab95d…`, PASS | 5 modules, snap `f617b2a0…`, INCOMPLETE | **DIVERGE** |
| E py-pycache (`billing/__pycache__/stray.py`) | 4 modules, PASS | 4 modules, PASS | AGREE |
| B ts-venv (ts-ctrl-01 + `venv/lib/foo.ts`) | 5 modules (incl. `venv/lib/foo.ts`), snap `388a48e0…`, PASS | 5 modules, snap `0a542226…`, INCOMPLETE | **DIVERGE** (snapshot-level: prod snapshot excludes venv, Oracle's didn't) |
| F ts-nodemod (`node_modules/pkg/index.ts`) | 4 modules, PASS | 4 modules, PASS | AGREE |
| C go-nodemod (go-ctrl-01 + `node_modules/pkg/x.go`) | 4 modules (incl. `node_modules/pkg`), PASS | 3 modules, FAIL `HALLUCINATED_MODULE` | **DIVERGE** (live before this round, not just latent) |
| G go-venv (`venv/lib/x.go`) | 4 modules (incl. `venv/lib`), PASS | 4 modules, snap `839f4d7a…`, INCOMPLETE | **DIVERGE** (snapshot-level pre-fix) |
| H go-pycache (`__pycache__/x.go`) | 4 modules (incl. `__pycache__` package!), PASS | 3 modules, FAIL `HALLUCINATED_MODULE` | **DIVERGE** |
| D go-testdata (`testdata/x.go` + `cmd/server/main_test.go`) | 3 modules, PASS | 3 modules, PASS | AGREE |
| ts-pycache (`__pycache__/stray.ts`) | 5 modules (incl. `__pycache__/stray.ts`), PASS | 4 modules, FAIL `HALLUCINATED_MODULE` | **DIVERGE** |
| go-dotvenv (`.venv/lib/x.go`) | 4 modules (incl. `.venv/lib`), PASS | 4 modules, snap `baea76c2…`, INCOMPLETE | **DIVERGE** |

8 divergences, 3 agreements. The audit also covered every skip/exclude set
in both codebases (see §1 table) — nothing was fixed on speculation.

## 1. Excluded-dir alignment audit (production set vs Oracle set)

Production sets (before this fix) and Oracle sets, per surface:

| Surface | Production (pre-fix) | Oracle (pre-fix) | Finding |
|---|---|---|---|
| Snapshot (`computeRepoSnapshotSha256` via `scanRepoFiles`: `DEFAULT_EXCLUDED_DIRS` {`.git`, `node_modules`} + `SNAPSHOT_EXCLUDED_DIRS` {`__pycache__`, `.venv`, `venv`}) — `src/graph/fromRepo.ts:63`, `src/contracts/frozen-scope.ts:62`, `src/identity/symlinks.ts:126` | {`.git`, `node_modules`, `__pycache__`, `.venv`, `venv`} | {`.git`, `node_modules`, `__pycache__`} (`oracle.py:89` `SKIP_DIRS`, via `list_repo_files`) | **DIVERGE** — `.venv`/`venv` missing in Oracle. Fixed Oracle → production (§2). |
| Python enumeration (`src/extractors/python/index.ts:63` `EXCLUDED_DIRS`) | {`.git`, `node_modules`, `__pycache__`, `.venv`, `venv`} | {`.git`, `node_modules`, `__pycache__`} | **DIVERGE** — same missing names. Fixed by the same Oracle change (§2). |
| TypeScript enumeration (`src/extractors/typescript/index.ts:87` `SKIP_DIRS`) | {`.git`, `node_modules`} | {`.git`, `node_modules`, `__pycache__`} (+ `.venv`/`venv` after §2) | **DIVERGE, production wrong** — prod listed `.ts` files under `venv/`/`__pycache__` as modules (probes B, ts-pycache). Fixed production → frozen boundary (§3). |
| Go enumeration (`src/extractors/go/index.ts:104` `SKIP_DIRS`) | {`.git`, `testdata`} | {`.git`, `node_modules`, `__pycache__`, `testdata`} (+ `.venv`/`venv` after §2; `testdata` via `skip_extra`) | **DIVERGE, production wrong** — prod listed `.go` packages under `node_modules/`/`venv/`/`__pycache__` (probes C, G/H, go-dotvenv). Fixed production → frozen boundary (§3). |
| Go `testdata` dir | skipped (prod `SKIP_DIRS`) | skipped (Oracle `list_repo_files(repo, {"testdata"})`, `oracle.py:1219`) | **AGREE** — probe D confirms (both 3 modules, PASS). No change. |
| Go `_test.go` files | excluded as `TEST_FILE` (`src/extractors/go/index.ts:216`) | excluded as `TEST_FILE` (`oracle.py:1303`) | **AGREE** — probe D confirms (a `main_test.go` in `cmd/server` changes nothing on either side). No change. |
| `__pycache__` Python files | skipped (prod Python `EXCLUDED_DIRS`) | skipped (Oracle `SKIP_DIRS`) | **AGREE** — probe E confirms. No change. |
| `node_modules` TS files | skipped (prod TS `SKIP_DIRS`) | skipped (Oracle `SKIP_DIRS`) | **AGREE** — probe F confirms. No change. |
| `.git` | skipped everywhere (all sets above) | skipped (`SKIP_DIRS`) | **AGREE** (no `.go`/`.ts`/`.py` file can live under `.git` in practice; both sets contain it). No change. |

Note the key structural fact the audit exposed: the Oracle funnels
snapshot + all three languages' enumeration through ONE set
(`list_repo_files` + `SKIP_DIRS`), while production has FOUR sets
(snapshot, Python, TS, Go) that disagreed with each other as well as with
the Oracle. Aligning only the Oracle's two missing names would have fixed
the Python/snapshot cases but CREATED two new divergences (TS-in-venv and
Go-in-venv: Oracle would then exclude them while production still listed
them). Hence the fix had to touch both sides (§2 + §3).

## 2. R2-P1-01 (a) — Oracle aligned to production (venv / .venv)

**Direction: Oracle → production. Production is right.**

Rationale (spec-based): PROJECT_BOOK §9's read-only boundary excludes
build/dependency artifacts, and the Oracle's own `__pycache__` exclusion
shows the same intent — a `venv/` is a dependency artifact exactly like
`__pycache__` is a build artifact. Production's Python extractor and its
snapshot scan already excluded both spellings; the Oracle was the odd one
out. (Reviewer's stated fix; adopted after independent reproduction.)

**Fix (Oracle only):** `02_source/oracle/python/oracle.py`
- `:89` `SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv"}`
  (was without `.venv`/`venv`).
- `:130-141` `list_repo_files` docstring updated to the five names + the
  R2-P1-01 rationale; `:154` `snapshot_sha256` docstring updated likewise.
  Both enumeration and snapshot flow through `list_repo_files`, so this
  one change covers both (module count AND snapshot hash).

## 3. R2-P1-01 (b) — Production TS/Go aligned to the frozen boundary

**Direction: production → spec. Production was the wrong side here.**

Rationale (spec-based): PROJECT_BOOK §0.3 — "不扫描 .git、node_modules 和
构建产物，除非明确配置" (never scan .git / node_modules / build artifacts
unless explicitly configured) — and `DEFAULT_EXCLUDED_DIRS`
(`src/contracts/frozen-scope.ts:62`, "Paths never scanned unless explicitly
configured": `.git`, `node_modules`). A `venv/` is a dependency/build
artifact; `__pycache__` is a build artifact; `node_modules` is named
explicitly. Production's TS/Go extractors scanning them contradicted the
frozen boundary the Oracle already implemented. (This also closes the
first half of carried P2-06 — "Go scans node_modules" — as a side effect
of the alignment fix, not as a standalone P2 fix; P2-06's other half,
`_test.go`/`testdata` without documented basis, is unchanged and stays
carried: both sides already agree there, probe D.)

**Fixes (production only):**
- `02_source/src/extractors/typescript/index.ts:87-101` — `SKIP_DIRS`
  `{".git", "node_modules"}` → `{".git", "node_modules", "__pycache__",
  ".venv", "venv"}` (comment at `:102` + rationale comment at `:88-94`
  updated). Now identical to the Oracle's `SKIP_DIRS` and the Python
  extractor.
- `02_source/src/extractors/go/index.ts:104-122` — `SKIP_DIRS`
  `{".git", "testdata"}` → `{".git", "testdata", "node_modules",
  "__pycache__", ".venv", "venv"}` (comment at `:124` + rationale comment
  at `:104-113` updated). `testdata` and the `_test.go` exclusion are
  untouched.
- Comment-only accuracy fixes: `02_source/src/extractors/python/index.ts:5`
  (header now lists `venv` as well as `.venv`) and
  `02_source/src/extractors/python/types.ts:86-87` (snapshot docstring now
  lists `.venv`/`venv`). No behaviour change.

## 4. Regression fixtures + goldens (8 new, one per reproduced divergence)

All under `02_source/tests/fixtures/regression/` (outside the S0 gate set,
same pattern as FIX T013), each with `repo/`, `claimed-map.json`,
`expected.json` = PASS, 0 findings. Covered by
`02_source/tests/golden/regression-t013.test.ts` (header comment + exact-set
list updated to the 12 fixtures; the test runs BOTH implementations per
fixture and asserts verdict + finding agreement with each other and with
`expected.json`).

| Fixture | Repo extra file | Map source |
|---|---|---|
| `py-venv` | py-c01 repo + `venv/lib/pkg.py` (`x=1\n` — reviewer's exact probe content) | Reviewer's `03_evidence/T013_R2/venv/edge-venv-map.json` verbatim (production snapshot `a80ab95d…`) |
| `py-dotvenv` | py-c01 repo + `.venv/lib/pkg.py` (`x=1\n`) | Reviewer's `03_evidence/T013_R2/venv/edge-dotvenv-map.json` verbatim (same snapshot) |
| `ts-venv` | ts-ctrl-01 repo + `venv/lib/foo.ts` (`export const x = 1;`) | Generated from post-fix production GT (4 modules, snapshot `388a48e0…`) |
| `ts-pycache` | ts-ctrl-01 repo + `__pycache__/stray.ts` | Generated from post-fix production GT (4 modules, snapshot `388a48e0…`) |
| `go-nodemod` | go-ctrl-01 repo + `node_modules/pkg/x.go` | Generated from post-fix production GT (3 modules, snapshot `2bfd7633…`) |
| `go-venv` | go-ctrl-01 repo + `venv/lib/x.go` | Generated from post-fix production GT (3 modules, snapshot `2bfd7633…`) |
| `go-dotvenv` | go-ctrl-01 repo + `.venv/lib/x.go` | Generated from post-fix production GT (3 modules, snapshot `2bfd7633…`) |
| `go-pycache` | go-ctrl-01 repo + `__pycache__/x.go` | Generated from post-fix production GT (3 modules, snapshot `2bfd7633…`) |

Post-fix probe re-run: **all 11 probes AGREE** (see §7.4 and
`03_evidence/FIX_T013_R2/agreement-reruns.log`).

## 5. R2-P2-01 — release zips reproducible (FIXED)

**Root cause (confirmed):** `scripts/release-build.mjs` zipped with plain
`zip -qr -X` over freshly staged trees, so entry mtimes were the run time.
Two pre-fix runs differed (reviewer: run 1 source `ed1993f7…` / dist
`d67107cf…`, run 2 source `67ad70a5…` / dist `030b7bdd…`).

**Fix:** `02_source/scripts/release-build.mjs`
- `releaseEpochSeconds()` (`:92-103`): fixed timestamp precedence —
  `$SOURCE_DATE_EPOCH` if set, else the HEAD commit time
  (`git log -1 --format=%ct`), else fixed fallback `1735689600`
  (2025-01-01T00:00:00Z) for trees without git history.
- `pinMtimes(dir, epoch)` (`:105-122`): pins atime/mtime of every staged
  entry (files, dirs, symlinks via `lutimesSync`) to the epoch, called for
  both stages (`:204-205`) after staging, before zipping.
- `rewriteStagedSymlinks(dir, srcRoot)` (`:136-165`), called at `:198-199`:
  while verifying, the zips still had ONE entry with a non-pinned date
  (`tests/fixtures/regression/py-symlink-snapshot/repo/docs-link.txt`,
  `2026-11-14 16:32:42`). Root cause found and fixed in the same round:
  Node 24's `cpSync` rewrites a relative symlink target to an ABSOLUTE
  path in the copy (verified in isolation: `ln -s docs.txt` + `cpSync`
  → target `/tmp/cptest/a/docs.txt`), and Info-ZIP `zip` follows
  symlinks by default (no `-y`), so it timestamped the link from its
  out-of-stage worktree target — a different mtime on every checkout.
  The function rewrites absolute in-tree targets back to the relative
  spelling from the repo (`docs-link.txt -> docs.txt`), leaving
  out-of-tree targets alone with a warning. (Note: `zip` still stores
  the link as a regular file with the staged target's content — that is
  the pre-existing `zip` behaviour, unchanged; what matters is the
  followed target is now the in-stage, mtime-pinned file.)
- No literal URL scheme added anywhere in `src/` or `scripts/`.

**Verification (two runs, §7.5):** run 1 and run 2 produce IDENTICAL SHAs:
source `78fff755b29b793a491d6dcf8c2ae5e97a89e2c822f936b92a08e1b9e1bc415c`,
dist `5ca9dee6511ae8899b77be4de9dc872bc33b675efe4af20d5148d98debe1d649`.
All 1186 source.zip + 134 dist.zip entries carry exactly one
`date_time`: `(2026, 11, 14, 16, 51, 20)` = the HEAD commit time
(`1794675080`). `npm run release:verify` exits 0 afterwards, and the
SHAs are unchanged after verify re-ran the build internally. (The
source SHA differs from the pre-symlink-fix run `bc62cf45…` because the
stored link target changed from absolute to relative — intended.)

## 6. Carried, NOT fixed

- **R2-P2-02** (conflicting both-spellings snapshot: production exit 3 vs
  Oracle STALE_SNAPSHOT) — invalid input, neither side passes it. Carried.
- **R2-P2-03** (gate mirror `auditFromGT` stale entrypoint/snapshot rules)
  — inert for the 48 fixtures. Carried.
- **Round-1 carried P2s P2-02–P2-10, P2-13–P2-20** — all stay carried.
  Exception to note: P2-06's first half (Go scans `node_modules`) is now
  MOOT as a behaviour (Go no longer scans it, §3) but is recorded here as
  resolved-by-alignment rather than closed as a P2 fix; its second half
  (`_test.go`/`testdata` exclusion basis) is unchanged and stays carried.
  P2-13 re-observed this round (test/gate runs dirtied
  `03_evidence/S0/S0_GATE.json`, `S0_GATE.log`,
  `T011/MUTATION_RESULTS.json`, `T012/PERF_RESULTS.json` with
  timestamp/temp-name-only diffs; all four restored with
  `git checkout -- <path>`).

## 7. Verification (exact commands + outputs)

All run from `02_source/` with `TMPDIR=~/workspace/p024-repomapverify/.tmp`
unless noted. Evidence in `03_evidence/FIX_T013_R2/`.

1. `npm run build` → **exit 0** (`build.log`).
2. `npx vitest run` → **270/270 passed, 21 files** (was 262/262; +8 = the
   8 new regression fixture tests). Log: `vitest.log`.
3. `npm run s0:gate -- --replays 100` → **PASS, exit 0**, gate hash
   `7d4efa1d97798819c2eee29950d57f0d24ffe5961c273f3c9cd37284e7c437cd`
   (**UNCHANGED**), parity 48/48, planted 24/24, control false alarms
   0/24, replay distinct 1, external 0, source writes 0, goldens
   changed 0. Log: `s0-gate.log`.
4. Agreement re-runs (`agreement-reruns.log`, runner
   `probe-excluded-dirs.py`): all 11 probes **AGREE** post-fix
   (8 former divergences + 3 former agreements). Plus the reviewer's
   exact case via the REAL CLI entry point on the committed fixtures:
   - `py-venv`: `node dist/cli.js audit --repo
     tests/fixtures/regression/py-venv/repo --map
     tests/fixtures/regression/py-venv/claimed-map.json` → **exit 0,
     RESULT: PASS**; Oracle `--fixture-dir` → **PASS, 4 modules,
     snapshot `a80ab95d7bbadab0dd069e36ce15a2fcca301c0a0f0183710accfca287f11404`**,
     0 findings. Logs: `venv-py-venv-prod.log`, `venv-py-venv-oracle.json`.
   - `py-dotvenv`: same — **prod exit 0 PASS / Oracle PASS, 4 modules,
     same snapshot `a80ab95d…`, 0 findings**. Logs:
     `venv-py-dotvenv-prod.log`, `venv-py-dotvenv-oracle.json`.
   - Production GT on py-venv repo: 4 modules, snapshot `a80ab95d…`.
5. `npm run release:build` (twice, 3 s apart) → **exit 0 both**;
   **identical SHAs both runs**: source
   `78fff755b29b793a491d6dcf8c2ae5e97a89e2c822f936b92a08e1b9e1bc415c`,
   dist
   `5ca9dee6511ae8899b77be4de9dc872bc33b675efe4af20d5148d98debe1d649`;
   timestamp `1794675080 (2026-11-14T16:51:20.000Z)` (HEAD commit time);
   all zip entries one `date_time`. Logs: `release-build-run1.log`,
   `release-build-run2.log`.
6. `npm run release:verify` → **exit 0** (`RELEASE:VERIFY PASS: exit
   codes and canonicalSemanticHash values identical in all
   verifications.`); SHAs unchanged afterwards. Log:
   `release-verify.log`.

## 8. Files changed

- Modified: `02_source/oracle/python/oracle.py`,
  `02_source/src/extractors/typescript/index.ts`,
  `02_source/src/extractors/go/index.ts`,
  `02_source/src/extractors/python/index.ts` (comment only),
  `02_source/src/extractors/python/types.ts` (comment only),
  `02_source/scripts/release-build.mjs`,
  `02_source/tests/golden/regression-t013.test.ts`.
- Added: `02_source/tests/fixtures/regression/{py-venv,py-dotvenv,ts-venv,ts-pycache,go-nodemod,go-venv,go-dotvenv,go-pycache}/{repo,claimed-map.json,expected.json}`,
  `00_control/HANDOFF_FIX_T013_R2.md` (this file),
  `03_evidence/FIX_T013_R2/` (build.log, vitest.log, s0-gate.log,
  agreement-reruns.log, probe-excluded-dirs.py, venv-py-venv-prod.log,
  venv-py-venv-oracle.json, venv-py-venv-prod-out/,
  venv-py-dotvenv-prod.log, venv-py-dotvenv-oracle.json,
  venv-py-dotvenv-prod-out/, release-build-run1.log,
  release-build-run2.log, release-verify.log).
