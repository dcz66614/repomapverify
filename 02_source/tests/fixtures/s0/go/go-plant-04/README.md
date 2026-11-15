# go-plant-04

Planted UNCLAIMED_REACHABLE_MODULE: claimed map omits the internal/store package AND its incoming edge app -> store. store is reachable from the entry, so MISSING_EDGE cascades. Repo identical to go-ctrl-01.

- Language: go
- Kind: planted
- Planted class: unclaimed-reachable-module
- Expected audit status: FAIL
- Expected findings: MISSING_EDGE, UNCLAIMED_REACHABLE_MODULE
