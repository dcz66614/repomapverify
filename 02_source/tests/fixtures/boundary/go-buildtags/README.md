# go-buildtags — frozen build-tag boundary (§4.5, GOOS=linux/GOARCH=amd64)

- In the frozen build: go1.21 (<= 1.25) in, go1.26 out; `linux && amd64`
  in, `linux && !amd64` out; legacy `// +build linux` in,
  `// +build windows` out.
- Custom tag `mytag` is undecidable: the file is excluded AND an
  UNDECIDABLE_BUILD_CONSTRAINT unknown is recorded (never guessed in
  or out) — the audit is INCOMPLETE, findings [].
