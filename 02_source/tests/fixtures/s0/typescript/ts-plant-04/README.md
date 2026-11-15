# ts-plant-04

Planted UNCLAIMED_REACHABLE_MODULE: claimed map omits the services/api module AND its incoming edge app -> api. api is reachable from the entry, so MISSING_EDGE cascades with it. Repo identical to ts-ctrl-01.

- Language: typescript
- Kind: planted
- Planted class: unclaimed-reachable-module
- Expected audit status: FAIL
- Expected findings: MISSING_EDGE, UNCLAIMED_REACHABLE_MODULE
