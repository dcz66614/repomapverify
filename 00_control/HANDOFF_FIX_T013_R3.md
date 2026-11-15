# Handoff — FIX T013 R3 (R3-P1-01)

- **Task:** FIX round 3 for T013 re-review round 3 (T013 FAIL: 0 P0, 1 new P1, 0 new P2).
- **Date:** 2026-11-14 ~17:08–17:30 GMT
- **Base commit:** `54ea5ec` (control on top of `b789dc5` FIX T013 R2).
- **Result: R3-P1-01 FIXED.** Oracle + gate mirror now short-circuit on STALE_SNAPSHOT exactly like production Rule 1. 4 new regression fixtures (both directions + dynamic). All acceptance criteria met (see §7).
- **T014 NOT started. `04_review/REVIEW_REPORT_R3.md`, `00_control/HANDOFF_T013*.md` untouched.**

## 0. Baseline: R3-P1-01 reproduced BEFORE fixing (all 3 directions DIVERGE)

Verified personally with real commands (always `node dist/cli.js`, never the
`dist/cli/index.js` stub; true exit codes captured WITHOUT a pipe), from
`02_source/` with `TMPDIR=~/workspace/p024-repomapverify/.tmp`. Probe runner:
`03_evidence/FIX_T013_R3/repro-stale.py` (builds probe dirs under
`$TMPDIR/r3-probes/` from the S0 control fixtures; the claimed map is the S0
control map so production's behaviour is the reference). Pre-fix summary
(`03_evidence/FIX_T013_R3/repro-pre.log`, per-case artifacts in
`agreement-pre/`):

| Probe | Production (real CLI) | Oracle (pre-fix) | Verdict |
|---|---|---|---|
| py-stale-missing (coordinator probe: py-c01 repo + `extra.py` = `import billing.api` at root, map bound to the clean snapshot `a80ab95d…`) | exit 2, INCOMPLETE, STALE_SNAPSHOT, 0 findings | FAIL, STALE_SNAPSHOT, 1 × MISSING_EDGE `extra.py -> billing/api.py` | **DIVERGE** — matches the coordinator's probe exactly (exit 2, 0 findings) |
| py-stale-halluc (reviewer probe, reconstructed: py-c01 clean repo, map snapshot all-zeros + claimed hallucinated edge `billing/api.py -> billing/nonexistent.py` + module) | exit 2, INCOMPLETE, STALE_SNAPSHOT, 0 findings | FAIL, STALE_SNAPSHOT, HALLUCINATED_EDGE + HALLUCINATED_MODULE | **DIVERGE** — matches the reviewer's probe exactly |
| ts-stale-missing (reviewer probe: ts-ctrl-01 + `extra.ts` at root importing `./src/util`, map bound to the clean snapshot `388a48e0…`) | exit 2, INCOMPLETE, STALE_SNAPSHOT, 0 findings | FAIL, STALE_SNAPSHOT, 1 × MISSING_EDGE `extra.ts -> src/util.ts` | **DIVERGE** — matches the reviewer's probe exactly |

Root cause confirmed in code (same as the report): production Rule 1
(`src/comparator/compare.ts:283-293`) short-circuits on STALE_SNAPSHOT →
INCOMPLETE with zero findings; the Oracle (`audit_claimed_map`, old
`:1609-1618`) computed findings first and let any FAIL-class finding win
over the snapshot status. Spec sides with production (PROJECT_BOOK §5.1:
snapshot mismatch → STALE_SNAPSHOT/INCOMPLETE, "不得把旧地图的错误归咎于
Agent").

## 1. R3-P1-01 (a) — Oracle mirrors production Rule 1 exactly

**File:** `02_source/oracle/python/oracle.py`, `audit_claimed_map`.

- Snapshot resolution moved to the TOP of the function (`:1546-1555`):
  `_resolve_claimed_snapshot` (camelCase wins / snake_case accepted /
  conflicting spellings = conflict) is called first, `snapshot_status`
  is computed, and when it is STALE_SNAPSHOT — **including the
  snapshot-conflict case** — the function returns immediately
  `{"status": "INCOMPLETE", "snapshotStatus": "STALE_SNAPSHOT",
  "findings": [], "unknownImportsPresent": <computed>}`. No finding of
  any kind (FAIL-class, DYNAMIC_IMPORT_UNKNOWN, GENERATED_MISMATCH,
  anything) is computed in that branch.
- The old duplicated snapshot resolution at the bottom of the function
  was removed; the trailing status logic now only handles the MATCH case
  (the `or snapshot_status != "MATCH"` arm is gone, with a comment
  explaining why). The docstring (`:1515-1555`) now states the
  short-circuit rule and the `unknownImportsPresent` decision.
- No other Oracle behaviour changed: for MATCH snapshots the finding
  computation and the FAIL > INCOMPLETE > PASS precedence are byte-for-byte
  the old logic.

**`unknownImportsPresent` decision (recorded): KEPT COMPUTED from ground
truth in the stale branch.** Rationale: it is a fact about the current
tree (whether the tree has a non-dynamic unresolvable import), not a
blame finding on the claimed map — the map is never blamed for it, the
field carries no finding, and production has no equivalent report field
to conflict with. The gate compares verdict + findings, so either choice
would be acceptable; keeping it computed preserves tree information
instead of misreporting it as false. Verified directly
(`oracle-stale-unknown.log`): a synthetic GT with a non-dynamic unknown
import + stale snapshot returns `unknownImportsPresent: true` with
`findings: []`. Note: no S0 golden has a non-dynamic unknown import
(checked all 48 goldens), so the field is `false` for every fixture in
the suite either way — the decision is unobservable in the gate hash.

## 2. R3-P1-01 (b) — Gate mirror `auditFromGT` aligned the same way

**File:** `02_source/scripts/s0-gate.mjs`, `auditFromGT` (`:381-472`).

- Same restructuring as the Oracle: `snapshotStatus` + `unknownPresent`
  are computed FIRST; on STALE_SNAPSHOT the function returns
  `{status: "INCOMPLETE", snapshotStatus, findings: [],
  unknownImportsPresent}` before any finding is computed. The
  `NOT_CHECKED` case (GT snapshot null) does NOT short-circuit — it is
  not a mismatch, same as before. The trailing status logic dropped the
  `(gt.repoSnapshotSha256 !== null && snapshotStatus !== "MATCH")`
  INCOMPLETE arm (unreachable after the early return for stale; NOT_CHECKED
  never took it either, since the old condition required a non-null GT
  snapshot).
- This CLOSES the R3 extension of carried R2-P2-03 (the mirror's stale
  ordering bug). The underlying residual (a) of R2-P2-03 — the mirror's
  pre-FIX entrypoint/snapshot rules (`:385`, `:448-450` in the R3 report's
  numbering) — is untouched and stays carried; see §6.
- Direct verification of the mirror (it exports nothing, so the check
  executes the REAL function source extracted from the file, no copy):
  `03_evidence/FIX_T013_R3/check-gate-mirror.mjs`, log
  `check-gate-mirror.log` — 4/4 PASS: (a) stale+halluc → INCOMPLETE/[],
  (b) stale+dynamic → INCOMPLETE/[], (c) MATCH+halluc → FAIL with both
  blame findings (sanity: blame still works when the snapshot matches),
  (d) MATCH clean → PASS.

## 3. Sibling-ordering check (task item 4) — checked, no other issue found

Read `src/comparator/compare.ts` in full. `compareMapsDetailed` has exactly
TWO `return` points: `:284` (Rule 1 stale short-circuit) and `:535` (final
report). **Rule 1 is the ONLY pre-findings short-circuit in production.**
Post-findings precedence (Rule 9: FAIL if any FAIL-class finding, else
INCOMPLETE if any INCOMPLETE-forcing condition, else PASS) is identical in
all three implementations with the same FAIL set (`src/findings/findings.ts`,
`oracle.py:1479`, `s0-gate.mjs:54`). Two adjacent non-ordering differences
were examined and deliberately NOT fixed:

- **Rule 8 passthroughs** (conflicts → NAME_COLLISION_CONFUSION finding;
  dropped UNKNOWN_ENDPOINT/CONFLICT_DROPPED edges and unresolved
  entrypoints → INCOMPLETE status-only): these are not ordering issues —
  the Oracle GT and the gate GT carry no conflicts/droppedEdges/
  unresolvedEntrypoints fields, so there is nothing to reorder; a
  conflict finding, if present, is FAIL-class and ranks the same way
  everywhere. Out of scope for this fix.
- **`gitCommit` branch of `checkSnapshot`** (`snapshot.ts:35-41`: a
  disagreeing declared git commit is also STALE): the Oracle and the gate
  do not consider gitCommit at all. Unreachable from any map in the suite
  — no claimed-map in `tests/fixtures/` carries `gitCommit`, Oracle/gate
  GT carry no gitCommit field, and fixture repos are non-git checkouts
  (actual gitCommit undefined, so the branch cannot fire). Latent,
  not an ordering issue, not fixed; would need gitCommit plumbed through
  Oracle GT + gate GT plus a git-repo fixture to exercise. Recorded here
  for the next review, not silently dropped.

## 4. Regression fixtures + goldens (4 new)

All under `02_source/tests/fixtures/regression/`, each with `repo/`,
`claimed-map.json`, `expected.json` = INCOMPLETE / STALE_SNAPSHOT /
0 findings. Covered by `tests/golden/regression-t013.test.ts`, which now
also asserts `snapshotStatus` on both sides whenever `expected.json`
carries `expectedSnapshotStatus` (new optional field; only the 4 new
fixtures set it).

| Fixture | Repo | Map |
|---|---|---|
| `py-stale-missing` | py-c01 repo + `extra.py` (`import billing.api`) at root | S0 py-c01 control map verbatim (clean snapshot `a80ab95d…`) — the coordinator's probe |
| `py-stale-halluc` | py-c01 clean repo | S0 py-c01 control map + snapshot all-zeros + claimed hallucinated module `billing/nonexistent.py` + edge `billing/api.py -> billing/nonexistent.py` — the reviewer's probe, reconstructed |
| `ts-stale-missing` | ts-ctrl-01 repo + `extra.ts` at root (`import { util } from './src/util'; export const x = util;`) | S0 ts-ctrl-01 control map verbatim (clean snapshot `388a48e0…`) — the reviewer's probe |
| `py-stale-dynamic` | py-p06 repo (dynamic `importlib.import_module(name)` in `loader.py` + claimed hallucinated edge `loader.py -> plugins/alpha.py`) | py-p06 control map with snapshot all-zeros (was `981acf82…`) — pins that the DYNAMIC_IMPORT_UNKNOWN finding is suppressed too, not just FAIL-class findings. Pre-fix this case already agreed on status (INCOMPLETE) but DIVERGED on findings (Oracle listed 1 × DYNAMIC_IMPORT_UNKNOWN, production 0); the fixture asserts findings equality, so it fails pre-fix. |

The stale + DYNAMIC_IMPORT_UNKNOWN case was ADDED (not skipped): although
production short-circuits regardless, the Oracle's pre-fix path for it was
distinct (dynamic findings were computed and listed while the status
happened to agree), so the fixture pins a real behavioural difference.

## 5. No literal URL scheme added

`grep -rn "http://\|https://" 02_source/src 02_source/scripts
02_source/oracle` returns nothing (same check as prior rounds — the S0
gate's external-request check false-positives on it).

## 6. Carried, NOT fixed

- **R2-P2-02** (conflicting both-spellings snapshot: production exit 3 vs
  Oracle INCOMPLETE/STALE_SNAPSHOT) — invalid input, neither side passes
  it. Carried. (Note: the Oracle side of this case now goes through the
  new early return — conflict → STALE_SNAPSHOT → INCOMPLETE, 0 findings —
  same outcome as before, reached earlier. The divergence itself, a
  validation-level mismatch, is unchanged.)
- **R2-P2-03** — the R3 extension (gate mirror stale-ordering bug) is
  CLOSED by §2 above. The underlying residual (a) (mirror's pre-FIX
  entrypoint/snapshot rules) stays carried, inert for the 48 MATCH
  fixtures.
- **Round-1 carried P2s P2-02–P2-10, P2-13–P2-20** — all stay carried.
  P2-13 re-observed this round (test/gate runs dirtied
  `03_evidence/S0/S0_GATE.json`, `S0_GATE.log`,
  `T011/MUTATION_RESULTS.json`, `T012/PERF_RESULTS.json` with
  timestamp-only diffs; all restored with `git checkout -- <path>`,
  tree verified clean afterwards except intended changes).
- **Sibling-check notes (§3):** Rule 8 passthroughs and the `gitCommit`
  branch of `checkSnapshot` — examined, not ordering issues, not fixed,
  recorded for the next review.

## 7. Verification (exact commands + outputs)

All run from `02_source/` with `TMPDIR=~/workspace/p024-repomapverify/.tmp`
unless noted. Evidence in `03_evidence/FIX_T013_R3/`.

1. `npm run build` → **exit 0** (`build.log`; `build-pre.log` is the
   pre-fix baseline build, also exit 0).
2. `npx vitest run` → **274/274 passed, 21 files** (was 270/270; +4 = the
   4 new regression fixture tests). Log: `vitest.log`.
3. `npm run s0:gate -- --replays 100` → **PASS, exit 0**, gate hash
   `7d4efa1d97798819c2eee29950d57f0d24ffe5961c273f3c9cd37284e7c437cd`
   (**UNCHANGED**), parity 48/48, planted 24/24, control false alarms
   0/24, replay distinct 1, external 0, source writes 0, goldens
   changed 0. Log: `s0-gate.log`.
4. Agreement re-runs with TRUE exit codes, no pipes
   (`repro-post.log`, runner `repro-stale.py`, per-case artifacts in
   `agreement-post/`; pre-fix `repro-pre.log` + `agreement-pre/` show
   0/3 AGREE):
   - py-stale-missing: **prod exit 2 INCOMPLETE / STALE_SNAPSHOT /
     0 findings AND Oracle INCOMPLETE / STALE_SNAPSHOT / 0 findings —
     AGREE**.
   - py-stale-halluc: **prod exit 2 INCOMPLETE / STALE_SNAPSHOT /
     0 findings AND Oracle INCOMPLETE / STALE_SNAPSHOT / 0 findings —
     AGREE**.
   - ts-stale-missing: **prod exit 2 INCOMPLETE / STALE_SNAPSHOT /
     0 findings AND Oracle INCOMPLETE / STALE_SNAPSHOT / 0 findings —
     AGREE**.
   - py-stale-dynamic: covered by the regression suite (both sides
     INCOMPLETE / STALE_SNAPSHOT / 0 findings in `vitest.log`).
5. Gate-mirror direct check (`check-gate-mirror.mjs`, log
   `check-gate-mirror.log`): **4/4 PASS** (stale+halluc → INCOMPLETE/[];
   stale+dynamic → INCOMPLETE/[]; MATCH+halluc → FAIL with both blame
   findings; MATCH clean → PASS).
6. Oracle stale-branch `unknownImportsPresent` direct check
   (`oracle-stale-unknown.log`): synthetic GT with a non-dynamic unknown
   import + stale snapshot → `unknownImportsPresent: true`,
   `findings: []` — computed from GT, not hardcoded.
7. `npm run release:build` (twice, 3 s apart) → **exit 0 both**;
   **identical SHAs both runs**: source
   `18b694343f533102fdbb4d5612b344c83d2210e875d7e62d161e770cc92254e7`,
   dist
   `707f3b7eecd74ec6ba92b7d474878e151541272edaa11b88bef22ebd85bb84d1`
   (real `sha256sum` on the absolute zip paths;
   `release-shas-final.txt`). Logs: `release-build-run1.log`,
   `release-build-run2.log`. These SHAs were produced with the fix in
   the working tree at HEAD `058fdbc` (epoch 1794676191 =
   2026-11-14T17:09:51Z, per the run log — the control commit `058fdbc`
   landed while this fix was in progress; the task brief's base
   `54ea5ec` was HEAD only at the start). Reproducibility is per-commit
   by design (epoch = HEAD commit time), so the SHAs change after this
   fix is committed — the reviewer should re-run at the new HEAD and
   confirm two runs agree, as in round 3. **Addendum (post-commit
   re-run at HEAD `622bdf9`, epoch 1794676524):** two runs identical —
   source
   `98e85144c30df27dc957be9c7fdfb73aa6ff865abfe86786d1628f236c7540d6`,
   dist
   `3b87fd89a1b608c44ffad843bdc99d718e76242b0778e71c5b13d7d7d118128d`
   (real `sha256sum`; logs `release-build-postcommit-run1.log` /
   `release-build-postcommit-run2.log`, SHAs
   `release-shas-postcommit.txt`); `release:verify` exit 0 afterwards
   and SHAs unchanged (`release-verify-postcommit.log`).
8. `npm run release:verify` → **exit 0** (`RELEASE:VERIFY PASS: exit
   codes and canonicalSemanticHash values identical in all
   verifications.`); SHAs unchanged afterwards
   (`18b69434…` / `707f3b7e…`). Log: `release-verify.log`.

## 8. Files changed

- Modified: `02_source/oracle/python/oracle.py`,
  `02_source/scripts/s0-gate.mjs`,
  `02_source/tests/golden/regression-t013.test.ts`.
- Added: `02_source/tests/fixtures/regression/{py-stale-missing,py-stale-halluc,ts-stale-missing,py-stale-dynamic}/{repo,claimed-map.json,expected.json}`,
  `00_control/HANDOFF_FIX_T013_R3.md` (this file),
  `03_evidence/FIX_T013_R3/` (build-pre.log, build.log, vitest.log,
  s0-gate.log, repro-stale.py, repro-pre.log, repro-post.log,
  agreement-pre/, agreement-post/, check-gate-mirror.mjs,
  check-gate-mirror.log, oracle-stale-unknown.log,
  release-build-run1.log, release-build-run2.log, release-verify.log,
  release-shas-final.txt, release-build-postcommit-run1.log,
  release-build-postcommit-run2.log, release-verify-postcommit.log,
  release-shas-postcommit.txt).
