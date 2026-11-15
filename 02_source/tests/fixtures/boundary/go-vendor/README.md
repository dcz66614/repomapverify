# go-vendor — vendor/ resolution boundary (§4.5)

- An external module import resolves to the vendored package under
  vendor/ when that content exists: the edge targets the vendor
  package node (not an external count, not UNKNOWN).
- Audit over the exact graph is PASS.
