# ts-plant-05

Planted NAME_COLLISION_CONFUSION: two modules share basename util.ts (src/a/util.ts vs src/b/util.ts). Claimed map lists only a/util and claims b/worker -> a/util instead of b/worker -> b/util. b/util is also unclaimed-but-reachable, so UNCLAIMED_REACHABLE_MODULE cascades.

- Language: typescript
- Kind: planted
- Planted class: name-collision
- Expected audit status: FAIL
- Expected findings: HALLUCINATED_EDGE, MISSING_EDGE, NAME_COLLISION_CONFUSION, UNCLAIMED_REACHABLE_MODULE
