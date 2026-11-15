# P024 T001 — Environment Report

Probe run: **2026-11-14 13:59:40 UTC** (Sat Nov 14 13:59:40 UTC 2026).
Input commit: `9e28c41` (specs v1.1.0 SPEC_FROZEN). Actual environment is the
source of truth; nothing below is assumed.

## §3.1 probe commands — verbatim output

```text
$ uname -a
Linux htch-runtime 7.0.0-44-generic #1 SMP PREEMPT_DYNAMIC Fri Nov  6 01:23:31 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux

$ node --version
v24.22.1

$ npm --version
10.9.4

$ python --version
/bin/bash: line 1: python: command not found

$ python3 --version
Python 3.12.3

$ go version
/bin/bash: line 1: go: command not found
go exit: 127

$ git --version
git version 2.43.0
```

## Interpretation (recorded facts, not assumptions)

| Item | Required | Actual | Verdict |
|---|---|---|---|
| Node | 24 LTS | v24.22.1 | PASS |
| npm | 10 | 10.9.4 | PASS |
| Python | 3.12 (Oracle) | python3 3.12.3; bare `python` NOT on PATH | PASS with note — Oracle scripts must invoke `python3`, not `python` |
| Go | "do NOT assume installed" | **NOT installed** (`go version` exit 127) | RECORDED — T003 must install Go (or use a container) before the Go extractor PoC can run; Go parse-scope decisions are frozen in `src/contracts/frozen-scope.ts` but unverified until then |
| git | — | 2.43.0 | PASS |

## Frozen toolchain (lockfile)

- `package-lock.json` (lockfileVersion 3, sha256 `2e42c63626527c5f27c1ecd810ce315dcc05c99f12858e653ee8fa6ae4c5b3d5`):
  TypeScript **5.9.3**, vitest **4.0.18**, @types/node **26.6.6**,
  web-tree-sitter **0.27.2**, tree-sitter-python **0.25.0**,
  tree-sitter-typescript **0.23.2**, tree-sitter-go **0.25.0** — all MIT.
- npm registry reachable from this VM (`npm ping` PONG, 582 ms).
- TMPDIR for heavy runs: `~/workspace/p024-repomapverify/.tmp` (created,
  in `.gitignore`; `/tmp` is a 512 MB tmpfs cleared on VM restarts).
