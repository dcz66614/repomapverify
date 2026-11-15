# go-package-nodes — package-level node boundary (§4.5, §4.1)

- Graph nodes are PACKAGES: pkg/a.go + pkg/b.go aggregate to one
  `pkg` node (files are composition evidence, not nodes); the two
  files' imports become two package-level edges pkg -> lib1/lib2,
  with no file-level edges and no intra-package edge.
- The declared entrypoint seeds reachability over all four packages.
- Audit over the exact graph is PASS.
