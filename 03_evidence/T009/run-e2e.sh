#!/usr/bin/env bash
# T009 E2E evidence run — regenerates every snapshot under
# 03_evidence/T009/e2e/ from the frozen S0 fixtures plus a synthetic
# dynamic-import (INCOMPLETE) repo, logging each command with its
# exit code. Run from the project root with TMPDIR set to the
# persistent .tmp dir. Read-only w.r.t. the fixtures: all outputs go
# to 03_evidence/T009/e2e/<case>/out (or the case dir itself).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/02_source"
E2E="$ROOT/03_evidence/T009/e2e"
LOG="$ROOT/03_evidence/T009/E2E.log"
FIX="$SRC/tests/fixtures/s0"
: > "$LOG"
run() { echo "\$ $*" >> "$LOG"; "$@" >> "$LOG" 2>&1; echo "exit: $?" >> "$LOG"; echo "" >> "$LOG"; }

run cd "$SRC"
run node dist/cli.js --help
run node dist/cli.js

audit_case() {
  local lang="$1" name="$2"
  local dir="$E2E/$name"
  mkdir -p "$dir/out"
  run node dist/cli.js audit --repo "$FIX/$lang/$name/repo" \
    --map "$FIX/$lang/$name/claimed-map.json" --out "$dir/out"
}

audit_case python py-c01-basic-imports
audit_case python py-p01-hallucinated-edge
audit_case typescript ts-plant-01
audit_case go go-plant-01
audit_case typescript ts-ctrl-08
audit_case python py-p05-name-collision

# INCOMPLETE case: synthetic repo with a variable dynamic import.
INC="$E2E/py-dynamic-incomplete"
mkdir -p "$INC/repo" "$INC/out"
printf 'import loader\nimport util\n\n\ndef run():\n    loader.load("x")\n    util.go()\n' > "$INC/repo/main.py"
printf 'import importlib\n\n\ndef load(name):\n    return importlib.import_module(name)\n' > "$INC/repo/loader.py"
printf 'def go():\n    pass\n' > "$INC/repo/util.py"
printf '[entrypoints]\npaths = ["main.py"]\n' > "$INC/repo/.repomapverify.toml"
SNAP=$(node dist/cli.js ground-truth --repo "$INC/repo" --lang python | python3 -c "import json,sys; print(json.load(sys.stdin)['repoSnapshotSha256'])")
python3 - "$SNAP" "$INC/claimed-map.json" <<'PYEOF'
import json, sys
snap, out = sys.argv[1], sys.argv[2]
m = {
  "schema": "repomapverify.claimed-map/v1",
  "mapId": "synthetic-dynamic-incomplete",
  "repo": "e2e-incomplete",
  "completeness": "FULL_GRAPH",
  "repoSnapshotSha256": snap,
  "modules": [
    {"id": "m1", "path": "main.py", "kind": "module"},
    {"id": "m2", "path": "loader.py", "kind": "module"},
    {"id": "m3", "path": "util.py", "kind": "module"},
  ],
  "entrypoints": ["main.py"],
  "edges": [
    {"from": "main.py", "to": "loader.py"},
    {"from": "main.py", "to": "util.py"},
  ],
}
open(out, "w").write(json.dumps(m, indent=2))
PYEOF
echo "\$ ground-truth snapshot for INCOMPLETE fixture: ${SNAP}" >> "$LOG"
run node dist/cli.js audit --repo "$INC/repo" --map "$INC/claimed-map.json" --out "$INC/out"

# Input-error cases (exit 3).
run node dist/cli.js audit --repo "$E2E/no-such-repo" --map "$FIX/python/py-c01-basic-imports/claimed-map.json" --out "$E2E/out-err"
printf '{"schema": "not-a-claimed-map", "mapId": "x"}' > "$E2E/bad-map.json"
run node dist/cli.js audit --repo "$FIX/python/py-c01-basic-imports/repo" --map "$E2E/bad-map.json" --out "$E2E/out-err"

# ground-truth command.
run node dist/cli.js ground-truth --repo "$FIX/python/py-c01-basic-imports/repo" --lang python

# Offline proof: no external references in any emitted HTML.
{
  echo "== offline proof (emitted HTML) =="
  for f in "$E2E"/*/out/repomapverify-report.html; do
    echo "--- $f"
    echo -n "  external-scheme matches: "; grep -c -E 'https?://' "$f" || true
    echo -n "  script/src=/external-href matches: "; grep -c -E '<script|src=|href="https?:' "$f" || true
  done
  echo ""
  echo "== snapshot hashes =="
  (cd "$E2E" && sha256sum */out/repomapverify-report.json */out/repomapverify-report.html 2>/dev/null)
} >> "$LOG"
(cd "$E2E" && sha256sum */out/repomapverify-report.json */out/repomapverify-report.html 2>/dev/null) > "$ROOT/03_evidence/T009/SHA256SUMS.txt"
echo "E2E evidence written: $LOG"
