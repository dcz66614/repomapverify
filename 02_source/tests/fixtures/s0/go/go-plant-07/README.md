# go-plant-07

Planted RE-EXPORT_MISREAD (transitive-closure analogue; Go has no re-export): claimed map treats the transitive dependency cmd -> a -> b as a direct edge cmd -> b and omits cmd -> a.

- Language: go
- Kind: planted
- Planted class: re-export-misread
- Expected audit status: FAIL
- Expected findings: HALLUCINATED_EDGE, MISSING_EDGE
