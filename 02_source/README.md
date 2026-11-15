# repomapverify

**One command to verify whether an Agent's claimed repo map is true:
which edges are invented, which entrypoint is wrong, which key module
was left out.**

```sh
npm i -g repomapverify
repomapverify audit --repo ./billing-service --map ./agent-map.json
```

Try it in under a minute, no account, no LLM, no network:

```sh
npm run demo
```

Real output from the bundled demo (a five-module Python shop whose
agent-drawn map invents one edge and omits one real edge):

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
demo: audit finished in 0.3s, exit code 1
```

`Read-only` · `Local-first` · `No LLM` · `No telemetry` · `MIT`

Status: **in development (v0.1.0)** — S0 gate PASS (48/48 Golden Oracle
parity, 24/24 planted defects detected, 0/24 control false alarms,
100 replays, 1 gate hash `7d4efa1d…`). Not yet published to npm: until
then, install from source (`npm ci && npm run build`, Node 24) — the
`npm i -g` line above is the install path once the package is
published, and it was verified end-to-end from a local tarball.

- Full docs: [`docs/usage.md`](docs/usage.md) (CLI, exit codes, formats) · [`docs/ci.md`](docs/ci.md) (CI setup)
- Demo: [`demo/README.md`](demo/README.md)
- Specs (repo root): `../01_spec/PROJECT_BOOK.md`, `../01_spec/IMPLEMENTATION_PLAN.md`

## What it verifies

RepoMapVerify computes the **real import graph** of a repo — statically,
without executing its code — and checks an Agent's claimed map against
it, item by item:

- **Every claimed edge** — does the import `A -> B` really exist?
- **Every claimed module** — does that path exist, and is it the module
  the map means (same path, not just the same file name)? Modules are
  identified by `module_id = SHA256(language + normalized relative
  path)` and versioned by `content_sha256 = SHA256(file content)`, so
  two same-named modules in different directories are never merged.
- **Entrypoints** — do the claimed entrypoints match the ones explicitly
  declared in the repo's `.repomapverify.toml`?
- **Omissions (FULL_GRAPH only)** — real edges and entry-reachable
  modules the map never mentions (`MISSING_EDGE`,
  `UNCLAIMED_REACHABLE_MODULE`).

## What it does NOT do

- **No map generation.** It checks a map an agent supplies; it never
  draws one itself.
- **No LLM, no network, no telemetry.** The audit is a local static
  computation. Reports are local files.
- **No data-flow or call-graph verification.** v1 checks the static
  import graph only — not data flow, function-call paths, or business
  logic.
- **No runtime behaviour.** The repo's code is never executed, and
  nothing in the map is executed either.
- **No judgement of code quality, security, or architecture.** A PASS
  means "the map matches the import graph", nothing more.
- **Dynamic imports are INCOMPLETE, not PASS.** `importlib.import_module`
  with a variable argument, a variable `import()` in TypeScript, and
  similar constructs cannot be resolved statically: the module is
  flagged `DYNAMIC_IMPORT_UNKNOWN` and the audit returns INCOMPLETE
  (exit 2). Unknown is never silently treated as "no edge".

## Languages and frozen parse scope (v1)

| Language | Graph nodes | What is parsed |
|---|---|---|
| Python | one module per `.py` file | `import` / `from`, relative imports, `__init__.py` re-exports |
| TypeScript | one module per `.ts` / `.tsx` file | `import` / `export ... from` / `require()`, `tsconfig` `paths` + `baseUrl`, `moduleResolution`, `package.json` `exports`, relative-path extension completion |
| Go | one node per package (all `.go` files in a directory) | `import` blocks, `go.mod` module path and `replace` directives |

Beyond that frozen scope the answer is UNKNOWN, never a guess.
Third-party imports are counted as external imports, not checked as
repo edges. Generated code is marked `GENERATED` and excluded from
core edges by default. Full per-language rules:
`../01_spec/PROJECT_BOOK.md` §4.3–§4.5.

## Completeness modes

The claimed map must declare `completeness`:

- **`FULL_GRAPH`** — the map claims to be the whole graph. The audit
  checks fabricated edges, wrong entrypoints, *and* omissions.
- **`PARTIAL_SUBGRAPH`** — a cropped subgraph (e.g. an Aider Repo Map
  cut to a token budget). Only declared edges and modules are verified;
  a real edge the map omits is *not* an error.

## Snapshot binding and STALE_SNAPSHOT

A map is bound to the repo version it was drawn from:
`repoSnapshotSha256` (SHA-256 over the whole working tree) plus the Git
commit when one exists. If the repo has changed since the map was made,
the audit returns `STALE_SNAPSHOT` / INCOMPLETE (exit 2) and reports
**no blame findings** — an old map's errors must not be blamed on the
agent. Regenerate the map or rebind the snapshot first.

## Exit codes

| Exit | Status | Meaning |
|---:|---|---|
| 0 | PASS | Every claimed item verified; no confirmed fabrication, wrong entrypoint, or omission; no unresolved unknowns. |
| 1 | FAIL | At least one confirmed hallucinated edge/module, wrong entrypoint, missing edge (FULL_GRAPH only), or unclaimed reachable module (FULL_GRAPH only). |
| 2 | INCOMPLETE | Something could not be determined: a dynamic import, an unparsable source, or a snapshot mismatch. Never folded into PASS. |
| 3 | Usage / input error | Bad flags, missing repo path, or an invalid claimed map (schema errors name the offending field). |

## CI

Copy `.github/workflows/repomapverify.yml` into your repo as
`.github/workflows/repomapverify.yml`. It pins Node 24, installs the
tool from the local checkout (`npm ci` + build, no registry download of
the tool itself), and runs `npx repomapverify audit` — the build fails
on any non-PASS map. The only exception is the documented
`ALLOW_INCOMPLETE: 'true'` option, which accepts INCOMPLETE (exit 2);
FAIL (exit 1) can never be allowed through. See
[`docs/ci.md`](docs/ci.md).

## License

MIT — see `../LICENSE`.
