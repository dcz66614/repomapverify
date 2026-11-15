#!/usr/bin/env bash
# T012 offline proof, shell version (PROJECT_BOOK §9; PLAN T012 item 2).
#
# Method used (stated exactly): the audit runs inside a Linux network
# namespace created with `unshare -n`. That namespace contains ONLY
# the loopback interface, in state DOWN — no interface can carry
# traffic, so the audit provably completes with NO network available.
# `unshare -n` was verified permitted on this VM (exit 0).
#
# Proves, in order: (1) the namespace really has no network
# (/proc/net/dev lists only lo; a fetch() attempt rejects);
# (2) the demo audit inside the namespace exits 1 (FAIL, the correct
# code) with a canonicalSemanticHash IDENTICAL to the online run;
# (3) the control fixture audits to PASS (exit 0) inside the namespace;
# (4) the code-level proof: the S0 gate's network grep, re-run here
# over src/ + scripts/, finds no network-call token.
#
# Usage: TMPDIR=... bash tests/offline/run-offline.sh
# Log:   03_evidence/T012/OFFLINE.log
set -u
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_ROOT="$(cd "$SRC_DIR/.." && pwd)"
TMPDIR="${TMPDIR:-$REPO_ROOT/.tmp}"
LOG="$REPO_ROOT/03_evidence/T012/OFFLINE.log"
mkdir -p "$(dirname "$LOG")" "$TMPDIR"
exec > >(tee "$LOG") 2>&1

say() { echo "### $*"; }

say "T012 offline proof — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
say "method: unshare -n (network namespace, loopback only, DOWN)"
say "node: $(node --version)"
unshare -n true; echo "unshare -n probe exit code: $?"

say "== (1) the namespace has no usable network =="
echo "\$ unshare -n cat /proc/net/dev"
unshare -n cat /proc/net/dev
echo "\$ unshare -n node -e fetch('http://example.com/') ..."
unshare -n node -e "fetch('http://example.com/').then(()=>{console.log('REACHABLE');process.exit(1)}).catch(e=>{console.log('UNREACHABLE:'+(e.cause?.code||e.message))})"
echo "fetch probe exit code: $?"

audit_hash() { # audit_hash <netns:online|offline> <repo> <map> <outdir>
  local mode="$1" repo="$2" map="$3" out="$4"
  rm -rf "$out"; mkdir -p "$out"
  if [ "$mode" = offline ]; then
    unshare -n node "$SRC_DIR/dist/cli.js" audit --repo "$repo" --map "$map" --out "$out"
  else
    node "$SRC_DIR/dist/cli.js" audit --repo "$repo" --map "$map" --out "$out"
  fi
  local code=$?
  echo "$mode audit exit code: $code"
  python3 - "$out/repomapverify-report.json" <<'PYEOF'
import json, sys
r = json.load(open(sys.argv[1]))
print(f"status={r['status']} findings={len(r['findings'])} hash={r['canonicalSemanticHash']}")
PYEOF
  return 0
}

say "== (2) demo audit: online vs offline hash comparison =="
audit_hash online "$SRC_DIR/demo/repo" "$SRC_DIR/demo/claimed-map.json" "$TMPDIR/offline-demo-online"
audit_hash offline "$SRC_DIR/demo/repo" "$SRC_DIR/demo/claimed-map.json" "$TMPDIR/offline-demo-offline"
python3 - "$TMPDIR/offline-demo-online/repomapverify-report.json" "$TMPDIR/offline-demo-offline/repomapverify-report.json" <<'PYEOF'
import json, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
print("online hash: ", a["canonicalSemanticHash"])
print("offline hash:", b["canonicalSemanticHash"])
print("hashes identical:", a["canonicalSemanticHash"] == b["canonicalSemanticHash"])
print("findings identical:", a["findings"] == b["findings"])
print("statuses:", a["status"], "vs", b["status"])
PYEOF

say "== (3) control fixture py-c01 inside the namespace =="
audit_hash offline "$SRC_DIR/tests/fixtures/s0/python/py-c01-basic-imports/repo" \
  "$SRC_DIR/tests/fixtures/s0/python/py-c01-basic-imports/claimed-map.json" \
  "$TMPDIR/offline-control"

say "== (4) code-level proof: S0 gate network grep, re-run =="
echo "\$ grep -rn -E <NET_PATTERN> src scripts   (pattern from scripts/s0-gate.mjs)"
grep -rn -E 'https?://|\bfetch\s*\(|WebSocket|node:http|node:https|node:net|node:dns|XMLHttpRequest|axios|node-fetch|undici' "$SRC_DIR/src" "$SRC_DIR/scripts"
echo "grep exit code: $?  (1 = no matches, the required outcome)"
say "T012 offline proof done. Log: $LOG"
