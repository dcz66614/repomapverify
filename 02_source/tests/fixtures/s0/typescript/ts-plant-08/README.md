# ts-plant-08

Planted ALIAS_MISPARSE: claimed map resolves @lib/util to src/lib/other.ts (a real but unrelated, isolated file) instead of src/lib/util.ts. Repo is ts-ctrl-02 plus an isolated src/lib/other.ts.

- Language: typescript
- Kind: planted
- Planted class: alias-misparse
- Expected audit status: FAIL
- Expected findings: HALLUCINATED_EDGE, MISSING_EDGE
