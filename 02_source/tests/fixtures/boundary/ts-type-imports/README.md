# ts-type-imports — type-only import boundary (§4.4)

- `import type`, `import { type ... }`, `export type ... from`,
  `export { type ... } from` all produce TYPE_ONLY edges.
- A mixed clause `import { type Qux, bar }` is a RUNTIME edge (a value
  is imported), so the extractor holds two main.ts -> foo.ts edges
  (typeOnly true + false); the graph AND-merges them to one runtime edge.
- Audit over the exact graph is PASS.
