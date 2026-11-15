# T008 — Canonical snapshot freeze

**Date:** 2026-11-14 ~15:30 UTC
**Task:** T008 (S2), acceptance item 4
**Status:** FROZEN

## The frozen algorithm

```
CANONICAL_SNAPSHOT_ALGORITHM =
  "sha256 over sorted lines: relativePath + NUL + contentSha256 + '\n'"
```

- One line per file: the NFC-normalized relative path, a NUL byte, the file's
  content SHA-256 (hex), a newline.
- Lines are sorted by NFC-normalized relative path — **NFC first, then sort**.
  The path written in the line is the *normalized* path, never the raw
  spelling: an NFD input hashes exactly like its NFC twin (this was a real
  catch during T008 — the first version of `canonicalSnapshotLines` sorted
  by the normalized path but wrote the raw path, and the NFD test failed;
  the function now normalizes before writing).
- The hash is SHA-256 over the concatenation of those lines, UTF-8.
- Canonical implementation: `computeCanonicalSnapshotSha256` /
  `canonicalSnapshotLines` in `02_source/src/canonical/index.ts`
  (constant `CANONICAL_SNAPSHOT_ALGORITHM` states the formula in words).
  The Python extractor's `computeRepoSnapshotSha256` and the Go package
  combination hash use the same formula.

## What is hashed, and what is never hashed

The canonical **graph** hash (`canonicalGraphHash`) is SHA-256 over the
key-sorted canonical JSON of the built graph: modules (sorted by normalized
path, then module_id), edges (sorted by from/to path), entrypoints,
reachable/isolated sets, duplicate-content groups, external import count,
snapshot hash. The canonical **semantic** hash (`canonicalSemanticHash`,
new in T008) is SHA-256 over the canonical JSON of a normalized semantic
result after volatile fields are stripped.

Never hashed (excluded by construction, and by `stripVolatileFields` for
the semantic hash — exact closed list in `src/canonical/index.ts`,
`VOLATILE_HASH_KEYS`):

- time: `timestamp`, `createdAt`, `updatedAt`, `startedAt`, `finishedAt`
- durations: `duration`, `durationMs`, `elapsed`, `elapsedMs`
- absolute paths / locations: `absolutePath`, any key ending in
  `AbsolutePath`, `repoRoot`, `repoAbsolutePath`, `tempDir`, `tmpDir`,
  `tmpdir`
- random / run identifiers: `runId`, `taskId`, `requestId`, `randomId`,
  `nonce`
- host / process: `hostname`, `pid`

Semantic keys — `moduleId`, `contentSha256`, `repoSnapshotSha256`, `schema`,
findings — are never stripped. Callers with their own volatile keys pass
them via `stripVolatileFields(value, extraKeys)`. When `redactOpts` is
passed to `canonicalSemanticHash`, absolute paths / usernames inside string
values are redacted (repo-root paths become relative, others become the
stated placeholder) *before* hashing, so the same semantic result produced
under a different absolute repo location hashes identically; without
`redactOpts` a raw absolute path in a string value is hashed as-is —
callers must normalize first (documented precondition).

## Symlink behavior (T005 note, frozen by T008)

The **graph snapshot** (`src/graph/fromRepo.ts`, `computeRepoSnapshotSha256`)
is over **physical** files: in-repo symlink spellings of one file collapse
to the canonical (smallest normalized) path, so one physical file
contributes exactly one line. The **Python extractor snapshot** lists every
spelling it walks. Consequences, both deliberate:

- On **symlink-free repos the two hashes are IDENTICAL** — verified on all
  16 Python S0 fixtures (`tests/canonical/canonical-t008.test.ts`: the
  canonical snapshot computed from an independent file walk equals the
  extractor snapshot, the graph snapshot, and the snapshot bound in each
  fixture's claimed map — 16/16, no mismatches).
- On a repo **with** an in-repo symlink the two **differ**: the graph
  snapshot has one line (canonical spelling), the extractor snapshot has
  two (both spellings). Verified by a real temp-repo test with
  `pkg/mod.py` + symlink `aliasmod.py`: graph snapshot equals the
  canonical hash over the collapsed file list; extractor snapshot equals
  the canonical hash over the uncollapsed list; the two hashes differ.
  The shipped snapshot is the graph form (collapsed) — it answers "what
  content is in this tree", not "what spellings were walked".
- Symlinks pointing **outside** the repo are never followed and never
  become modules, aliases, or snapshot lines (T005 rule, unchanged).

## Stability properties (tested)

- Same semantic graph → same hash under shuffled input order (modules /
  edges / entrypoints reversed) and under NFD-vs-NFC spellings.
- Content change moves the hash; no `module_id` ever moves with content
  (only the changed module's `contentSha256` differs).
- Two runs of the same semantic result differing only in volatile fields
  (timestamp, durations, temp dir, run id, absolute repo root) hash
  identically; changing one finding moves the hash.
- The same semantic result produced under `/home/alice/...` vs
  `/home/bob/...` hashes identically once redacted with the respective
  repo roots, and differently without redaction (precondition documented).
