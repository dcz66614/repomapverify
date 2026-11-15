# T008 — Adapter upstream-shape documentation

**Date:** 2026-11-14 ~15:30 UTC
**Task:** T008 (S2), acceptance item 2
**Status:** COMPLETE — adapters strict-validated and documented; upstream shapes remain
**UNCONFIRMED ASSUMPTIONS** (no verified real sample was available to T002 or T008)

## Honest status

No verified real Graphify `graph.json`, no real Understand-Anything `.ua` file,
and no verified current Aider Repo Map output was available to T002 or to T008.
The shapes below are therefore **documented assumptions frozen in code**
(headers of `src/adapters/graphify.ts`, `understand-anything.ts`, `aider.ts`),
not facts established against real upstream output. T008 did **not** invent
real samples and did **not** claim verification it does not have. What T008
did do, for each adapter:

1. Wrote the assumed shape down precisely (field names, types, required vs
   optional, both accepted spellings where they differ).
2. Validated every consumed field strictly — a malformed or ambiguous field
   is now a **rejection naming the field**, never a silent drop or guess.
3. Ran the mapped map through the **same** strict claimed-map/v1 validator
   as native input (`finishMapping` in `src/adapters/shared.ts`) before
   returning it.
4. Redacted every adapter note / error message through the privacy layer, so
   an absolute path or username in upstream input cannot leak into a note.

## What would falsify each shape

- **Graphify:** a real `graph.json` whose nodes carry paths under a different
  key than `path` (e.g. `file`, `name`, `label`), whose edges use `source`/
  `target` with *different* semantics than `from`/`to`, whose edge type
  marker is not `EXTRACTED`/`INFERRED` (e.g. `kind`, `confidence`, or no
  marker at all), or whose nodes/edges live under different top-level keys
  (e.g. `graph.nodes`, `vertices`). Any of these makes the adapter reject
  real input with a clear field-named error instead of misreading it — that
  loud failure is the intended behavior until the shape is confirmed.
- **Understand-Anything:** a real `.ua` file whose edge provenance marker is
  not `origin` (e.g. `source`, `type`, `derivedFrom`), whose static marker
  is not the string `"static"`, or whose nodes/edges use different keys.
  Same consequence: loud rejection, no silent misread.
- **Aider:** a current Aider repo-map text whose file headers are not
  `path/to/file.py:` (e.g. a different header format, non-`.py` files
  listed, or symbols inline on the header line). The text grammar is the
  least certain of the three; the adapter treats unrecognized lines as
  symbol lines by design, so a format change degrades to "fewer modules
  listed" rather than a crash — and the JSON interchange shape
  (`{ files: [...] }`) is ours, not Aider's, so it is exact by definition.

## Frozen assumed shapes

### Graphify `graph.json`

```json
{
  "map_id": "graphify-run-1",            // optional; mapId also accepted
  "repo": "billing-service",             // optional
  "agent": "graphify-1.2.3",            // optional
  "completeness": "FULL_GRAPH",          // REQUIRED
  "repo_snapshot_sha256": "<64-hex>",    // REQUIRED, or via AdapterOptions
  "git_commit": "abc...",                // optional; gitCommit also accepted
  "nodes": [{ "id": "n1", "path": "billing/api.py",
              "kind": "module",           // optional; module | package
              "generated": false }],      // optional boolean (T008)
  "edges": [{ "from": "n1", "to": "n2", "type": "EXTRACTED" }],
  "entrypoints": ["billing/main.py"]     // optional
}
```

Rules: only `type: "EXTRACTED"` edges are claims; `INFERRED`, missing, or
unrecognised types are dropped **and counted** in `droppedEdges` (a defined
rule, not ambiguity). `from`/`source` and `to`/`target` are both accepted;
when both are present they must agree or the edge is rejected naming
`edges[i].from` / `.to`. Edge endpoints may be node ids or repo-relative
paths; a path endpoint not listed in `nodes` is auto-added as a claimed
module. Node `id` must be a non-empty string when present; duplicate module
paths and duplicate node ids (mapping to different paths) are rejected.

### Understand-Anything `.ua` graph data

Same envelope as Graphify (`map_id`/`mapId`, `repo`, `agent`,
`completeness` REQUIRED, `repo_snapshot_sha256` REQUIRED or via options,
`git_commit`/`gitCommit`, `nodes[]` with `id`/`path`/`kind`/`generated`,
`entrypoints[]`), except edges carry an `origin` marker instead of `type`:

```json
{ "edges": [{ "from": "n1", "to": "n2", "origin": "static" }] }
```

Rules: only `origin: "static"` (case-insensitive) edges are claims;
`"llm"` / `"inferred"` / missing origins are dropped **and counted**.
All other strictness follows Graphify.

### Aider Repo Map

Two accepted inputs (both forced to `PARTIAL_SUBGRAPH`, whatever the input
claims — Aider selects files/symbols by token budget, so absence of an edge
is never a missing-edge finding):

**Text** (ctags-style listing; assumed grammar):
```
billing/api.py:
  def get_invoice(...)
  class Api
billing/auth.py:
  def login(...)
```
Header form `path/to/file.py:` (trailing colon stripped) or bare
`path/to/file.py` lines; `#` comment lines and blank lines skipped; all
other lines are symbol lines, not errors. Only `.py` files are modules.
The mapped map carries modules and **no edges**; entrypoints are `[]`.

**JSON** (our own interchange shape, not Aider-native):
```json
{ "files": ["billing/api.py", "billing/auth.py"],
  "repo_snapshot_sha256": "<64-hex>",
  "map_id": "aider-run-1", "repo": "x", "agent": "aider" }
```
Allowed top-level keys only: `files`, `map_id`/`mapId`, `repo`, `agent`,
`repo_snapshot_sha256`/`snapshot_sha256`, `git_commit`/`gitCommit`,
`completeness` (ignored with a note — always forced PARTIAL_SUBGRAPH).
A non-string `files[i]`, an unsafe path, or an unknown top-level key is a
rejection naming the field. In text form an unsafe header path is dropped
with a **redacted** note (the text grammar is loose by nature).

## Strictness added by T008 (per adapter, all tested)

| Check | Graphify | Understand-Anything | Aider |
|---|---|---|---|
| Node/file without string `path` | reject `nodes[i].path` | reject `nodes[i].path` | JSON: reject `files[i]`; text: drop + redacted note |
| `kind` outside module\|package | reject `nodes[i].kind` | reject `nodes[i].kind` | n/a (always module) |
| Non-boolean `generated` | reject `nodes[i].generated` | reject `nodes[i].generated` | n/a |
| Duplicate module path / node id | reject `nodes[i].path` / `.id` | reject `nodes[i].path` / `.id` | deduped by parser |
| EXTRACTED/static edge, missing endpoint | reject `edges[i].from` / `.to` | reject `edges[i].from` / `.to` | n/a (no edges) |
| Conflicting `from`/`source` | reject `edges[i].from` | reject `edges[i].from` | n/a |
| Absolute / `..` endpoint or path | reject naming the field | reject naming the field | JSON: reject `files[i]` |
| Non-string entrypoint / repo / agent | reject naming the field | reject naming the field | reject naming the field |
| Malformed snapshot (not 64-hex) | reject `repoSnapshotSha256` via post-mapping validation | same | same |
| Unknown top-level key (JSON) | — (upstream may carry extras; ignored) | — (same) | reject naming the field |
| Post-mapping strict validation | yes (`finishMapping`) | yes | yes |
| `mapInput("claimed-map-v1")` | — | — | — (native format now validates instead of erroring "needs no mapping") |

Note the deliberate asymmetry on unknown top-level keys: Graphify and
Understand-Anything are real upstream formats that may carry extra fields
(version, metadata, statistics) we do not consume, so unknown top-level
keys are ignored there — but every field we *do* consume is validated
strictly. The Aider JSON shape is ours, so unknown keys are rejected.

## Samples used (synthetic, from T002)

- `02_source/tests/fixtures/s0/python/adapters/graphify-sample.json`
- `02_source/tests/fixtures/s0/python/adapters/understand-anything-sample.ua.json`
- `02_source/tests/fixtures/s0/python/adapters/aider-sample.txt`

These are the only samples the adapters have ever been run against; they
are synthetic fixtures, not real upstream output. Regression coverage for
all three lives in `tests/fixtures/s0/python/poc-audit.test.ts`
("T002 adapter PoC mappings") plus the T008 strictness tests in
`tests/adapters/adapters-t008.test.ts`.
