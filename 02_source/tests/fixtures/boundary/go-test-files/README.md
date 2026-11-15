# go-test-files — _test.go exclusion boundary (§4.5)

- `_test.go` files are excluded from package composition (TEST_FILE):
  their imports produce no edges and no external counts. The test
  file here imports a different in-repo package (other) precisely so
  that a wrongly-included test file would show up as a spurious
  pkg -> other edge.
- Audit over the exact graph is PASS.
