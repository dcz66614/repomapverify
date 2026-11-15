# ts-dts — declaration-file boundary (§4.4)

- A .d.ts file's own imports are TYPE_ONLY, and a value import whose
  target resolves to a .d.ts file is a TYPE_ONLY edge — a declaration
  file never produces a runtime edge.
- Audit over the exact graph is PASS.
