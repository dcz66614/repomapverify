# go-cgo — cgo boundary (§4.5)

- A file importing "C" marks its package hasCgo; no edge is expanded
  to the C side, "C" is not counted as an external import, and no
  unknown is recorded — the audit is PASS, not INCOMPLETE, on the
  cgo account alone. The file's ordinary Go import still yields a
  core edge, and the declared entrypoint seeds reachability.
