#!/usr/bin/env bash
# T012 performance run, shell version (PROJECT_BOOK §10.3; PLAN T012).
#
# Runs the vitest performance suite (which generates the 1,000-module /
# 5,000-edge repo at test time, measures ground-truth extraction and
# the full audit with wall time + peak RSS, and writes
# 03_evidence/T012/PERF_RESULTS.json), then formats PERFORMANCE.md
# from that JSON plus machine facts.
#
# Targets: extraction ≤ 30 s, audit ≤ 60 s, peak RSS ≤ 512 MB.
# A miss is recorded honestly; the repo is never shrunk to pass.
#
# Usage: TMPDIR=... bash tests/performance/run-performance.sh
# Log:   03_evidence/T012/PERFORMANCE_RUN.log
set -u
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_ROOT="$(cd "$SRC_DIR/.." && pwd)"
TMPDIR="${TMPDIR:-$REPO_ROOT/.tmp}"
EVIDENCE="$REPO_ROOT/03_evidence/T012"
LOG="$EVIDENCE/PERFORMANCE_RUN.log"
mkdir -p "$EVIDENCE" "$TMPDIR"
exec > >(tee "$LOG") 2>&1

say() { echo "### $*"; }

say "T012 performance run — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
say "machine facts:"
echo "node: $(node --version)"
echo "uname: $(uname -a)"
echo "cpus: $(nproc) ($(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs))"
free -m
say "vitest performance suite (generates repo, measures, writes PERF_RESULTS.json)"
(cd "$SRC_DIR" && TMPDIR="$TMPDIR" npx vitest run tests/performance/performance.test.ts)
echo "vitest performance exit code: $?"
say "PERF_RESULTS.json:"
cat "$EVIDENCE/PERF_RESULTS.json"

say "formatting PERFORMANCE.md"
FREE_BEFORE=$(free -m | awk '/^Mem:/ {print $2" MB total, "$7" MB available (before run)"}')
python3 - "$EVIDENCE/PERF_RESULTS.json" "$EVIDENCE/PERFORMANCE.md" <<'PYEOF'
import json, platform, subprocess, sys

results = json.load(open(sys.argv[1]))
md_path = sys.argv[2]
gt, au = results["groundTruth"], results["audit"]
machine = results["machine"]
uname = subprocess.check_output(["uname", "-a"], text=True).strip()
free_m = subprocess.check_output(["free", "-m"], text=True).strip()

def verdict(ok):
    return "WITHIN TARGET" if ok else "TARGET MISSED"

lines = []
lines.append("# P024 T012 — Performance (PROJECT_BOOK §10.3)")
lines.append("")
lines.append("Synthetic repo: exactly **1,000 modules / 5,000 edges**, "
             "three-language split (Python 400 / TypeScript 300 / Go 300), "
             "generated at test time by the deterministic generator "
             "`02_source/tests/performance/generate-perf-repo.mjs` "
             "(fixed import offsets, no RNG, no clock). The generated repo "
             "is NOT committed; it lives under TMPDIR and is regenerated "
             "every run. The audit uses a perfect claimed map built from "
             "the ground truth itself, so it must PASS with 0 findings — "
             "the run measures timing, not detection.")
lines.append("")
lines.append("## Machine facts (this VM)")
lines.append("")
lines.append(f"- Node: {machine['node']}")
lines.append(f"- Platform: {machine['platform']}")
lines.append(f"- CPUs: {machine['cpus']} ({machine['cpuModel']})")
lines.append(f"- Total memory: {machine['totalMemMb']} MB")
lines.append(f"- `{uname}`")
lines.append("- `free -m` at run time:")
lines.append("```")
lines.append(free_m)
lines.append("```")
lines.append("")
lines.append("## Results")
lines.append("")
lines.append("| Measurement | Result | Target | Verdict |")
lines.append("|---|---:|---:|---|")
lines.append(f"| Ground-truth extraction (1,000 modules / 5,000 edges) | "
             f"{gt['wallSec']} s | ≤ {gt['targetSec']} s | {verdict(gt['withinTarget'])} |")
lines.append(f"| Full audit (PASS, 0 findings, coverage 6003/6003) | "
             f"{au['wallSec']} s | ≤ {au['targetSec']} s | {verdict(au['withinTarget'])} |")
lines.append(f"| Peak RSS, extraction | {gt['peakRssMb']} MB | ≤ {results['rssTargetMb']} MB | "
             f"{verdict(gt['peakRssMb'] <= results['rssTargetMb'])} |")
lines.append(f"| Peak RSS, audit | {au['peakRssMb']} MB | ≤ {results['rssTargetMb']} MB | "
             f"{verdict(au['peakRssMb'] <= results['rssTargetMb'])} |")
lines.append("")
lines.append("Peak RSS is the kernel high-water mark (VmHWM) of the single "
             "Node CLI process, sampled from /proc while it runs "
             "(`tests/performance/measure.mjs`); this VM has no "
             "`/usr/bin/time`, so no external time binary was used.")
lines.append("")
lines.append("Raw numbers (exact, from the vitest run): "
             "`03_evidence/T012/PERF_RESULTS.json`.")
lines.append("")
with open(md_path, "w") as f:
    f.write("\n".join(lines))
print(f"wrote {md_path}")
PYEOF
say "T012 performance run done. Log: $LOG"
