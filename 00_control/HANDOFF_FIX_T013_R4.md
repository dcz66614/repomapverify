# Handoff — FIX T013 R4 (R4-P1-01)

- **Task:** FIX round 4 for T013 re-review round 4 (T013 FAIL: 0 P0, 1 new P1, 1 new P2).
- **Date:** 2026-11-14 ~17:36–17:55 GMT
- **Base commit:** `1a7599b` (control on top of `40cd751`; code identical to the reviewed HEAD).
- **Result: R4-P1-01 FIXED.** Oracle + gate mirror now resolve declared entrypoints against their own module set and treat unresolvable declarations as INCOMPLETE status-only, mirroring production Rule 9. 3 new regression fixtures (py ghost, py ghost-ctrl, go ghost). All acceptance criteria met (see §7).
- **T014 NOT started. `04_review/REVIEW_REPORT*.md`, `00_control/HANDOFF_T013*.md` untouched.**

## 0. Baseline: R4-P1-01 reproduced BEFORE fixing (pre-fix: 2/4 DIVERGE)

Verified personally with real commands (always `node dist/cli.js`, never
the `dist/cli/index.js` stub; true exit codes captured WITHOUT a pipe),
from `02_source/` with `TMPDIR=~/workspace/p024-repomapverify/.tmp`.
Probe runner: `03_evidence/FIX_T013_R4/repro-ghost.py` (builds probe dirs
under `$TMPDIR/r4fix-probes/`; py maps are the reviewer's R4 probe maps
verbatim). Pre-fix summary (`repro-pre.log`, per-case artifacts in
`agreement-pre/`):

| Probe | Production (real CLI) | Oracle (pre-fix) | Verdict |
|---|---|---|---|
| py-ghost-entry (py-c01 + toml `["main.py", "ghost.py"]`, map claims both, snapshot `16ea36e2…`) | exit 2, INCOMPLETE / MATCH, 0 findings, GT entrypoints `["main.py"]` | PASS / MATCH, 0 findings, GT entrypoints `["ghost.py", "main.py"]` | **DIVERGE** — matches the reviewer's probe exactly |
| py-ghost-ctrl (toml `["main.py"]`, map claims ghost.py) | exit 1, FAIL, WRONG_ENTRYPOINT `ghost.py` | FAIL, identical finding | AGREE (control) |
| py-ghost-sanity (ghost in neither) | exit 0, PASS | PASS | AGREE (control) |
| go-ghost-entry (go-ctrl-01 + toml `["cmd/server/main.go", "cmd/ghost/main.go"]`, map claims both literal spellings) | exit 2, INCOMPLETE / MATCH, 0 findings, GT entrypoints `["cmd/server"]` | PASS / MATCH, 0 findings, GT entrypoints `["cmd/ghost", "cmd/server"]` | **DIVERGE** — same failure mode in the Go resolution branch (new probe, not in the R4 report) |

Root cause confirmed in code (same as the report): production
`resolveEntrypoint` (`src/graph/build.ts:144-158`) resolves each declared
path against the registry and records the unresolvable ones in
`built.unresolvedEntrypoints`; Rule 9 (`src/comparator/compare.ts:507,
518-521`) forces INCOMPLETE status-only. The Oracle never resolved
declarations at all: the raw toml paths went straight into the GT
(`oracle.py` `:469`/`:934`/`:1406`) and the audit accepted any claimed
entrypoint in that raw list (`:1559`).

## 1. R4-P1-01 (a) — Oracle resolves declared entrypoints (all 3 languages)

**File:** `02_source/oracle/python/oracle.py` (+136/−7).

- New `_resolve_declared_entrypoints(literal_paths, modules)` (`:197-232`):
  mirrors production `resolveEntrypoint` exactly, in order, per literal
  (already normalized) path: (1) exact match against a python/typescript
  module path; (2) otherwise the path's parent directory against a Go
  package module (a Go entrypoint is a file inside its package dir; a
  root file maps to `"."`). Returns `(resolved_module_paths,
  unresolved_literal_paths)`: resolved are the module paths the
  declarations map to (deduped, sorted — the production GT's
  `entrypoints` list); unresolved are the literal toml spellings that
  resolve to no module (sorted with the production
  `compareNormalizedPaths` order via `_snapshot_sort_key`), i.e.
  production's `built.unresolvedEntrypoints`. Consequences, all
  production-faithful: a literal naming a Go package directory
  directly (e.g. `"cmd/server"` with no file) does NOT resolve (step 1
  needs a python/typescript module of that path, step 2 looks up its
  parent `"cmd"`); a Python/TS file path resolves by exact match only
  (a `src/`-layout spelling mismatch stays unresolved, as in
  production's registry lookup); a literal resolving to a module that
  is also reachable as a Go dirname keeps the exact-match target
  (python/typescript tried first, as in production).
- Each `extract()` resolves after modules are built and reassigns
  `self.entrypoints` to the RESOLVED module paths only (Python `:518-526`,
  TypeScript `:997-1005`, Go `:1485-1493`): the GT `entrypoints` list now
  matches production's resolved list, so three-way GT parity holds; the
  literal spellings that did not resolve go to
  `self.unresolved_entrypoints` (initialized `[]` in each `__init__`:
  Python `:451`, TS `:772`, Go `:1318`); `isEntrypoint` flags are
  recomputed from the resolved set; reachability BFSes from the resolved
  entrypoints only (a ghost entrypoint was already a BFS no-op, since
  it is not a module — this just makes it explicit). For all 48 S0
  fixtures every declaration resolves, so the GT is byte-identical
  there (see §7.3: gate hash unchanged).
- `audit_claimed_map` (`:1620-1647` docstring, `:1654-1673`,
  `:1760-1770`): the unresolved list is computed FIRST (from the handed-in
  literal declarations + the GT modules) so it is recorded in every
  return, stale or not. On a non-empty list the audit returns INCOMPLETE
  with status only — no finding is emitted (the claimed ghost spelling
  IS the declaration, so the existing WRONG_ENTRYPOINT check, which
  accepts both the resolved and the literal spellings, still does not
  fire for it, exactly like production Rule 4). FAIL still wins over
  INCOMPLETE (production Rule 9 precedence: the unresolved condition
  joins the INCOMPLETE arm, after the FAIL arm). The literal spelling(s)
  are recorded in the returned audit dict as `unresolvedEntrypoints`
  (mirroring production's `built.unresolvedEntrypoints`).
  **The field is present ONLY when non-empty.** All 48 S0 fixtures
  resolve every declaration, so omitting it there keeps the Oracle
  output — and therefore the S0 gate hash — byte-identical (the gate
  hashes the full Oracle output). When no literal declarations are
  handed in (`declared_literal_entrypoints is None`) the list is
  reported empty: the GT `entrypoints` are already the resolved list,
  so the literals cannot be known from the GT alone.
- `run_fixture` unchanged (it already passes
  `entrypoint_literal_paths` through).

## 2. R4-P1-01 (b) — Gate mirror `auditFromGT` aligned the same way

**File:** `02_source/scripts/s0-gate.mjs` (+109/−6).

- New `resolveDeclaredEntrypoints` (`:394-427`) + `normalizeDeclaredPath`
  (`:390-393`): the same production resolution semantics as §1, in JS
  (exact python/typescript match, else Go parent-dir match; unresolved
  sorted NFC-first like production).
- New `readDeclaredEntrypoints` (`:429-441`): minimal reader for a
  fixture repo's `.repomapverify.toml` (single-line `paths = [...]`
  only — production rejects multi-line arrays, P2-20, and every fixture
  uses one line). Returns the literal spellings, or null when the file
  is absent or the line cannot be parsed (caller then falls back to the
  pre-R4 resolved-only behaviour).
- `auditFromGT(gt, claimed, declaredLiteralEntrypoints = null)` (`:442`):
  resolves the declarations against the GT modules BEFORE the stale
  short-circuit (`:460-463`); a claimed entrypoint is accepted when it
  is a resolved GT entrypoint OR a literal toml spelling — including an
  UNRESOLVED literal (`:507-518`); a declaration exists whenever the
  toml declares anything, even if every declaration is unresolved
  (resolved list empty but literals non-empty). A non-empty unresolved
  list forces INCOMPLETE (after the FAIL arm, mirroring Rule 9) and is
  recorded as `unresolvedEntrypoints` only when non-empty (`:464-465`,
  `:525-530`, stale return `:471-473`).
- Call site (`:734-737`): the gate hands the mirror each fixture repo's
  literal declarations (`readDeclaredEntrypoints(...)`), so it can tell
  an unresolvable declaration (INCOMPLETE, no finding) from an
  undeclared claimed entrypoint (WRONG_ENTRYPOINT).
- **This CLOSES the entrypoint half of carried R2-P2-03 residual (a).**
  The mirror now also accepts the literal toml spelling of a declared
  Go entrypoint (e.g. `"cmd/server/main.go"`), exactly like production
  Rule 4 and the Oracle — verified directly (check (i) in §7.5: PASS).
  The snapshot half of residual (a) (camelCase-only snapshot key) stays
  carried: no fixture uses a snake_case snapshot, and the mirror only
  ever sees the 48 fixtures.
- No literal URL scheme added anywhere (`grep` over `src`, `scripts`,
  `oracle` returns nothing).

## 3. Regression fixtures + goldens (3 new)

All under `02_source/tests/fixtures/regression/`, built by
`03_evidence/FIX_T013_R4/make-fixtures.py`. Covered by
`tests/golden/regression-t013.test.ts`, which now also asserts, when
`expected.json` carries them: both sides' GT `entrypoints` equal
`expectedEntrypoints` (production via `canonicalizeGraph(built)`,
Oracle via `oracle.groundTruth.entrypoints`) and the Oracle audit's
`unresolvedEntrypoints` equals `expectedUnresolvedEntrypoints`
(production records the same list in `built.unresolvedEntrypoints`,
not in its report, so the GT-entrypoints equality is the production
side of that assertion).

| Fixture | Repo | Map | Expected |
|---|---|---|---|
| `py-ghost-entrypoint` | py-c01 repo + toml `["main.py", "ghost.py"]` | Reviewer's R4 probe map verbatim (`03_evidence/T013_R4/probes/py-r4-ghost-entry/claimed-map.json`, snapshot `16ea36e2…`) | INCOMPLETE / MATCH, 0 findings, GT entrypoints `["main.py"]`, unresolved `["ghost.py"]` |
| `py-ghost-ctrl` | py-c01 repo as shipped (toml `["main.py"]`) | Reviewer's R4 ghost-ctrl map verbatim (snapshot `a80ab95d…`) | FAIL / MATCH, 1 × WRONG_ENTRYPOINT `ghost.py` |
| `go-ghost-entrypoint` | go-ctrl-01 repo + toml `["cmd/server/main.go", "cmd/ghost/main.go"]` | Built from the production GT of that repo (modules + edges + snapshot `0b54cbd8…`), entrypoints claimed in their literal toml spellings | INCOMPLETE / MATCH, 0 findings, GT entrypoints `["cmd/server"]`, unresolved `["cmd/ghost/main.go"]` (pins the Go package-dir resolution branch) |

The exact-set test now lists 19 fixtures (was 16).

## 4. Sibling passthroughs — checked, probed, recorded

Full record: `03_evidence/FIX_T013_R4/siblings-probe.log`.

### droppedEdges — PROBED (CLI-level + unit-level); asymmetry confirmed, not fixed
- **Unit-level** (`check-dropped-edges.mjs` / `.py`, logs alongside):
  synthetic BuiltGraph with an edge to an unregistered moduleId →
  `droppedEdges: [UNKNOWN_ENDPOINT]`, production audit INCOMPLETE /
  MATCH, 0 findings. The Oracle on the equivalent GT (no such edge, no
  unknown import, same clean map) returns PASS, 0 findings — the Oracle
  GT schema carries **no droppedEdges counterpart field**, so a
  production dropped edge has no Oracle-side signal.
- **CLI-level, staged as user `nobody`** (staging notes in the log:
  project dirs are 0700/0770 so `nobody` cannot traverse them;
  `unshare -Urn` does NOT block a 000 file for root, so a copied tree
  under `/tmp/r4fix-nobody` + `runuser -u nobody` was used; staging
  removed afterwards). Probe: ts-ctrl-01 + `src/secret.ts` (chmod 000)
  imported by `src/util.ts` (the P2-05 unreadable-file route).
  `cat secret.ts` as nobody → Permission denied (staging works).
  - Map bound to the as-root snapshot: production exit 2 INCOMPLETE /
    STALE_SNAPSHOT, 0 findings (the unreadable file drops out of the
    as-nobody snapshot, so Rule 1 fires before Rule 9).
  - Map rebound to the as-nobody snapshot, still claiming secret.ts:
    production exit 1 FAIL, HALLUCINATED_EDGE + HALLUCINATED_MODULE
    (claimed items for a non-existent module are blamed first; FAIL
    wins over Rule 9 INCOMPLETE).
  - Map = as-nobody GT exactly (secret.ts not claimed): production exit 2
    INCOMPLETE / MATCH, 0 findings, coverage 10/10. The extractor
    still emits `util.ts -> secret.ts` (resolution is by file NAME,
    before the read), buildGraph drops it (UNKNOWN_ENDPOINT — the only
    INCOMPLETE-forcing condition left), so Rule 9 fires status-only.
    This IS the droppedEdges passthrough firing via the CLI.
  - **Oracle as nobody: CRASHES before any audit** — `PermissionError`
    in `TypeScriptOracle.extract` (`oracle.py`, `open(full, "rb").read()`,
    no try/except) while reading `secret.ts` (and `snapshot_sha256`
    would hit the same file). Production degrades to INCOMPLETE/FAIL;
    the Oracle has no unreadable-file handling at all. NOT fixed here
    (P2-05 area, out of this task's scope; recorded for the next review,
    not silently dropped). Consequence: the CLI-level droppedEdges
    agreement cannot be observed end-to-end for an unreadable file —
    the Oracle never reaches its audit.
- **Self-edge** (real repo, both CLIs; `repro-siblings.py`,
  `siblings-self-edge.log`): py-c01 + `import main` in `main.py` → both
  sides exit 0 PASS / MATCH, 0 findings, identical GT edges (no
  self-edge in either GT). Production drops self-edges (SELF_EDGE,
  benign); the Oracle skips them in `add_edge`. No divergence.
- Conclusion: the UNKNOWN_ENDPOINT/CONFLICT_DROPPED dropped-edge
  passthrough remains a known, now-PROBED asymmetry, not a fixed one.
  No new P1 is filed here: the only CLI route found needs an unreadable
  file (P2-05, carried) and the Oracle's failure mode there is a crash,
  not a wrong PASS.

### conflicts — UNREACHABLE via CLI (confirmed from code, not just unprobed)
Production records a conflict only in `IdentityRegistry.register` when
two registrations share one folded identity key AND carry different
realPaths (`src/identity/registry.ts`). That combination cannot be
produced via the CLI:
- Python: `listFilesRecursive` pushes `normalizeRelativePath(...)` (NFC)
  at listing time, so NFC-confusable spellings collapse to ONE listing
  entry; the contents Map dedupes to one module before registration.
- TypeScript: `listTypeScriptFiles` pushes raw names, but `fromRepo`
  computes realPath from the NORMALIZED path
  (`tryRealpath(join(repoRoot, m.relativePath))`), so both spellings
  get the SAME realpath and `register()` merges instead of conflicting.
- Go: packages are keyed by the normalized directory, one package per
  normalized dir.
- The only folding that could disagree with the filesystem is a
  case-insensitive platform adapter (`Foo.py` vs `foo.py`, same folded
  key, different realpaths) — and no adapter is ever passed: the CLI
  calls `buildGroundTruthGraphFromRepo(repoRoot)` with no options
  (`src/cli/audit.ts:91`, `src/cli/ground-truth.ts:68`), `fromRepo`
  only forwards `options.caseAdapter` when given, and
  `detectPlatformAdapter` is defined but never called outside tests
  (P2-07, carried).
Oracle side: the GT schema carries no conflicts field and
`audit_claimed_map` has no conflict handling; the Oracle does NOT dedupe
NFC spellings before registration (both appear as modules — the
reviewer's R4-P2-01 observation), so no conflict is ever recorded there
either. The `conflicts` passthrough cannot fire through the CLI on
either side; it stays carried (P2-19), with this code-level confirmation
recorded. (The reviewer found the same via the NFC probe; this confirms
it from the registration code on all three languages.)

## 5. Carried, NOT fixed

- **R4-P2-01** (NFC/NFD-confusable filenames — needs a spec decision).
- **R2-P2-02** (conflicting both-spellings snapshot: production exit 3
  vs Oracle INCOMPLETE/STALE_SNAPSHOT) — invalid input, neither side
  passes it.
- **R2-P2-03** — entrypoint half CLOSED by §2 above; snapshot half
  (mirror's camelCase-only snapshot key) stays carried, inert for the
  48 MATCH fixtures.
- **Round-1 carried P2s P2-02–P2-10, P2-13–P2-20** — all stay carried.
  P2-09's surfacing gap (INCOMPLETE with no finding naming the cause)
  stays P2; the fix records the cause in `unresolvedEntrypoints`
  instead. P2-13 re-observed this round (test/gate/verify runs dirtied
  `03_evidence/S0/S0_GATE.json`, `S0_GATE.log`,
  `T011/MUTATION_RESULTS.json`, `T012/PERF_RESULTS.json` with
  timestamp-only diffs; all restored with `git checkout -- <path>`,
  tree verified clean afterwards except intended changes).
- **Sibling-check notes (§4):** droppedEdges UNKNOWN_ENDPOINT /
  CONFLICT_DROPPED has no Oracle counterpart (probed, not fixed);
  Oracle crashes on unreadable files as a non-root user (P2-05 area,
  probed, not fixed); `conflicts` unreachable via CLI (confirmed from
  code, carried as P2-19).

## 6. No literal URL scheme added

`grep -rn "http://\|https://" 02_source/src 02_source/scripts
02_source/oracle` returns nothing (same check as prior rounds).

## 7. Verification (exact commands + outputs)

All run from `02_source/` with `TMPDIR=~/workspace/p024-repomapverify/.tmp`
unless noted. Evidence in `03_evidence/FIX_T013_R4/`.

1. `npm run build` → **exit 0** (`build.log`; `build-pre.log` is the
   pre-fix baseline build, also exit 0).
2. `npx vitest run` → **277/277 passed, 21 files** (was 274/274; +3 = the
   3 new regression fixture tests). Log: `vitest.log`.
3. `npm run s0:gate -- --replays 100` → **PASS, exit 0**, gate hash
   `7d4efa1d97798819c2eee29950d57f0d24ffe5961c273f3c9cd37284e7c437cd`
   (**UNCHANGED**), parity 48/48, planted 24/24, control false alarms
   0/24, replay distinct 1, external 0, source writes 0, goldens
   changed 0. Log: `s0-gate.log`.
4. Agreement re-runs with TRUE exit codes, no pipes
   (`repro-post.log`, runner `repro-ghost.py`, per-case artifacts in
   `agreement-post/`; pre-fix `repro-pre.log` + `agreement-pre/` show
   2/4 AGREE):
   - py-ghost-entry: **prod exit 2 INCOMPLETE / MATCH / 0 findings AND
     Oracle INCOMPLETE / MATCH / 0 findings, unresolved `["ghost.py"]`,
     GT entrypoints `["main.py"]` both sides — AGREE**.
   - py-ghost-ctrl: **prod exit 1 FAIL / WRONG_ENTRYPOINT `ghost.py`
     AND Oracle FAIL, identical finding — AGREE**.
   - py-ghost-sanity: **prod exit 0 PASS AND Oracle PASS — AGREE**.
   - go-ghost-entry: **prod exit 2 INCOMPLETE / MATCH / 0 findings AND
     Oracle INCOMPLETE / MATCH / 0 findings, unresolved
     `["cmd/ghost/main.go"]`, GT entrypoints `["cmd/server"]` both
     sides — AGREE**.
5. Gate-mirror direct check (`check-gate-mirror.mjs`, executes the REAL
   `auditFromGT` source extracted from `scripts/s0-gate.mjs`, log
   `check-gate-mirror.log`): **11/11 PASS** — (a) stale+halluc →
   INCOMPLETE/[]; (b) stale+dynamic → INCOMPLETE/[]; (c) MATCH+halluc →
   FAIL with both blame findings; (d) MATCH clean → PASS;
   (e) ghost-declared → INCOMPLETE/[], unresolved `["ghost.py"]`
   (was FAIL/WRONG_ENTRYPOINT pre-fix); (f) ghost-in-map-only → FAIL /
   WRONG_ENTRYPOINT `ghost.py`; (g) ghost-in-neither → PASS;
   (h) Go ghost-declared → INCOMPLETE/[], unresolved
   `["cmd/ghost/main.go"]`; (i) Go literal resolvable → PASS
   (R2-P2-03 entrypoint half); (j) NOT_CHECKED+halluc → FAIL;
   (k) stale+ghost → INCOMPLETE/[], unresolved `["ghost.py"]`.
6. Sibling probes (§4): self-edge both PASS (`siblings-self-edge.log`);
   droppedEdges unit-level production INCOMPLETE vs Oracle PASS
   (`check-dropped-edges.log`, `check-dropped-edges-oracle.log`);
   CLI-level as `nobody`: map = as-nobody GT → production exit 2
   INCOMPLETE / MATCH / 0 findings; Oracle crashes with
   PermissionError (`siblings/prod3.log`, `siblings/oracle.log`,
   `siblings-probe.log`).
7. `npm run verify:all` → **exit 0** (`VERIFY:ALL PASS: build + full
   suite + S0 gate all green.`). Log: `verify-all.log`.
8. `npm run release:build` (twice) → **exit 0 both**; **identical SHAs
   both runs** (real `sha256sum` on the absolute zip paths;
   `release-shas-run2.txt`, `release-shas-final.txt`): source
   `0f4ba0fcb764feb240fdbd6a44cda8c0be9225bb7529ece3307cd46c69bd7d14`,
   dist
   `57a96f491fe62f50f8a629618efcbe1384837501487ecbc9fb54d41244d68b3b`
   (logs `release-build-run1.log` / `release-build-run2.log`; the two
   logged builds plus an explicit rebuild + `sha256sum` all agree).
   `npm run release:verify` → **exit 0** (`RELEASE:VERIFY PASS: exit
   codes and canonicalSemanticHash values identical in all
   verifications.`); SHAs unchanged afterwards. Log:
   `release-verify.log`. These SHAs are pre-commit (epoch = HEAD
   commit time by design); the reviewer should re-run at the new HEAD
   and confirm two runs agree, as in rounds 2–3. **Addendum (post-commit
   re-run at HEAD `0aa320a`, epoch = that commit's time):** two runs
   identical — source
   `fe3e5dd3535a6ad68b4fa953f217622ba36760dffd4136aa5b6f3d7b15103041`,
   dist
   `acd18bb3346fa41c30d5ace647461d5e79cb42d75b70143b8e5e7ec82f40c37a`
   (real `sha256sum`; logs `release-build-postcommit-run1.log` /
   `release-build-postcommit-run2.log`, SHAs
   `release-shas-postcommit.txt`); `release:verify` exit 0 afterwards
   and SHAs unchanged (`release-verify-postcommit.log`).

## 8. Files changed

- Modified: `02_source/oracle/python/oracle.py`,
  `02_source/scripts/s0-gate.mjs`,
  `02_source/tests/golden/regression-t013.test.ts`.
- Added: `02_source/tests/fixtures/regression/{py-ghost-entrypoint,py-ghost-ctrl,go-ghost-entrypoint}/{repo,claimed-map.json,expected.json}`,
  `00_control/HANDOFF_FIX_T013_R4.md` (this file),
  `03_evidence/FIX_T013_R4/` (build-pre.log, build.log, vitest.log,
  s0-gate.log, verify-all.log, repro-ghost.py, repro-pre.log,
  repro-post.log, agreement-pre/, agreement-post/, make-fixtures.py,
  check-gate-mirror.mjs, check-gate-mirror.log, repro-siblings.py,
  siblings-self-edge.log, siblings-probe.log, siblings/,
  check-dropped-edges.mjs, check-dropped-edges.log,
  check-dropped-edges-oracle.py, check-dropped-edges-oracle.log,
  release-build-run1.log, release-build-run2.log, release-verify.log,
  release-shas-run2.txt, release-shas-final.txt,
  release-build-postcommit-run1.log, release-build-postcommit-run2.log,
  release-verify-postcommit.log, release-shas-postcommit.txt).
