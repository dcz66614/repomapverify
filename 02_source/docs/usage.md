# Usage

## Install

Once published to npm:

```sh
npm i -g repomapverify
```

From source (this repo; Node 24 required, `node --version` should print
v24.x):

```sh
git clone <this-repo>
cd repomapverify/02_source
npm ci
npm run build
```

`npm ci` installs the pinned dependencies from `package-lock.json`;
the audit itself makes no network requests.

## One command

```sh
repomapverify audit --repo ./billing-service --map ./agent-map.json
```

Or, from a source checkout, the same command through npm/npx:

```sh
npx repomapverify audit --repo ./billing-service --map ./agent-map.json
```

Output on the terminal (real run against the bundled demo, see
`demo/README.md`):

```text
RESULT: FAIL
Ground truth: 5 modules, 5 edges
Claimed: 5 modules, 5 edges
Coverage: 10 / 11 (90.9%)
Findings: 2 (P1: 1, P2: 1) + 0 informational
  P1 HALLUCINATED_EDGE: auth.py -> pricing.py
  P2 MISSING_EDGE: cart.py -> pricing.py
Report: ./demo/out/repomapverify-report.json
Report: ./demo/out/repomapverify-report.html
```

## Options

```text
repomapverify audit --repo <path> --map <claimed-map.json> [--out <dir>] [--format json|html]
repomapverify ground-truth --repo <path> [--lang python|typescript|go]
repomapverify --help
```

- `--out <dir>` — report directory. Default: the current directory,
  unless the current directory is inside the audited repo, in which
  case reports go to `<repo-name>-repomapverify-reports/` next to the
  repo, so a default audit never writes into the repo it audits
  (read-only boundary, PROJECT_BOOK §0.3 — written reports would
  change the next snapshot). An explicit `--out` is always honoured
  exactly as given.
  Writes `repomapverify-report.json` and `repomapverify-report.html`
  (with `--format json` or `--format html`, only that file).
- `--format json|html` — default is both files.
- `ground-truth` prints only the real import graph as JSON, for
  debugging and for comparing against the independent Oracle. It does
  not read a claimed map and does not judge anything.

## Exit codes

| Exit | Status | Meaning |
|---:|---|---|
| 0 | PASS | Every claimed item verified; no confirmed fabrication, wrong entrypoint, or omission; no unresolved unknowns. |
| 1 | FAIL | At least one confirmed hallucinated edge/module, wrong entrypoint, missing edge (FULL_GRAPH only), or unclaimed reachable module (FULL_GRAPH only). |
| 2 | INCOMPLETE | Something could not be determined: a dynamic import, an unparsable source, or a snapshot mismatch (see below). INCOMPLETE is never folded into PASS. |
| 3 | Usage / input error | Bad flags, missing repo path, or an invalid claimed map (schema errors name the offending field). |

## What it verifies

- **Every claimed edge** — does the import `A -> B` really exist in the
  statically computed import graph?
- **Every claimed module** — does that path exist in the repo, and is it
  the module the map means (same path, not just the same file name)?
- **Entrypoints** — do the claimed entrypoints match the entrypoints
  explicitly declared in the repo's `.repomapverify.toml`?
- **Omissions (FULL_GRAPH only)** — real edges and entry-reachable
  modules the map never mentions (`MISSING_EDGE`,
  `UNCLAIMED_REACHABLE_MODULE`).
- **Identity** — modules are identified by `module_id =
  SHA256(language + normalized relative path)` and versioned by
  `content_sha256 = SHA256(file content)`, so two same-named modules in
  different directories are never merged, and editing a file changes
  only its content hash.

## What it does NOT do

- **No map generation.** It checks a map an agent (or a person) supplies;
  it never draws one itself.
- **No LLM, no network, no telemetry.** The audit is a local static
  computation. Reports are local files you can read, edit, or delete.
- **No data-flow or call-graph verification.** v1 checks the static
  import graph only — not data flow, not function-call paths, not
  business logic.
- **No runtime behaviour.** The repo's code is never executed, and
  nothing in the map is executed either.
- **No judgement of code quality, security, or architecture.** A PASS
  means "the map matches the import graph", nothing more.
- **Dynamic imports are INCOMPLETE, not PASS.** `importlib.import_module`
  with a variable argument, a variable `import()` in TypeScript, and
  similar constructs cannot be resolved statically: the module is
  flagged `DYNAMIC_IMPORT_UNKNOWN` and the audit returns INCOMPLETE
  (exit 2). A literal string argument can be resolved; a variable
  argument cannot, and is never silently treated as "no edge".

## Languages and frozen parse scope (v1)

| Language | Graph nodes | What is parsed |
|---|---|---|
| Python | one module per `.py` file | `import` / `from` statements, relative imports, `__init__.py` re-exports |
| TypeScript | one module per `.ts` / `.tsx` file | `import` / `export ... from` / `require()`, `tsconfig` `paths` + `baseUrl`, `moduleResolution`, `package.json` `exports`, relative-path extension completion |
| Go | one node per package (all `.go` files in a directory) | `import` blocks, `go.mod` module path and `replace` directives |

Beyond that frozen scope, the answer is UNKNOWN, never a guess:
unsupported module resolution, unresolvable aliases, and out-of-scope
syntax produce INCOMPLETE rather than a fabricated verdict. Third-party
imports (site-packages, `node_modules`, Go stdlib) are counted as
external imports, not checked as repo edges. Generated code
(`*.pb.go`, files with a generated marker, and equivalents) is marked
`GENERATED` and excluded from core edges by default. See
`01_spec/PROJECT_BOOK.md` §4.3–§4.5 for the full per-language rules.

## Completeness modes

The claimed map must declare `completeness`:

- **`FULL_GRAPH`** — the map claims to be the whole graph. The audit
  checks fabricated edges, wrong entrypoints, *and* omissions
  (`MISSING_EDGE`, `UNCLAIMED_REACHABLE_MODULE`).
- **`PARTIAL_SUBGRAPH`** — the map is a cropped subgraph (for example
  an Aider Repo Map cut to a token budget). Only the declared edges and
  modules are verified; a real edge the map omits is *not* an error.

## Snapshot binding and STALE_SNAPSHOT

A claimed map is bound to the repo version it was drawn from:
`repoSnapshotSha256` (SHA-256 over the whole working tree) plus the Git
commit when one exists. If the repo has changed since the map was made,
the audit returns `STALE_SNAPSHOT` / INCOMPLETE (exit 2) and reports
**no blame findings** — an old map's errors must not be blamed on the
agent. Regenerate the map or rebind the snapshot first.

Entrypoints come from `.repomapverify.toml` in the repo root:

```toml
[entrypoints]
paths = ["src/main.ts", "src/cli.ts"]
```

Without that file (or with empty `paths`), no `WRONG_ENTRYPOINT` is
ever raised; the audit only reports `ENTRYPOINT_CANDIDATE` hints.

## Claimed-map format

The CLI reads `repomapverify.claimed-map/v1` JSON:

```json
{
  "schema": "repomapverify.claimed-map/v1",
  "mapId": "agent-run-2026-11-14-billing",
  "repo": "billing-service",
  "agent": "rea-0.9.1",
  "completeness": "FULL_GRAPH",
  "repoSnapshotSha256": "<working-tree snapshot SHA-256>",
  "modules": [
    {"id": "m1", "path": "billing/api.py", "kind": "module"}
  ],
  "entrypoints": ["billing/main.py"],
  "edges": [
    {"from": "billing/api.py", "to": "billing/auth.py"}
  ]
}
```

The validator is strict: unknown or mistyped fields are rejected and
the error names the field. `repoSnapshotSha256` must be 64 lowercase
hex characters. (A `snake_case` spelling such as `map_id` is accepted
only with an explicit warning; a future v2 will freeze one spelling.)

Input adapters for Graphify `graph.json`, Understand-Anything `.ua`
data, and Aider Repo Maps (forced `PARTIAL_SUBGRAPH`) exist as a
library API (`mapInput` in `src/adapters/`); in v1 the CLI itself
accepts claimed-map/v1 JSON only — convert other formats to that JSON
first.

## Reports

- **JSON** (`repomapverify-report.json`, schema
  `repomapverify.report/v1`): status, ground-truth and claimed sizes,
  coverage, findings with severity and evidence, snapshot status, and a
  canonical semantic hash plus per-module content SHA-256 evidence.
  Absolute paths and usernames are redacted; only relative paths are
  reported.
- **HTML** (`repomapverify-report.html`): a single self-contained file,
  inline CSS, no JavaScript, no external requests. Claimed graph on the
  left, ground truth on the right; green = verified, red =
  fabricated/wrong, yellow = undetermined. Click an edge for its source
  file, line number, and import statement; click a module for its path,
  content SHA, language, generated flag, and real-vs-claimed edges.

## Demo

```sh
cd 02_source
npm run demo
```

Audits the bundled five-module Python shop against its intentionally
wrong map: FAIL in under a second (see `demo/README.md` for the exact
expected output and how to turn it into a PASS).
