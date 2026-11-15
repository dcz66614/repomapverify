# go-plant-05

Planted NAME_COLLISION_CONFUSION: two packages share the package NAME util (internal/a/util vs internal/b/util). Claimed map lists only a/util and claims b/svc -> a/util. b/util is also unclaimed-but-reachable, so UNCLAIMED_REACHABLE_MODULE cascades.

- Language: go
- Kind: planted
- Planted class: name-collision
- Expected audit status: FAIL
- Expected findings: HALLUCINATED_EDGE, MISSING_EDGE, NAME_COLLISION_CONFUSION, UNCLAIMED_REACHABLE_MODULE
