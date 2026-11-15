# T003 — PoC audit run log

Runner: `02_source/scripts/poc-audit-t003.mjs`
- Runs the production TS/Go extractors on all 32 fixtures.
- Compares extractor output to the hand-written `golden.json`
  field-by-field (modules incl. module_id/content_sha256 recomputed
  from repo files via the frozen contracts, edges incl. typeOnly,
  generated edges, external count, unknowns, excluded files).
- Runs a minimal FULL_GRAPH audit of each synthetic claimed map
  (snapshot binding, hallucinated/missing edges, wrong entrypoint,
  unclaimed reachable modules, name-collision confusion, generated
  mismatch, dynamic-import unknown) and compares status + finding set
  with golden.json.

## Final run (2026-11-14 ~14:25 GMT)

```bash
$ cd 02_source && node scripts/poc-audit-t003.mjs --out ../03_evidence/T003/poc-audit-final.json
```

```text
PASS  ts-ctrl-01  parity=PASS audit=PASS status=PASS findings=[]
PASS  ts-ctrl-02  parity=PASS audit=PASS status=PASS findings=[]
PASS  ts-ctrl-03  parity=PASS audit=PASS status=PASS findings=[]
PASS  ts-ctrl-04  parity=PASS audit=PASS status=PASS findings=[]
PASS  ts-ctrl-05  parity=PASS audit=PASS status=PASS findings=[]
PASS  ts-ctrl-06  parity=PASS audit=PASS status=PASS findings=[]
PASS  ts-ctrl-07  parity=PASS audit=PASS status=PASS findings=[]
PASS  ts-ctrl-08  parity=PASS audit=PASS status=PASS findings=[]
PASS  ts-plant-01  parity=PASS audit=PASS status=FAIL findings=[HALLUCINATED_EDGE]
PASS  ts-plant-02  parity=PASS audit=PASS status=FAIL findings=[WRONG_ENTRYPOINT]
PASS  ts-plant-03  parity=PASS audit=PASS status=FAIL findings=[MISSING_EDGE]
PASS  ts-plant-04  parity=PASS audit=PASS status=FAIL findings=[MISSING_EDGE, UNCLAIMED_REACHABLE_MODULE]
PASS  ts-plant-05  parity=PASS audit=PASS status=FAIL findings=[HALLUCINATED_EDGE, MISSING_EDGE, NAME_COLLISION_CONFUSION, UNCLAIMED_REACHABLE_MODULE]
PASS  ts-plant-06  parity=PASS audit=PASS status=FAIL findings=[DYNAMIC_IMPORT_UNKNOWN, HALLUCINATED_EDGE]
PASS  ts-plant-07  parity=PASS audit=PASS status=FAIL findings=[HALLUCINATED_EDGE, MISSING_EDGE]
PASS  ts-plant-08  parity=PASS audit=PASS status=FAIL findings=[HALLUCINATED_EDGE, MISSING_EDGE]
PASS  go-ctrl-01  parity=PASS audit=PASS status=PASS findings=[]
PASS  go-ctrl-02  parity=PASS audit=PASS status=PASS findings=[]
PASS  go-ctrl-03  parity=PASS audit=PASS status=PASS findings=[]
PASS  go-ctrl-04  parity=PASS audit=PASS status=PASS findings=[]
PASS  go-ctrl-05  parity=PASS audit=PASS status=PASS findings=[]
PASS  go-ctrl-06  parity=PASS audit=PASS status=PASS findings=[]
PASS  go-ctrl-07  parity=PASS audit=PASS status=PASS findings=[]
PASS  go-ctrl-08  parity=PASS audit=PASS status=PASS findings=[]
PASS  go-plant-01  parity=PASS audit=PASS status=FAIL findings=[HALLUCINATED_EDGE]
PASS  go-plant-02  parity=PASS audit=PASS status=FAIL findings=[WRONG_ENTRYPOINT]
PASS  go-plant-03  parity=PASS audit=PASS status=FAIL findings=[MISSING_EDGE]
PASS  go-plant-04  parity=PASS audit=PASS status=FAIL findings=[MISSING_EDGE, UNCLAIMED_REACHABLE_MODULE]
PASS  go-plant-05  parity=PASS audit=PASS status=FAIL findings=[HALLUCINATED_EDGE, MISSING_EDGE, NAME_COLLISION_CONFUSION, UNCLAIMED_REACHABLE_MODULE]
PASS  go-plant-06  parity=PASS audit=PASS status=FAIL findings=[HALLUCINATED_EDGE, MISSING_EDGE]
PASS  go-plant-07  parity=PASS audit=PASS status=FAIL findings=[HALLUCINATED_EDGE, MISSING_EDGE]
PASS  go-plant-08  parity=PASS audit=PASS status=FAIL findings=[HALLUCINATED_EDGE]

SUMMARY: 32 fixtures, parity 32/32, audit 32/32, control PASS 16/16, planted detected 16/16
```

Full JSON report: `03_evidence/T003/poc-audit-final.json`
Full log: `03_evidence/T003/poc-audit-final.log`

## Determinism

The audit was run twice in a row; the two JSON reports are identical
except for the `generatedAt` timestamp (verified by scripted
comparison). The parse-sample runner likewise extracts every sample
twice and asserts byte-identical output (see PARSE_SAMPLES.md).

## History

- Run 1 (`poc-audit-run1.json`): 31/32 parity — go-ctrl-07
  externalImportCount golden error (2 vs correct 3). Golden corrected
  by re-reasoning (see FIXTURES.md); extractor unchanged.
- Run 2 (`poc-audit-run2.json`): 32/32 after the golden correction.
- Final runs (`poc-audit-final.json`, `poc-audit-final-2.json`):
  32/32, identical modulo timestamp, after the two extractor bug fixes
  found by the parse samples (import-equals source field; exports
  `types` condition preference).
