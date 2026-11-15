# ts-plant-06

Planted DYNAMIC_IMPORT_MISREAD: main uses import(modName) with a VARIABLE argument (statically unresolvable -> DYNAMIC_IMPORT_UNKNOWN, no edge). Claimed map pretends the dynamic import resolved to ./other and claims main -> other.

- Language: typescript
- Kind: planted
- Planted class: dynamic-import-misread
- Expected audit status: FAIL
- Expected findings: DYNAMIC_IMPORT_UNKNOWN, HALLUCINATED_EDGE
