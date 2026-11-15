# P024 T005 HANDOFF — Module identity normalization + ground-truth graph

- Task: T005 (S1, 5h). Status: **COMPLETE — all 4 acceptance items PASS** (verified by real commands below, 2026-11-14 ~14:51 UTC).
- Input commit: `4b97ce3` (S0 PASS, gate hash `7d4efa1d…`; tree clean at start).
- Output: uncommitted changes, left in the working tree per instructions (NO commit made).
- No external model call was needed; all work was done locally (no WorkBuddy/Qoder call made).

## Output files

| Path | What it is |
|---|---|
| `02_source/src/identity/normalize.ts` | NFC-first normalization, sort comparator, platform case adapters (posix/windows/macos/unknown), `probeCaseSensitivity` (live fs probe, never in-repo), `normalizeIdentityPath`, `caseOnlyDiffers` |
| `02_source/src/identity/symlinks.ts` | Symlink classification (`symlink-inside/outside/broken`, dir variants), `resolveRealPathInsideRepo`, read-only `scanRepoFiles` (never descends dir symlinks), `groupByRealPath` |
| `02_source/src/identity/registry.ts` | `IdentityRegistry`: module_id/content_sha256 separation, same-physical-file merge (canonical = smallest path, aliases kept, order-independent), `updateContent`, `findDuplicateContent` (DUPLICATE_CONTENT signal), identity conflicts, Go root-package identity, worst-parse-status merge |
| `02_source/src/identity/index.ts` | Barrel (does NOT re-export contract names — the package barrel keeps one export per contract name) |
| `02_source/src/graph/types.ts` | `BuildGraphInput` / `BuiltGraph` / `GraphModuleInput` / `GraphEdgeInput` / `DroppedEdge` |
| `02_source/src/graph/build.ts` | Pure `buildGraph`: registry normalization, edge remap + dedup + drop-recording, entrypoints ONLY from the declaration, BFS reachability (all core edges + Python `__init__` closure over ALL spellings), `entrypointCandidates` informational only, `isEntrypoint` recomputed |
| `02_source/src/graph/fromRepo.ts` | `buildGroundTruthGraphFromRepo` (runs the 3 frozen extractors, reads toml once, resolves realpaths, feeds symlink aliases the extractors missed) + `computeRepoSnapshotSha256` (canonical snapshot hash) |
| `02_source/src/graph/index.ts` | Barrel |
| `02_source/src/canonical/index.ts` | `canonicalizeGraph`, `canonicalGraphHash` (SHA-256 over key-sorted canonical JSON), `canonicalJson`, `computeCanonicalSnapshotSha256`, schema `repomapverify.ground-truth/v1` |
| `02_source/src/index.ts` (modified) | Barrel now also exports `identity`, `graph`, `canonical` (only change to a non-T005-owned file; no extractor/adapter/contract/oracle/fixture/golden touched) |
| `02_source/tests/identity/identity.test.ts` | 11 tests |
| `02_source/tests/graph/graph.test.ts` | 14 tests (incl. all 48 S0 fixtures vs hand-written goldens) |
| `02_source/tests/canonical/canonical.test.ts` | 5 tests |
| `03_evidence/T005/TEST_RUN.log` | Full-suite verbose log (67/67) |
| `03_evidence/T005/S0_GATE_RERUN.log` | S0 gate re-run log (PASS, same gate hash) |
| `00_control/HANDOFF_T005.md` (this file) | |

Contracts in `02_source/src/contracts/` were NOT modified (no spec conflict found).

## Acceptance commands — exact results

All run with `TMPDIR=~/workspace/p024-repomapverify/.tmp`.

### 0. Clean build — PASS

```text
$ cd 02_source && rm -rf dist && npm run build   -> tsc -p tsconfig.build.json, exit 0
```

### 1. Identity — PASS (11/11 in tests/identity/identity.test.ts)

```text
$ npx vitest run tests/identity/identity.test.ts
  Test Files  1 passed (1); Tests  11 passed (11)
```

- Same-name different-path (`lib/utils.py` vs `shop/utils.py`) → distinct module_ids; same path in another language → distinct.
- Content change → same module_id, only content_sha256 changes (`register` re-registration and `updateContent`).
- Identical content, different paths → two modules + one `findDuplicateContent` group with both module_ids.
- Symlink merge: `pkg/mod.py` + `linkmod.py` → ONE module, canonical `linkmod.py` (smallest path), alias `["pkg/mod.py"]`, same module_id in both registration orders and via `registerAlias`.
- Outside symlink: classified `symlink-outside`, `resolveRealPathInsideRepo` → undefined, never in any `groupByRealPath` group; outside dir symlink classified, never descended. Broken symlink → `symlink-broken`, reported not dropped.
- NFC: NFD `cafe\u0301.py` and NFC `café.py` are one identity; normalization idempotent (property-style sweep over 6 dirs × 6 names).
- Case: windows adapter folds `Foo/Bar.py` + `foo/bar.py` to one module; posix keeps two; unknown adapter never folds (`caseSensitivity: "unknown"`, `caseOnlyDiffers` true); live probe on this VM → `sensitive`, agreeing with `detectPlatformAdapter("linux")`.
- Go root package: relativePath `.` → identity path `""`, module_id = SHA256(`go\0`) = `computeModuleId("go", "")`.

### 2. Ground-truth graph — PASS (14/14 in tests/graph/graph.test.ts)

```text
$ npx vitest run tests/graph/graph.test.ts
  Test Files  1 passed (1); Tests  14 passed (14)
```

- Entrypoints ONLY from the declaration: undeclared graph roots land in `entrypointCandidates` (informational only), never in `declaredEntrypoints`, never seed reachability; no declaration → reachable empty, everything isolated; declared-but-unresolvable path → `unresolvedEntrypoints` (recorded, never guessed); multiple entrypoints all seed the BFS.
- BFS over ALL core edges (conditional + type-only traverse, cycles terminate) — matches the Oracle's `_reachability` / `_reachability_bfs`, which use every core edge. Python `__init__` closure included.
- Go nodes are packages; root file `main.go` maps to the `.` package; nested file maps to its package directory.
- Duplicate edges collapse to one (strongest flags win, AND-merge — the Python extractor's rule); unknown-endpoint and self-edges are dropped AND recorded in `droppedEdges`.
- **S0 fixtures 48/48:** `buildGroundTruthGraphFromRepo` reproduces, per fixture, the golden modules (path/language/nodeKind/isEntrypoint), golden edges, and reachable/isolated sets — Python vs the golden's own reachable/isolated fields, TS/Go vs an independent test-side BFS over the GOLDEN edges from the GOLDEN toml entrypoints. Python snapshot hash equals the Python extractor's own snapshot hash on all 16 Python fixtures; external counts match goldens.
- Symlink end-to-end (real temp Python repo): in-repo symlink merges (one module, alias kept, edge remapped, `__init__` reachable), outside symlink is never a module, snapshot counts the physical file once.

### 3. Tests: unit + property — PASS (30/30 T005 tests; 67/67 full suite)

```text
$ npx vitest run --reporter=verbose   -> Test Files 5 passed (5); Tests 67 passed (67)
  (37 pre-existing T002 tests + 11 identity + 14 graph + 5 canonical)
```

Canonical tests (`tests/canonical/canonical.test.ts`, 5/5): shuffled input order (modules/edges/entrypoints reversed) → identical canonical hash and JSON; NFD vs NFC spellings → identical hash; content change → hash moves but every module_id stays; snapshot hash matches an independent node:crypto computation, order-independent, content- and rename-sensitive; canonical JSON is key-sorted.

### 4. S0 gate still green, same hash — PASS

```text
$ npm --prefix 02_source run s0:gate -- --replays 100   -> exit 0
  THRESHOLDS: parity 48/48; planted 24/24; control false alarms 0/24;
  replay distinct=1; external=0; source writes=0; goldens changed=0
  S0 GATE VERDICT: PASS
  gate hash: 7d4efa1d97798819c2eee29950d57f0d24ffe5961c273f3c9cd37284e7c437cd
  (identical to the T004 gate hash; log: 03_evidence/T005/S0_GATE_RERUN.log)
```

No golden, fixture, extractor, adapter, contract, or oracle file was modified. `git status --short` after the run shows only `M 02_source/src/index.ts` (barrel) plus T005-owned new files. The gate run rewrote `03_evidence/S0/S0_GATE.json` / `.log` with only new timestamps; those two files were restored with `git checkout` (semantic content identical, same gate hash).

## Real bug found and fixed by the tests (not by weakening anything)

The symlink end-to-end test caught a genuine graph bug: the Python `__init__` closure only considered a module's canonical path, so a module reached via a symlinked spelling (`aliasmod.py` → real `pkg/mod.py`) missed its package `__init__.py` and was wrongly isolated. Fixed in `src/graph/build.ts`: the closure now considers every spelling (canonical path AND aliases). The fix is covered by the same test; no golden or gate threshold was touched.

## Frozen decisions / findings for later tasks

1. **Case adapter is part of normalization, not of the contract formula.** `computeModuleId` hashes the already-normalized path; the registry feeds it the adapter-folded identity path. On the posix adapter the fold is the identity, so the result equals the frozen contract function exactly. On an insensitive adapter, `Foo/Bar.py` and `foo/bar.py` are one module_id by construction.
2. **Canonical path = smallest normalized spelling.** Deterministic and registration-order-independent, but it means a symlinked spelling can become the display path (e.g. `aliasmod.py` canonical, `pkg/mod.py` alias). Aliases are always retained, so no information is lost.
3. **Snapshot divergence with symlinks (deliberate).** The graph-level snapshot collapses in-repo symlink spellings to the canonical path (snapshot is over physical content). On symlink-free repos it equals the Python extractor's snapshot hash exactly (verified on all 16 Python fixtures). With symlinks it differs from the extractor's snapshot, which lists both spellings — T008 owns the final snapshot freeze and should confirm which form ships.
4. **Identity conflicts are surfaced, not merged.** Same folded identity key + different physical files (adapter folding disagrees with the filesystem) → the second spelling is not merged and not separately registered; it stays visible only in `BuiltGraph.conflicts` (with the dropped spelling named). T006 should turn conflicts into findings.
5. **Known boundary (extractor-level, not fixed here):** a symlinked `.go` FILE inside a package directory is not a package constituent in the Go extractor's view (it skips symlinks), so it contributes no content to the package hash. Whole-package directory symlinks DO alias correctly. T007 owns Go adapter completion.
6. **Entrypoint resolution order** (deterministic): a declared path is tried as a Python module, then TypeScript, then (via its directory) a Go package. A path cannot be two of these in practice.
7. **Reachability includes type-only edges** (BFS over all core edges), matching the independent Oracle and prod-probe — NOT the T003 PoC mini-audit's runtime-only rule, which was PoC scaffolding.

## Next: T006 — Comparison engine & Finding classification (S1, 4h)

- Owner files: `src/comparator`, `src/findings`.
- Consume: this handoff, `src/graph` (`buildGraph` / `buildGroundTruthGraphFromRepo`, `BuiltGraph` incl. `aliases`, `duplicateContent`, `conflicts`, `droppedEdges`, `unresolvedEntrypoints`, `entrypointCandidates`), `src/canonical` (`canonicalizeGraph` / `canonicalGraphHash`), `src/identity` (`IdentityRegistry`, case adapters).
- T006 acceptance reminder: all 12 finding types; PARTIAL_SUBGRAPH produces no MISSING_EDGE / UNCLAIMED_REACHABLE_MODULE; snapshot mismatch → STALE_SNAPSHOT / INCOMPLETE; UNKNOWN never PASS; skipped items become findings. `duplicateContent` → DUPLICATE_CONTENT (P2); `conflicts` → NAME_COLLISION_CONFUSION or a new finding (decide explicitly, do not silently merge); `entrypointCandidates` are hints only, never WRONG_ENTRYPOINT evidence.
