# T002 — Python fixture list + PoC run results

Seed: `P024-REPOMAPVERIFY-S0-2026-11-14`.
Extractor: `src/extractors/python/` (tree-sitter-python via web-tree-sitter 0.27.2).
Adapters: `src/adapters/` (Graphify / Understand-Anything / Aider PoC mappings).
Totals: 16 fixtures — control PASS 8/8, planted detected 8/8.

| Fixture | Kind | Planted class | Modules | Edges | External | Status | Findings |
|---|---|---|---|---|---|---|---|
| py-c01-basic-imports | control | - | 4 | 3 | 0 | PASS | - |
| py-c02-relative-imports | control | - | 6 | 9 | 0 | PASS | - |
| py-c03-init-reexport | control | - | 3 | 2 | 0 | PASS | - |
| py-c04-src-layout | control | - | 4 | 3 | 0 | PASS | - |
| py-c05-from-submodule-vs-attr | control | - | 5 | 4 | 0 | PASS | - |
| py-c06-conditional-imports | control | - | 4 | 2 | 2 | PASS | - |
| py-c07-external-and-stdlib | control | - | 3 | 1 | 4 | PASS | - |
| py-c08-multi-entrypoint | control | - | 6 | 4 | 0 | PASS | - |
| py-p01-hallucinated-edge | planted | HALLUCINATED_EDGE | 4 | 3 | 0 | FAIL | HALLUCINATED_EDGE|billing/api.py|billing/refunds.py; HALLUCINATED_MODULE|billing/refunds.py| |
| py-p02-wrong-entrypoint | planted | WRONG_ENTRYPOINT | 3 | 1 | 0 | FAIL | WRONG_ENTRYPOINT|billing/api.py| |
| py-p03-missing-edge | planted | MISSING_EDGE | 4 | 3 | 0 | FAIL | MISSING_EDGE|billing/api.py|billing/auth.py |
| py-p04-unclaimed-reachable | planted | UNCLAIMED_REACHABLE_MODULE | 4 | 2 | 0 | FAIL | MISSING_EDGE|billing/api.py|billing/migrations.py; UNCLAIMED_REACHABLE_MODULE|billing/migrations.py| |
| py-p05-name-collision | planted | NAME_COLLISION_CONFUSION | 6 | 3 | 0 | FAIL | HALLUCINATED_EDGE|shop/cart.py|lib/utils.py; MISSING_EDGE|shop/cart.py|shop/utils.py; NAME_COLLISION_CONFUSION|shop/cart.py|lib/utils.py |
| py-p06-dynamic-import-misread | planted | DYNAMIC_IMPORT_UNKNOWN | 3 | 0 | 1 | FAIL | DYNAMIC_IMPORT_UNKNOWN|loader.py|; HALLUCINATED_EDGE|loader.py|plugins/alpha.py |
| py-p07-reexport-misread | planted | REEXPORT_MISREAD | 3 | 2 | 0 | FAIL | HALLUCINATED_EDGE|main.py|pkg/core.py; MISSING_EDGE|main.py|pkg/__init__.py |
| py-p08-alias-misparse | planted | ALIAS_MISPARSE | 4 | 3 | 0 | FAIL | HALLUCINATED_EDGE|main.py|utils.py; HALLUCINATED_MODULE|utils.py|; MISSING_EDGE|main.py|pkg/utils.py |

Per-fixture detail: `POC_RUN.json` (machine-readable) and `POC_RUN.log` (this table in text form).
Fixture sources: `02_source/tests/fixtures/s0/python/<fixture>/` (repo/ + claimed-map.json + golden.json); design notes: `02_source/tests/fixtures/s0/python/README.md`.
Adapter samples: `02_source/tests/fixtures/s0/python/adapters/` (graphify-sample.json, understand-anything-sample.ua.json, aider-sample.txt).
