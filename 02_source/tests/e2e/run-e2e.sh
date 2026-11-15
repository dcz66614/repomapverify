#!/usr/bin/env bash
# T012 E2E full chain (PROJECT_BOOK §6.4, §10.2; PLAN T012 item 1).
#
# Part A: the vitest E2E suite through the real built CLI (main tree).
# Part B: fresh-checkout state -> npm ci (from the lockfile) -> npm run
#   build -> audit a control fixture (exit 0 PASS) -> audit a planted
#   fixture per language (exit 1 FAIL) -> audit the demo (exit 1 FAIL,
#   same findings as README) -> ground-truth JSON matches the fixture
#   golden counts.
#
# The fresh checkout is a git worktree of HEAD (the product code is
# committed; T012 adds tests only), removed again afterwards.
# Every command and its exit code is recorded in the log.
#
# Usage: TMPDIR=... bash tests/e2e/run-e2e.sh
# Log:   03_evidence/T012/E2E.log
set -u
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_ROOT="$(cd "$SRC_DIR/.." && pwd)"
TMPDIR="${TMPDIR:-$REPO_ROOT/.tmp}"
LOG="$REPO_ROOT/03_evidence/T012/E2E.log"
mkdir -p "$(dirname "$LOG")" "$TMPDIR"
exec > >(tee "$LOG") 2>&1

say() { echo "### $*"; }
run() {
  echo "\$ $*"
  "$@"
  local code=$?
  echo "exit code: $code"
  return 0
}
check() { # check <expected> <actual> <label>
  if [ "$2" = "$1" ]; then echo "CHECK PASS: $3 (expected $1, got $2)";
  else echo "CHECK FAIL: $3 (expected $1, got $2)"; fi
}

say "T012 E2E full chain — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
say "repo root: $REPO_ROOT"
run git -C "$REPO_ROOT" rev-parse HEAD
run git -C "$REPO_ROOT" status --short
say "node: $(node --version)  npm: $(npm --version)"
say "lockfile sha256:"
sha256sum "$SRC_DIR/package-lock.json"

say "== Part A: vitest E2E suite (real built CLI, main tree) =="
run npm --prefix "$SRC_DIR" run build
(cd "$SRC_DIR" && TMPDIR="$TMPDIR" npx vitest run tests/e2e/e2e.test.ts)
echo "vitest e2e exit code: $?"

say "== Part B: fresh checkout -> npm ci -> build -> audits =="
WT="$TMPDIR/fresh-checkout"
git -C "$REPO_ROOT" worktree remove --force "$WT" 2>/dev/null || true
rm -rf "$WT"
run git -C "$REPO_ROOT" worktree add --detach "$WT" HEAD
run git -C "$WT" rev-parse HEAD
say "fresh checkout: npm ci from the packaged lockfile"
(cd "$WT/02_source" && TMPDIR="$TMPDIR" npm ci)
echo "npm ci exit code: $?"
say "fresh checkout: npm run build"
(cd "$WT/02_source" && TMPDIR="$TMPDIR" npm run build)
echo "npm run build exit code: $?"
ls -l "$WT/02_source/dist/cli.js"

CLI="$WT/02_source/dist/cli.js"
FX="$WT/02_source/tests/fixtures/s0"
audit_case() { # audit_case <label> <repo> <map> <expected-exit>
  local label="$1" repo="$2" map="$3" expected="$4"
  local out="$TMPDIR/e2e-$(echo "$label" | tr ' /' '__')"
  rm -rf "$out"; mkdir -p "$out"
  say "audit: $label"
  node "$CLI" audit --repo "$repo" --map "$map" --out "$out"
  local code=$?
  echo "exit code: $code"
  check "$expected" "$code" "$label exit code"
  python3 - "$out/repomapverify-report.json" <<'PYEOF'
import json, sys
r = json.load(open(sys.argv[1]))
print(f"status={r['status']} groundTruth={r['groundTruth']} claimed={r['claimed']} "
      f"coverage={r['coverage']['verifiedClaims']}/{r['coverage']['totalClaims']} "
      f"findings={len(r['findings'])} hash={r['canonicalSemanticHash'][:16]}...")
for f in r["findings"]:
    print(f"  finding: {f.get('id')} {f.get('from','')} -> {f.get('to','')}")
PYEOF
}

audit_case "control py-c01" \
  "$FX/python/py-c01-basic-imports/repo" \
  "$FX/python/py-c01-basic-imports/claimed-map.json" 0
audit_case "planted py-p01" \
  "$FX/python/py-p01-hallucinated-edge/repo" \
  "$FX/python/py-p01-hallucinated-edge/claimed-map.json" 1
audit_case "planted ts-plant-01" \
  "$FX/typescript/ts-plant-01/repo" \
  "$FX/typescript/ts-plant-01/claimed-map.json" 1
audit_case "planted go-plant-01" \
  "$FX/go/go-plant-01/repo" \
  "$FX/go/go-plant-01/claimed-map.json" 1
audit_case "demo" \
  "$WT/02_source/demo/repo" \
  "$WT/02_source/demo/claimed-map.json" 1

say "ground-truth JSON vs fixture golden counts"
gt_count() { # gt_count <repo> <lang> <exp-modules> <exp-edges>
  node "$CLI" ground-truth --repo "$1" --lang "$2" > "$TMPDIR/gt-$2.json"
  echo "ground-truth $2 exit code: $?"
  python3 - "$TMPDIR/gt-$2.json" "$3" "$4" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
ok = len(d["modules"]) == int(sys.argv[2]) and len(d["edges"]) == int(sys.argv[3])
print(f"modules={len(d['modules'])} (expected {sys.argv[2]}) edges={len(d['edges'])} (expected {sys.argv[3]}) -> {'PASS' if ok else 'FAIL'}")
PYEOF
}
gt_count "$FX/python/py-c01-basic-imports/repo" python 4 3
gt_count "$FX/typescript/ts-plant-01/repo" typescript 4 5
gt_count "$FX/go/go-plant-01/repo" go 3 2

say "cleanup: remove fresh worktree"
run git -C "$REPO_ROOT" worktree remove --force "$WT"
run git -C "$REPO_ROOT" worktree list
say "T012 E2E full chain done. Log: $LOG"
