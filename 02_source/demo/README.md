# Demo: the shop that an agent mis-drew

A five-module Python shop (`demo/repo/`) and the claimed map an agent
drew of it (`demo/claimed-map.json`). The map is **intentionally wrong**,
so the demo ends in FAIL — that is the product working.

## The real repo

| Module | Real imports |
|---|---|
| `main.py` (entrypoint) | `api.py`, `cart.py` |
| `api.py` | `auth.py`, `cart.py` |
| `auth.py` | — |
| `cart.py` | `pricing.py` |
| `pricing.py` | — |

Ground truth: 5 modules, 5 edges. The entrypoint is declared in
`demo/repo/.repomapverify.toml` (`paths = ["main.py"]`).

## The two deliberate mistakes in the claimed map

1. **Hallucinated edge** — the map claims `auth.py -> pricing.py`.
   `auth.py` imports nothing. Finding: `HALLUCINATED_EDGE` (P1).
2. **Missing edge** — the map never claims `cart.py -> pricing.py`,
   although that import is real and the map declares
   `completeness: "FULL_GRAPH"`. Finding: `MISSING_EDGE` (P2).

The map is bound to the repo snapshot (`repoSnapshotSha256` in
`demo/claimed-map.json` matches the repo; run
`npx repomapverify ground-truth --repo demo/repo --lang python` to see
it), so the FAIL is about the map, not a stale snapshot.

## Run it

```sh
cd 02_source
npm run demo
```

Expected output (real run, 2026-11-14):

```text
RESULT: FAIL
Ground truth: 5 modules, 5 edges
Claimed: 5 modules, 5 edges
Coverage: 10 / 11 (90.9%)
Findings: 2 (P1: 1, P2: 1) + 0 informational
  P1 HALLUCINATED_EDGE: auth.py -> pricing.py
  P2 MISSING_EDGE: cart.py -> pricing.py
Report: .../demo/out/repomapverify-report.json
Report: .../demo/out/repomapverify-report.html
demo: audit finished in 0.3s, exit code 1
```

`npm run demo` exits with the audit's exit code (1 here). Reports land
in `demo/out/` (git-ignored; regenerate any time with `npm run demo`).
The audit itself takes ~0.3–0.6 s on this VM; the whole command,
including a clean-checkout rebuild, stays well under 60 s (timed at
1.2 s total with `dist/` already built, ~5 s with a rebuild).

## Turn it into a PASS

Edit `demo/claimed-map.json`: delete the `auth.py -> pricing.py` edge
and add the `cart.py -> pricing.py` edge. Re-run `npm run demo` — the
result becomes `PASS` with exit code 0. (Do not commit the edited map;
the shipped map is meant to stay wrong.)
