# go-replace — replace-directive boundary (§4.5)

- `replace example.com/a => ./local/a` (local, in-repo) resolves to
  the local package.
- `replace example.com/b => example.com/c v2.0.0` (versioned, to
  another module) is external, not expanded.
- `replace example.com/d => ../outside-d` (local path escaping the
  repo) is external too — consistent with the absolute-path case —
  never UNKNOWN (T007 fix).
- Audit over the exact graph is PASS.
