# go-plant-08

Planted BUILD-TAG_MISREAD (Go analogue of dynamic-import-misread: an edge that exists only in a file excluded from the frozen build): claimed map claims internal/plat -> internal/winonly, which only the windows-only file imports. Repo identical to go-ctrl-04.

- Language: go
- Kind: planted
- Planted class: build-tag-misread
- Expected audit status: FAIL
- Expected findings: HALLUCINATED_EDGE
