# go-vendor-missing — missing vendor/ boundary (§4.5)

- With no vendor/ directory, external module imports are counted
  (EXTERNAL_IMPORTS) and not expanded — never UNKNOWN, never edges.
- Audit over the exact graph is PASS.
