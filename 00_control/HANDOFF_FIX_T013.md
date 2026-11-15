# Handoff — FIX T013 (P1-01 / P1-02 / P1-03 + P2-01 / P2-11 / P2-12)

- **Task:** FIX task for T013 review findings (T013 FAIL: 0 P0, 3 P1, 20 P2).
- **Date:** 2026-11-14 ~16:30–16:45 GMT
- **Base commit:** `c00bd9c` (T013 IN_PROGRESS; tree clean except T013 outputs)
- **Result: ALL THREE P1s FIXED + P2-01, P2-11, P2-12 FIXED.** All acceptance criteria met (see §7).
- **T014 NOT started. `04_review/` and `00_control/HANDOFF_T013.md` untouched.**

## 0. Baseline: all three divergences reproduced before fixing

Verified personally with real commands (not taken from the reviewer's word),
from `02_source/` with `TMPDIR=~/workspace/p024-repomapverify/.tmp`:

| Experiment | Production CLI (pre-fix) | Oracle (pre-fix) |
|---|---|---|
| E1 Go literal entrypoint (`entrypoints: ["cmd/server/main.go"]` on go-ctrl-01) | exit 0, PASS, 0 findings | FAIL, `WRONG_ENTRYPOINT: cmd/server/main.go` |
| E2 snake_case snapshot (py-c01 map, `repo_snapshot_sha256`) | exit 0, PASS (+2 snake_case warnings) | `STALE_SNAPSHOT` / INCOMPLETE |
| E4 symlink snapshot (py-c01 repo + `docs.txt` + symlink `docs-link.txt -> docs.txt`, map bound to production snapshot) | exit 0, PASS, snapshot `429867e5…` | `STALE_SNAPSHOT` / INCOMPLETE, snapshot `c7439aff…` |

Note: my E4 recreation used `docs.txt` = `RepoMapVerify symlink snapshot fixture.\n`,
so its hashes (`429867e5…` / `c7439aff…`) differ from the reviewer's
(`326f2e56…` / `bd4cf266…`, different file content) — same divergence class.
Pre-fix Oracle outputs are preserved in `03_evidence/FIX_T013/oracle-E{1,2,4}-pre-fix.json`
(regenerated from the HEAD Oracle via `git show HEAD:02_source/oracle/python/oracle.py`;
E4's regenerated output verified byte-identical to the original pre-fix file — see §8 note).
Also confirmed numerically that production's canonical symlink path is the
SMALLEST normalized path (`docs-link.txt` beats `docs.txt` since `-` < `.`),
i.e. `groupByRealPath` smallest-wins.

## 1. P1-01 — Go literal entrypoint spelling

**Alignment direction: Oracle aligned to production. Production is right.**

Rationale (spec-based): `.repomapverify.toml` declares entrypoints as FILE paths
(`paths = ["cmd/server/main.go"]`, PROJECT_BOOK §6.1 file-path example), and a Go
agent naturally claims the file path it was told. Production
(`src/comparator/compare.ts:358-362`, Rule 4) accepts both spellings — the module
path it resolves to (`cmd/server`) and the literal toml spelling
(`cmd/server/main.go`). The Oracle compared against package dirs only, so a map
claiming exactly what the toml declares failed. The rule must be one rule in both
implementations; the production reading is the spec-faithful one.

**Fix (Oracle only — no production change):** `02_source/oracle/python/oracle.py`
- `GoOracle.__init__` line ~1233: stores `self.entrypoint_literal_paths = list(toml_paths)`
  (the toml spellings, alongside the derived package dirs in `self.entrypoints`).
  `PythonOracle` (~401) and `TypeScriptOracle` (~701) store the same attribute
  (there it equals `self.entrypoints`, since those declarations already are file
  paths — kept for a uniform audit interface).
- `audit_claimed_map(gt, claimed, declared_literal_entrypoints=None)` (~1490):
  when a declaration exists, the accepted set is now
  `set(declared) | set(declared_literal_entrypoints)` (~1551-1556).
- `run_fixture` (~1651): passes the oracle's `entrypoint_literal_paths` through.
  **The ground-truth dict is unchanged** (no new key in `gt`), so the S0 gate hash
  — which hashes the full Oracle output — cannot move on this change.

**Regression fixture + golden:** `02_source/tests/fixtures/regression/go-literal-entrypoint/`
(`repo/` = copy of go-ctrl-01 repo; `claimed-map.json` = the reviewer's
`03_evidence/T013/go-literal-entrypoint-map.json` verbatim;
`expected.json` = PASS, 0 findings).

## 2. P1-02 — snake_case `repo_snapshot_sha256`

**Alignment direction: Oracle aligned to production. Production is right.**

Rationale: PROJECT_BOOK §6.1 spells the field snake_case
(`repo_snapshot_sha256`); the production validator bridge
(`src/io/validate-claimed-map.ts:100-135`, `resolveAliasedStringField`) is the
frozen rule — alias accepted with a warning, both spellings with different values
rejected. The Oracle read only the camelCase key, so a spec-example-conforming
map passed the CLI and failed the Oracle.

**Fix (Oracle only):** `02_source/oracle/python/oracle.py`
- New `_resolve_claimed_snapshot(claimed)` (~1475): camelCase wins; snake_case
  accepted; both present with different values = conflict.
- `audit_claimed_map` (~1594): snapshot status now uses the resolved value.
  A conflict reads as `STALE_SNAPSHOT` here — see the residual difference in §6:
  the Oracle audit has no validation-error channel (production rejects such a map
  with exit 3). Valid inputs now agree exactly.

**Regression fixture + golden:** `02_source/tests/fixtures/regression/py-snake-snapshot/`
(`repo/` = copy of py-c01 repo; `claimed-map.json` = the reviewer's
`03_evidence/T013/snake-snapshot-map.json` verbatim;
`expected.json` = PASS, 0 findings).

## 3. P1-03 — Symlink snapshot

**Alignment direction: Oracle aligned to production. Production is right.**

Rationale: the T008 freeze note (`03_evidence/T008/SNAPSHOT_FREEZE.md`) and the
`src/canonical/index.ts` header freeze the GRAPH snapshot as over PHYSICAL files —
in-repo symlink spellings collapse to the canonical (smallest normalized) path, one
line per physical file — and that collapsed hash is the shipped snapshot the CLI
binds maps to (`computeRepoSnapshotSha256` in `src/graph/fromRepo.ts:72-90` via
`groupByRealPath`). The Oracle listed every spelling, so it computed a different
hash for the same tree. The Oracle must implement the same physical-file rule.

**Fix (Oracle only):** `02_source/oracle/python/oracle.py`
- New `_snapshot_sort_key` (~143): mirrors production `compareNormalizedPaths`
  (NFC first, then plain code-unit order).
- Rewrote `snapshot_sha256` (~151): groups listed files by `os.path.realpath`,
  keeps the smallest normalized spelling per physical file as the canonical line,
  sorts the lines, hashes. Symlinks whose target resolves OUTSIDE the repo and
  broken symlinks contribute no line (production never follows them). Only
  `snapshot_sha256` changed — `list_repo_files` (used by the extractors for module
  enumeration) is untouched. On symlink-free repos the grouping is identity, so
  all 48 S0 fixtures hash exactly as before.

**Regression fixture + golden:** `02_source/tests/fixtures/regression/py-symlink-snapshot/`
(`repo/` = py-c01 repo + `docs.txt` (`RepoMapVerify symlink snapshot fixture.\n`)
+ symlink `docs-link.txt -> docs.txt`; `claimed-map.json` = py-c01 map bound to the
production (collapsed) snapshot `429867e5e376d9c009fc8fb54e7b126b95c750235aa359bd5cb3ed328930ff0a`
— that hash was independently recomputed from the frozen algorithm over the
collapsed file list (Python one-liner, from the words in `src/canonical/index.ts`,
not from production output) and matched; `expected.json` = PASS, 0 findings).
The symlink is committed as a real symlink (git mode 120000).

## 4. Fixture placement decision (applies to all P1s + P2-01)

**The new fixtures live in `02_source/tests/fixtures/regression/`, NOT in the S0
gate set.** The S0 gate's 48-fixture count and gate hash must not change; the new
fixtures are covered by a separate suite,
`02_source/tests/golden/regression-t013.test.ts`, which runs BOTH implementations
on each fixture dir (production in-process via validator + ground-truth builder +
evidence collector + comparator; the Oracle via `python3 oracle.py --fixture-dir`)
and asserts the two verdicts AND finding sets agree with each other and with the
hand-written `expected.json`. The gate's `listFixtures` scans only
`tests/fixtures/s0/`, so the new dir is invisible to it — verified: gate still
reports 48 fixtures, hash unchanged (§7).

## 5. P2-01 — Module-level `generated` assertion (FIXED, small and safe)

Implemented per the T008 decision record
(`03_evidence/T008/GENERATED_MISMATCH_DECISION.md`): compare claimed `generated`
against ground-truth `isGenerated` when asserted, as a P2-severity,
non-verdict-flipping finding. No S0 fixture asserts `generated`, so the gate is
unaffected (verified: gate PASS, same hash).

- Production: `02_source/src/findings/findings.ts:261-276` — new
  `generatedModuleMismatchFinding(path, asserted, actual, claimedJsonPath)`.
  `02_source/src/comparator/compare.ts` — `NormalizedClaim.modules` now carries
  `generated?: boolean` (~196); Rule 2 (~330-349) emits the finding when a
  resolved module's assertion disagrees. **Deliberate scope choice:** the finding
  is NOT added to `unverifiedModules` — the module itself is verified to exist,
  only its generated-ness assertion is wrong — so it never flips the verdict and
  never reduces coverage. Header Rule 2 documents this.
  `02_source/src/contracts/claimed-map.ts` — doc comment updated (rule no longer
  "future work").
- Oracle mirror (to avoid creating a NEW production/Oracle divergence of the same
  class): `oracle/python/oracle.py` `audit_claimed_map` (~1537-1546) emits
  `GENERATED_MISMATCH` (P2, not FAIL-class, not INCOMPLETE-forcing) for an asserted
  module whose `isGenerated` disagrees. Absent assertion = no judgement, both sides.
- Fixture: `02_source/tests/fixtures/regression/py-generated-assert/`
  (py-c01 repo; map asserts `billing/auth.py generated: true` — hand-written, wrong
  — and `main.py generated: false` — right; `expected.json` = PASS with exactly one
  finding `GENERATED_MISMATCH` from `billing/auth.py`).
- Unit tests: 3 new tests in `02_source/tests/comparator/comparator.test.ts`
  (wrong assertion on hand-written module, wrong assertion on generated module,
  correct/absent assertions → no finding; coverage unchanged asserted in the first).

## 6. P2-11 — Three frozen npm scripts (FIXED)

`package.json:27-31` froze `release:build`, `release:verify`, `verify:all` but the
files did not exist (all exited 1, `Cannot find module`). Added, wired to the
existing working paths (T012's `scripts/release-rehearsal.mjs` is the de facto
packaging path; its staging lists and audit cases are reused verbatim):

- `02_source/scripts/release-build.mjs` (117 lines): `npm run build`, stage source
  + dist trees (same file lists as the rehearsal), zip both, write `SHA256SUMS.txt`
  under `TMPDIR/release-build` (NOT `05_release/`, which is T014's). Exit 0.
- `02_source/scripts/release-verify.mjs` (177 lines): verifies the packages
  `release:build` produced (runs the build first if they are absent): baseline
  audits from this worktree's CLI (demo exit 1, py-c01 exit 0, py-p01 exit 1),
  then source.zip (unzip fresh, `npm ci`, rebuild, 3 cases, exit codes AND
  `canonicalSemanticHash` must match baseline) and dist.zip (unzip fresh,
  `npm ci`, demo audit with packaged dist, same comparison). Exit 0.
- `02_source/scripts/verify-all.mjs` (56 lines): `npm run build`, then
  `npx vitest run`, then `node scripts/s0-gate.mjs --replays 100`, stopping at the
  first failure. Exit 0.
- All three run exit 0 (see §7). No literal URL scheme or network-call token was
  added to `src/` or `scripts/` — the S0 gate's external-request grep still finds
  0 matches (`external=0` in the gate run after the scripts existed).

## 7. P2-12 — CI workflow `MAP_PATH` (FIXED)

`02_source/.github/workflows/repomapverify.yml:47`: added
`MAP_PATH: demo/claimed-map.json` to the `env` block (with a comment explaining
the fix). Verified:
- Pre-fix behaviour re-confirmed: `--map ""` → exit 3
  (`Error: cannot read claimed map file "": EISDIR…`).
- Workflow env parsed from the YAML: `{REPO_PATH: demo/repo,
  MAP_PATH: demo/claimed-map.json, ALLOW_INCOMPLETE: 'false'}`.
- Audit-step body run locally with exactly those values → exit 1, the documented
  FAIL demonstration (`HALLUCINATED_EDGE auth.py -> pricing.py`,
  `MISSING_EDGE cart.py -> pricing.py`), not exit 3.
- Clean-checkout check (scratch copy, `npm ci` + `npm run build`, then `npx`):
  `npm ci` exit 0, build exit 0, `npx repomapverify --help` exit 0,
  `npx repomapverify audit --repo demo/repo --map demo/claimed-map.json` exit 1.
  (Local note: in THIS checkout `npx repomapverify` exits 127 — the local
  `node_modules` was never installed by `npm ci` from the current lockfile, so
  npx's reify fails; after a clean `npm ci` it works. Not a workflow defect.)

## 8. Verification (exact commands + outputs)

All run from `02_source/` with `TMPDIR=~/workspace/p024-repomapverify/.tmp`,
unless noted. Evidence in `03_evidence/FIX_T013/`.

1. `npm run build` → **exit 0** (`03_evidence/FIX_T013/build.log`).
2. `npx vitest run` → **262/262 passed, 21 files** (was 254/254 in 20 files;
   +8 = 5 regression tests + 3 comparator unit tests).
   Log: `03_evidence/FIX_T013/vitest.log`.
3. `npm run s0:gate -- --replays 100` → **PASS, exit 0**, gate hash
   `7d4efa1d97798819c2eee29950d57f0d24ffe5961c273f3c9cd37284e7c437cd`
   (**UNCHANGED**), parity 48/48, planted 24/24, control false alarms 0/24,
   replay distinct 1, external 0, source writes 0, goldens changed 0.
   Log: `03_evidence/FIX_T013/s0-gate.log`.
4. Agreement re-runs (`03_evidence/FIX_T013/agreement-reruns.log`):
   reviewer experiments E1/E2/E4 (same maps/repos) + all 4 regression fixtures,
   production CLI vs Oracle — **all 7 AGREE**:
   - E1: prod exit 0 PASS / Oracle PASS, MATCH, 0 findings.
   - E2: prod exit 0 PASS / Oracle PASS, MATCH, 0 findings.
   - E4: prod exit 0 PASS / Oracle PASS, MATCH, 0 findings;
     Oracle snapshot now `429867e5…` = production (was `c7439aff…`).
   - go-literal-entrypoint / py-snake-snapshot / py-symlink-snapshot: both PASS.
   - py-generated-assert: both PASS with exactly `GENERATED_MISMATCH` from
     `billing/auth.py`.
   Pre-fix Oracle outputs: `oracle-E{1,2,4}-pre-fix.json`; post-fix:
   `oracle-E{1,2,4}-post-fix.json`.
5. `npm run release:build` → **exit 0**; source.zip sha
   `038006662b7b6cfd4429d44ee3d51ecbae14a1cbf2c61afd7b9c03310b0b3d14`,
   dist.zip sha `84bb4c2487febca473b2ca4cb35241a08fd8bb5e684a3dde89fd4b298693ff0c`.
   Log: `release-build.log`.
6. `npm run release:verify` → **exit 0**; baseline vs source.zip vs dist.zip exit
   codes and `canonicalSemanticHash` values identical in all verifications.
   Log: `release-verify.log`.
7. `npm run verify:all` → **exit 0** (build + 262 vitest + S0 gate PASS, same hash).
   Log: `verify-all.log`.
8. Workflow check: see §7 above. Log: `03_evidence/FIX_T013/workflow-check.log`.

Discipline notes: test/gate runs rewrote timestamps/temp-dir names inside the
committed evidence files (`03_evidence/S0/S0_GATE.json`, `S0_GATE.log`,
`T011/MUTATION_RESULTS.json`, `T012/PERF_RESULTS.json`) — diffs were timestamp /
temp-name / timing only (P2-13) and all four were restored with
`git checkout -- <path>`; the final tree is clean except the intended changes.
Scratch note: the pre-fix `oracle.json`/`out/` files in the `.tmp` baseline dirs
for E1/E2 disappeared at some point during the task (cause unknown; `.tmp` scratch
only, never repo files) — the pre-fix artifacts in evidence were regenerated from
the HEAD Oracle and E4's regenerated output verified byte-identical to its
original pre-fix file.

## 9. Carried P2s (NOT fixed — do not touch)

P2-02 (adapters library-only), P2-03 (`gitCommit` never populated), P2-04
(generated-edge exclusion differs per language), P2-05 (TS/Go unreadable files
silently skipped), P2-06 (Go scans `node_modules`, excludes `_test.go`/`testdata`),
P2-07 (platform case adapters never wired into CLI), P2-08 (malformed toml
swallowed by TS/Go extractors), P2-09 (INCOMPLETE causes with no finding),
P2-10 (infoFindings not itemized on CLI stdout), P2-13 (test/gate runs dirty
committed evidence — observed again this task, restored), P2-14 (golden
provenance), P2-15 (`PYTHON_STDLIB_TOP_LEVEL` dead data), P2-16 (TS/Go edge
evidence is reconstructed), P2-17 (`kind`/`repo` never checked), P2-18
(repo-root `__init__.py` excluded), P2-19 (identity conflicts FAIL-class),
P2-20 (toml parser rejects multi-line `paths` arrays).

## 10. Residual known differences (recorded, not fixed)

- **Conflicting snapshot spellings** (both `repoSnapshotSha256` and
  `repo_snapshot_sha256` present with different values): production rejects the map
  (validation error, exit 3); the Oracle audit reports `STALE_SNAPSHOT` /
  INCOMPLETE — the audit has no validation-error channel. Valid inputs agree.
- **Gate's Node mirror** (`scripts/s0-gate.mjs` `auditFromGT`) still compares Go
  entrypoints against package dirs only and reads only the camelCase snapshot key.
  It only ever sees the 48 frozen fixtures (none claims a literal spelling or a
  snake_case snapshot), so the gate is unaffected; a future gate revision should
  mirror the Oracle fixes if the fixture set ever grows.
- **Snapshot excluded dirs**: the Oracle excludes `.git` / `node_modules` /
  `__pycache__`; production additionally excludes `.venv` / `venv`. Pre-existing,
  no S0 fixture has either dir, out of scope for this fix.

## 11. Files changed

- Modified: `02_source/oracle/python/oracle.py`,
  `02_source/src/comparator/compare.ts`,
  `02_source/src/contracts/claimed-map.ts`,
  `02_source/src/findings/findings.ts`,
  `02_source/tests/comparator/comparator.test.ts`,
  `02_source/.github/workflows/repomapverify.yml`.
- Added: `02_source/scripts/release-build.mjs`,
  `02_source/scripts/release-verify.mjs`,
  `02_source/scripts/verify-all.mjs`,
  `02_source/tests/golden/regression-t013.test.ts`,
  `02_source/tests/fixtures/regression/{go-literal-entrypoint,py-snake-snapshot,py-symlink-snapshot,py-generated-assert}/{repo,claimed-map.json,expected.json}`,
  `00_control/HANDOFF_FIX_T013.md` (this file),
  `03_evidence/FIX_T013/` (build.log, vitest.log, s0-gate.log,
  agreement-reruns.log, workflow-check.log, release-build.log,
  release-verify.log, verify-all.log, oracle-E{1,2,4}-{pre,post}-fix.json).
