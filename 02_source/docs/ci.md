# CI

## Example workflow

Copy `02_source/.github/workflows/repomapverify.yml` into your repo as
`.github/workflows/repomapverify.yml`. It:

1. Checks out the repo.
2. Sets up **Node 24** (pinned: `node-version: '24'`).
3. Runs `npm ci` (dependencies from the lockfile) and `npm run build`
   — the tool is installed **from the local checkout**, not downloaded
   from a registry.
4. Runs `npx repomapverify audit --repo <repo> --map <map>` (the local
   binary resolves through `node_modules/.bin` after `npm ci`).
5. Uploads the JSON + HTML report as a workflow artifact.

Set `REPO_PATH` and `MAP_PATH` (environment variables at the top of
the workflow) to your repo and your agent's claimed map.

## Exit-code handling

GitHub Actions fails a step on any non-zero exit code, so the audit
step fails the build on every non-PASS result by default:

| Audit exit | Result | Build |
|---:|---|---|
| 0 | PASS | green |
| 1 | FAIL | **red** |
| 2 | INCOMPLETE | **red** |
| 3 | usage / input error | **red** |

### Allow-incomplete option

If a repo still has dynamic imports the static checker cannot resolve,
every audit returns INCOMPLETE and the gate can never go green. For
that case — and only that case — set:

```yaml
env:
  ALLOW_INCOMPLETE: 'true'
```

Then exit 2 is accepted and the step passes; exit 1 (FAIL) still fails
the build. There is no option to allow a FAIL through: a map with a
confirmed hallucinated edge must stay red.

## Note on the bundled defaults

The workflow as shipped audits the bundled demo (`demo/repo` against
`demo/claimed-map.json`). That demo map is **intentionally wrong**, so
the workflow fails with exit 1 until you point `MAP_PATH` at your
agent's real map. That is the fail-closed behaviour working as
designed, not a broken workflow.

## Uploading the workflow file itself

The GitHub App used for uploads in this project cannot create
`.github/workflows/*` files via the API (403, proven twice on other
projects in this factory). If you are maintaining this repo, upload
this workflow file via the GitHub web UI, not via the API.
