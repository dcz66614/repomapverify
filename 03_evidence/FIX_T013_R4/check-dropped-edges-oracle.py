#!/usr/bin/env python3
"""FIX T013 R4: Oracle side of the unit-level droppedEdges probe.

The Oracle GT schema carries no droppedEdges field: the equivalent of
the production unit probe (an extractor edge to an unregistered module,
dropped by buildGraph) is a GT with no such edge, no unknown import and
no other INCOMPLETE condition. The Oracle audit on the same clean map
therefore returns PASS -- the dropped-edge INCOMPLETE passthrough has
no Oracle-side counterpart. (The CLI-level route to such a drop is the
P2-05 unreadable-file skip, probed separately as nobody; the Oracle
crashes there before any audit -- see the handoff.)
"""
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location(
    "oracle", "/home/hatch/workspace/p024-repomapverify/02_source/oracle/python/oracle.py")
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)

SNAP = "aa" * 32
gt = {
    "modules": [
        {"relativePath": "src/main.ts", "language": "typescript",
         "isGenerated": False, "isEntrypoint": True, "parseStatus": "OK"},
        {"relativePath": "src/util.ts", "language": "typescript",
         "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK"},
    ],
    "edges": [{"from": "src/main.ts", "to": "src/util.ts"}],
    "entrypoints": ["src/main.ts"],
    "reachableFromEntrypoints": ["src/main.ts", "src/util.ts"],
    "unknownImports": [],
    "dynamicUnknown": [],
    "repoSnapshotSha256": SNAP,
}
claimed = {
    "schema": "repomapverify.claimed-map/v1", "mapId": "unit-dropped",
    "repo": "unit", "agent": "unit", "completeness": "FULL_GRAPH",
    "repoSnapshotSha256": SNAP,
    "modules": [{"id": "m0", "path": "src/main.ts", "kind": "module"},
                {"id": "m1", "path": "src/util.ts", "kind": "module"}],
    "entrypoints": ["src/main.ts"],
    "edges": [{"from": "src/main.ts", "to": "src/util.ts"}],
}
audit = oracle.audit_claimed_map(gt, claimed, ["src/main.ts"])
print("oracle audit:", json.dumps(audit, sort_keys=True))
ok = audit["status"] == "PASS" and audit["findings"] == []
print("PASS oracle: no droppedEdges counterpart -> PASS on the same clean map"
      if ok else "FAIL oracle expectation")
sys.exit(0 if ok else 1)
