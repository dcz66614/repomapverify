# T003 — Go installation record

T001 verified `go version` → exit 127 (Go NOT installed on this VM).
T003 installed Go before any Go extractor work (STEP 0 of the task card).

## Install commands (2026-11-14 ~14:04 GMT)

```bash
cd ~/workspace/.local
curl -fsSL -o go.tar.gz https://go.dev/dl/go1.25.5.linux-amd64.tar.gz
tar -C . -xzf go.tar.gz        # installs ~/workspace/.local/go
export PATH=$HOME/workspace/.local/go/bin:$PATH
go version
```

## Verification

```text
$ sha256sum go.tar.gz
9e9b755d63b36acf30c12a9a3fc379243714c1c6d3dd72861da637f336ebb35b  go.tar.gz

$ curl -fsSL 'https://go.dev/dl/?mode=json&include=all' | python3 -c \
    "... filter version == go1.25.5, filename == go1.25.5.linux-amd64.tar.gz ..."
[('go1.25.5.linux-amd64.tar.gz', '9e9b755d63b36acf30c12a9a3fc379243714c1c6d3dd72861da637f336ebb35b')]
  -> checksum MATCHES the official go.dev download index.

$ go version
go version go1.25.5 linux/amd64

$ cat ~/workspace/.local/go/VERSION
go1.25.5

$ go env GOVERSION GOOS GOARCH
go1.25.5 / linux / amd64
```

## Notes

- Installed into `~/workspace/.local/go` (per task card; `/usr/local/go`
  not used). Tarball kept at `~/workspace/.local/go.tar.gz`.
- Go is used ONLY for version reference (`go1.N` build-tag evaluation
  caps at 1.25) and for the independent `go list` cross-check of the
  smoke repo. The extractor itself never runs `go list` / `go build` —
  it is pure static parsing (tree-sitter-go + a hand-written go.mod
  parser), so fixture repos never need to compile.
- No network access is needed by the extractor at runtime.
