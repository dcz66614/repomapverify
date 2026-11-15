# P024 T012 — Performance (PROJECT_BOOK §10.3)

Synthetic repo: exactly **1,000 modules / 5,000 edges**, three-language split (Python 400 / TypeScript 300 / Go 300), generated at test time by the deterministic generator `02_source/tests/performance/generate-perf-repo.mjs` (fixed import offsets, no RNG, no clock). The generated repo is NOT committed; it lives under TMPDIR and is regenerated every run. The audit uses a perfect claimed map built from the ground truth itself, so it must PASS with 0 findings — the run measures timing, not detection.

## Machine facts (this VM)

- Node: v24.22.1
- Platform: linux/x64
- CPUs: 4 (AMD EPYC 9D25 126-Core Processor)
- Total memory: 7934 MB
- `Linux htch-runtime 7.0.0-44-generic #1 SMP PREEMPT_DYNAMIC Fri Nov  6 01:23:31 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux`
- `free -m` at run time:
```
total        used        free      shared  buff/cache   available
Mem:            7934        6715         455          92        1114        1219
Swap:           1023          77         946
```

## Results

| Measurement | Result | Target | Verdict |
|---|---:|---:|---|
| Ground-truth extraction (1,000 modules / 5,000 edges) | 0.908 s | ≤ 30 s | WITHIN TARGET |
| Full audit (PASS, 0 findings, coverage 6003/6003) | 2.888 s | ≤ 60 s | WITHIN TARGET |
| Peak RSS, extraction | 141.2 MB | ≤ 512 MB | WITHIN TARGET |
| Peak RSS, audit | 228.5 MB | ≤ 512 MB | WITHIN TARGET |

Peak RSS is the kernel high-water mark (VmHWM) of the single Node CLI process, sampled from /proc while it runs (`tests/performance/measure.mjs`); this VM has no `/usr/bin/time`, so no external time binary was used.

Raw numbers (exact, from the vitest run): `03_evidence/T012/PERF_RESULTS.json`.
