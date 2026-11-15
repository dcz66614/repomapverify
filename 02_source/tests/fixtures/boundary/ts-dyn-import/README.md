# ts-dyn-import — dynamic import() boundary (§4.4)

- Literal `import("./ondemand")` resolves to a core edge (kind dynamic-import).
- Variable argument `import(name)` and template-with-substitution
  `` import(`./${name}`) `` cannot be resolved statically: each yields a
  DYNAMIC_IMPORT_UNKNOWN unknown, never a guessed edge.
- Audit over the exact core graph is INCOMPLETE (never PASS) with exactly
  one DYNAMIC_IMPORT_UNKNOWN finding for src/main.ts (one per module).
