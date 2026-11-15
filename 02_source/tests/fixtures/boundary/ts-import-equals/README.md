# ts-import-equals — `import = require()` boundary (§4.4)

- `import x = require("./y")` produces an edge (kind import-equals);
  a literal `require("./y")` produces an edge too; the two spellings
  of the same pair dedup to one edge.
- Audit over the exact graph is PASS.
