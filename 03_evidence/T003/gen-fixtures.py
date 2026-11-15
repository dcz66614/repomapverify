#!/usr/bin/env python3
"""T003 fixture generator (P024 RepoMapVerify, S0).

Materialises the 32 T003 fixtures (16 TypeScript + 16 Go) under
02_source/tests/fixtures/s0/{typescript,go}/.

Each fixture = synthetic repo (fixed file tree + fixed content) +
synthetic claimed map + HAND-WRITTEN Golden Expected Graph (golden.json).

The golden graphs below are literal data authored by reasoning about the
fixture sources in this same file. They were NEVER produced by running
the production extractors. The claimed maps are likewise literal
(module/edge/entrypoint lists authored here); only the
repoSnapshotSha256 is computed (canonical snapshot hash over the repo
files) because a claimed map must bind a real snapshot hash.

Snapshot definition (shared with the PoC audit runner):
  SHA256 over sorted lines `relpath + "\\0" + sha256(content) + "\\n"`
  for every file under repo/ (UTF-8 bytes, "\\n" line endings).

Usage: python3 gen-fixtures.py   (run from 03_evidence/T003/)
Idempotent: rewrites the fixture trees from scratch.
"""
import hashlib
import json
import os
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FIXDIR = os.path.join(ROOT, "02_source", "tests", "fixtures", "s0")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def snapshot_hash(repo: dict) -> str:
    lines = []
    for path in sorted(repo.keys()):
        content = repo[path].encode("utf-8")
        lines.append(f"{path}\0{sha256_hex(content)}\n")
    return sha256_hex("".join(lines).encode("utf-8"))


# ---------------------------------------------------------------- helpers
def ts_mod(path, entry=False, decl=False, gen=False):
    return {
        "relativePath": path,
        "nodeKind": "module",
        "isGenerated": gen,
        "isEntrypoint": entry,
        "parseStatus": "OK",
        "isDeclarationFile": decl,
        "files": [{"relativePath": path, "isGenerated": gen, "isCgo": False}],
    }


def go_mod(path, files, name, entry=False, gen=False):
    return {
        "relativePath": path,
        "nodeKind": "package",
        "isGenerated": gen,
        "isEntrypoint": entry,
        "parseStatus": "OK",
        "packageName": name,
        "files": files,
    }


def go_file(path, gen=False, cgo=False):
    return {"relativePath": path, "isGenerated": gen, "isCgo": cgo}


def edge(frm, to, type_only=False):
    e = {"from": frm, "to": to}
    if type_only:
        e["typeOnly"] = True
    return e


def unknown(frm, specifier, reason):
    return {"from": frm, "specifier": specifier, "reason": reason}


# ---------------------------------------------------------------- fixtures
FIXTURES = []

# ================================================================ TS ctrl-01
TS_CTRL01_REPO = {
    "package.json": '{"name": "ts-ctrl-01", "version": "0.1.0"}\n',
    "tsconfig.json": '{"compilerOptions": {"baseUrl": ".", "moduleResolution": "bundler"}}\n',
    ".repomapverify.toml": '[entrypoints]\npaths = ["src/main.ts"]\n',
    "src/main.ts": 'import { start } from "./app";\nimport { helper } from "./util";\nstart(helper());\n',
    "src/app.ts": 'import { fetchApi } from "./services/api";\nimport { helper } from "./util";\nexport function start(h: string) { return fetchApi(h) + helper(); }\n',
    "src/util.ts": 'export function helper() { return "u"; }\n',
    "src/services/api.ts": 'import { helper } from "../util";\nexport function fetchApi(h: string) { return helper() + h; }\n',
}
TS_CTRL01_GOLDEN = {
    "modules": [
        ts_mod("src/app.ts"),
        ts_mod("src/main.ts", entry=True),
        ts_mod("src/services/api.ts"),
        ts_mod("src/util.ts"),
    ],
    "edges": [
        edge("src/app.ts", "src/services/api.ts"),
        edge("src/app.ts", "src/util.ts"),
        edge("src/main.ts", "src/app.ts"),
        edge("src/main.ts", "src/util.ts"),
        edge("src/services/api.ts", "src/util.ts"),
    ],
    "generatedEdges": [],
    "externalImportCount": 0,
    "unknowns": [],
    "excludedFiles": [],
}
FIXTURES.append({
    "name": "ts-ctrl-01", "language": "typescript", "kind": "control",
    "plantedClass": None,
    "readme": "Control: basic relative imports + directory descent (main->app, app->api, api->util). Claimed map == ground truth.",
    "repo": TS_CTRL01_REPO,
    "claimed": {
        "modules": ["src/app.ts", "src/main.ts", "src/services/api.ts", "src/util.ts"],
        "edges": [["src/app.ts", "src/services/api.ts"], ["src/app.ts", "src/util.ts"],
                  ["src/main.ts", "src/app.ts"], ["src/main.ts", "src/util.ts"],
                  ["src/services/api.ts", "src/util.ts"]],
        "entrypoints": ["src/main.ts"],
    },
    "golden": TS_CTRL01_GOLDEN,
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ TS ctrl-02
FIXTURES.append({
    "name": "ts-ctrl-02", "language": "typescript", "kind": "control",
    "plantedClass": None,
    "readme": "Control: tsconfig paths aliases (@/* and @lib/*) + baseUrl. Claimed map == ground truth.",
    "repo": {
        "package.json": '{"name": "ts-ctrl-02", "version": "0.1.0"}\n',
        "tsconfig.json": '{"compilerOptions": {"baseUrl": ".", "moduleResolution": "bundler", "paths": {"@/*": ["src/*"], "@lib/*": ["src/lib/*"]}}}\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["src/main.ts"]\n',
        "src/main.ts": 'import { run } from "@/app";\nimport { util } from "@lib/util";\nrun(util());\n',
        "src/app.ts": 'import { util } from "@/lib/util";\nimport { User } from "./models/user";\nexport function run(u: string) { return u + User.name; }\n',
        "src/lib/util.ts": 'export function util() { return "u"; }\n',
        "src/models/user.ts": 'export class User { static name = "u"; }\n',
    },
    "claimed": {
        "modules": ["src/app.ts", "src/lib/util.ts", "src/main.ts", "src/models/user.ts"],
        "edges": [["src/app.ts", "src/lib/util.ts"], ["src/app.ts", "src/models/user.ts"],
                  ["src/main.ts", "src/app.ts"], ["src/main.ts", "src/lib/util.ts"]],
        "entrypoints": ["src/main.ts"],
    },
    "golden": {
        "modules": [ts_mod("src/app.ts"), ts_mod("src/lib/util.ts"),
                    ts_mod("src/main.ts", entry=True), ts_mod("src/models/user.ts")],
        "edges": [edge("src/app.ts", "src/lib/util.ts"), edge("src/app.ts", "src/models/user.ts"),
                  edge("src/main.ts", "src/app.ts"), edge("src/main.ts", "src/lib/util.ts")],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ TS ctrl-03
FIXTURES.append({
    "name": "ts-ctrl-03", "language": "typescript", "kind": "control",
    "plantedClass": None,
    "readme": "Control: barrel re-export (export * from / export {} from). Edges stop at the barrel (no pass-through to re-export targets).",
    "repo": {
        "package.json": '{"name": "ts-ctrl-03", "version": "0.1.0"}\n',
        "tsconfig.json": '{"compilerOptions": {"baseUrl": ".", "moduleResolution": "bundler"}}\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["src/main.ts"]\n',
        "src/main.ts": 'import { a, b } from "./barrel";\nconsole.log(a, b);\n',
        "src/barrel/index.ts": 'export * from "./a";\nexport { b } from "./b";\n',
        "src/barrel/a.ts": 'export const a = 1;\n',
        "src/barrel/b.ts": 'export const b = 2;\n',
    },
    "claimed": {
        "modules": ["src/barrel/a.ts", "src/barrel/b.ts", "src/barrel/index.ts", "src/main.ts"],
        "edges": [["src/barrel/index.ts", "src/barrel/a.ts"], ["src/barrel/index.ts", "src/barrel/b.ts"],
                  ["src/main.ts", "src/barrel/index.ts"]],
        "entrypoints": ["src/main.ts"],
    },
    "golden": {
        "modules": [ts_mod("src/barrel/a.ts"), ts_mod("src/barrel/b.ts"),
                    ts_mod("src/barrel/index.ts"), ts_mod("src/main.ts", entry=True)],
        "edges": [edge("src/barrel/index.ts", "src/barrel/a.ts"),
                  edge("src/barrel/index.ts", "src/barrel/b.ts"),
                  edge("src/main.ts", "src/barrel/index.ts")],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ TS ctrl-04
FIXTURES.append({
    "name": "ts-ctrl-04", "language": "typescript", "kind": "control",
    "plantedClass": None,
    "readme": "Control: type-only imports (import type, import { type }) and a .d.ts declaration file. All such edges are TYPE_ONLY.",
    "repo": {
        "package.json": '{"name": "ts-ctrl-04", "version": "0.1.0"}\n',
        "tsconfig.json": '{"compilerOptions": {"baseUrl": ".", "moduleResolution": "bundler"}}\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["src/main.ts"]\n',
        "src/main.ts": 'import type { Config } from "./types";\nimport type { L } from "./legacy";\nimport { run } from "./runner";\nexport function main(c: Config): L { run(); return c as unknown as L; }\n',
        "src/types.ts": 'export interface Config { n: number }\n',
        "src/legacy.d.ts": 'export type L = { n: number };\n',
        "src/runner.ts": 'import type { Opts } from "./shapes";\nimport { helper } from "./helper";\nexport function run(o?: Opts) { return helper(); }\n',
        "src/shapes.ts": 'export interface Opts { v?: string }\n',
        "src/helper.ts": 'export function helper() { return "h"; }\n',
    },
    "claimed": {
        "modules": ["src/helper.ts", "src/legacy.d.ts", "src/main.ts", "src/runner.ts", "src/shapes.ts", "src/types.ts"],
        "edges": [["src/main.ts", "src/legacy.d.ts"], ["src/main.ts", "src/runner.ts"],
                  ["src/main.ts", "src/types.ts"], ["src/runner.ts", "src/helper.ts"],
                  ["src/runner.ts", "src/shapes.ts"]],
        "entrypoints": ["src/main.ts"],
    },
    "golden": {
        "modules": [ts_mod("src/helper.ts"), ts_mod("src/legacy.d.ts", decl=True),
                    ts_mod("src/main.ts", entry=True), ts_mod("src/runner.ts"),
                    ts_mod("src/shapes.ts"), ts_mod("src/types.ts")],
        "edges": [edge("src/main.ts", "src/legacy.d.ts", type_only=True),
                  edge("src/main.ts", "src/runner.ts"),
                  edge("src/main.ts", "src/types.ts", type_only=True),
                  edge("src/runner.ts", "src/helper.ts"),
                  edge("src/runner.ts", "src/shapes.ts", type_only=True)],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ TS ctrl-05
FIXTURES.append({
    "name": "ts-ctrl-05", "language": "typescript", "kind": "control",
    "plantedClass": None,
    "readme": "Control: dynamic import() with a literal argument (resolves), require() with a literal, side-effect import, and .js specifier completing to .ts.",
    "repo": {
        "package.json": '{"name": "ts-ctrl-05", "version": "0.1.0"}\n',
        "tsconfig.json": '{"compilerOptions": {"baseUrl": ".", "moduleResolution": "bundler"}}\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["src/main.ts"]\n',
        "src/main.ts": 'const lazy = await import("./lazy");\nconst cfg = require("./cfg");\nimport "./side";\nimport { x } from "./plain.js";\nconsole.log(lazy, cfg, x);\n',
        "src/lazy.ts": 'export const lazy = 1;\n',
        "src/cfg.ts": 'export const cfg = 1;\n',
        "src/side.ts": 'export const side = 1;\n',
        "src/plain.ts": 'export const x = 1;\n',
    },
    "claimed": {
        "modules": ["src/cfg.ts", "src/lazy.ts", "src/main.ts", "src/plain.ts", "src/side.ts"],
        "edges": [["src/main.ts", "src/cfg.ts"], ["src/main.ts", "src/lazy.ts"],
                  ["src/main.ts", "src/plain.ts"], ["src/main.ts", "src/side.ts"]],
        "entrypoints": ["src/main.ts"],
    },
    "golden": {
        "modules": [ts_mod("src/cfg.ts"), ts_mod("src/lazy.ts"), ts_mod("src/main.ts", entry=True),
                    ts_mod("src/plain.ts"), ts_mod("src/side.ts")],
        "edges": [edge("src/main.ts", "src/cfg.ts"), edge("src/main.ts", "src/lazy.ts"),
                  edge("src/main.ts", "src/plain.ts"), edge("src/main.ts", "src/side.ts")],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ TS ctrl-06
FIXTURES.append({
    "name": "ts-ctrl-06", "language": "typescript", "kind": "control",
    "plantedClass": None,
    "readme": "Control: self-referencing package via package.json exports (bare name + subpath with wildcard).",
    "repo": {
        "package.json": '{"name": "demo-pkg", "version": "0.1.0", "exports": {".": "./src/index.ts", "./lib/*": "./src/lib/*.ts"}}\n',
        "tsconfig.json": '{"compilerOptions": {"baseUrl": ".", "moduleResolution": "bundler"}}\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["src/main.ts"]\n',
        "src/main.ts": 'import { idx } from "demo-pkg";\nimport { u } from "demo-pkg/lib/util";\nconsole.log(idx, u);\n',
        "src/index.ts": 'import { u } from "./lib/util";\nexport const idx = u;\n',
        "src/lib/util.ts": 'export const u = 1;\n',
    },
    "claimed": {
        "modules": ["src/index.ts", "src/lib/util.ts", "src/main.ts"],
        "edges": [["src/index.ts", "src/lib/util.ts"], ["src/main.ts", "src/index.ts"],
                  ["src/main.ts", "src/lib/util.ts"]],
        "entrypoints": ["src/main.ts"],
    },
    "golden": {
        "modules": [ts_mod("src/index.ts"), ts_mod("src/lib/util.ts"), ts_mod("src/main.ts", entry=True)],
        "edges": [edge("src/index.ts", "src/lib/util.ts"), edge("src/main.ts", "src/index.ts"),
                  edge("src/main.ts", "src/lib/util.ts")],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ TS ctrl-07
FIXTURES.append({
    "name": "ts-ctrl-07", "language": "typescript", "kind": "control",
    "plantedClass": None,
    "readme": "Control: TSX + .jsx module, NO tsconfig (relative imports only, no alias resolution).",
    "repo": {
        "package.json": '{"name": "ts-ctrl-07", "version": "0.1.0"}\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["src/main.tsx"]\n',
        "src/main.tsx": 'import { App } from "./App";\nexport const root = App;\n',
        "src/App.tsx": 'import { Button } from "./Button";\nimport { useList } from "./hooks/useList.jsx";\nexport const App = () => { const items = useList(); return <Button label={items[0]} />; };\n',
        "src/Button.tsx": 'import { util } from "./util";\nexport const Button = (p: { label: string }) => util() + p.label;\n',
        "src/hooks/useList.jsx": 'import { util } from "../util";\nexport function useList() { return [util()]; }\n',
        "src/util.ts": 'export function util() { return "u"; }\n',
    },
    "claimed": {
        "modules": ["src/App.tsx", "src/Button.tsx", "src/hooks/useList.jsx", "src/main.tsx", "src/util.ts"],
        "edges": [["src/App.tsx", "src/Button.tsx"], ["src/App.tsx", "src/hooks/useList.jsx"],
                  ["src/Button.tsx", "src/util.ts"], ["src/hooks/useList.jsx", "src/util.ts"],
                  ["src/main.tsx", "src/App.tsx"]],
        "entrypoints": ["src/main.tsx"],
    },
    "golden": {
        "modules": [ts_mod("src/App.tsx"), ts_mod("src/Button.tsx"), ts_mod("src/hooks/useList.jsx"),
                    ts_mod("src/main.tsx", entry=True), ts_mod("src/util.ts")],
        "edges": [edge("src/App.tsx", "src/Button.tsx"), edge("src/App.tsx", "src/hooks/useList.jsx"),
                  edge("src/Button.tsx", "src/util.ts"), edge("src/hooks/useList.jsx", "src/util.ts"),
                  edge("src/main.tsx", "src/App.tsx")],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ TS ctrl-08
FIXTURES.append({
    "name": "ts-ctrl-08", "language": "typescript", "kind": "control",
    "plantedClass": None,
    "readme": "Control: NO .repomapverify.toml (no WRONG_ENTRYPOINT possible, only ENTRYPOINT_CANDIDATE) + third-party imports counted as external.",
    "repo": {
        "package.json": '{"name": "ts-ctrl-08", "version": "0.1.0"}\n',
        "tsconfig.json": '{"compilerOptions": {"baseUrl": ".", "moduleResolution": "bundler"}}\n',
        "src/main.ts": 'import React from "react";\nimport { app } from "./app";\nconsole.log(React, app);\n',
        "src/app.ts": 'import _ from "lodash";\nimport { util } from "./util";\nexport const app = _.trim(util());\n',
        "src/util.ts": 'export function util() { return " u "; }\n',
    },
    "claimed": {
        "modules": ["src/app.ts", "src/main.ts", "src/util.ts"],
        "edges": [["src/app.ts", "src/util.ts"], ["src/main.ts", "src/app.ts"]],
        "entrypoints": ["src/main.ts"],
    },
    "golden": {
        "modules": [ts_mod("src/app.ts"), ts_mod("src/main.ts"), ts_mod("src/util.ts")],
        "edges": [edge("src/app.ts", "src/util.ts"), edge("src/main.ts", "src/app.ts")],
        "generatedEdges": [],
        "externalImportCount": 2,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ TS plant-01
FIXTURES.append({
    "name": "ts-plant-01", "language": "typescript", "kind": "planted",
    "plantedClass": "hallucinated-edge",
    "readme": "Planted HALLUCINATED_EDGE: claimed map adds main -> services/api, which main never imports (app imports api, main does not). Repo is identical to ts-ctrl-01.",
    "repo": dict(TS_CTRL01_REPO),
    "claimed": {
        "modules": ["src/app.ts", "src/main.ts", "src/services/api.ts", "src/util.ts"],
        "edges": [["src/app.ts", "src/services/api.ts"], ["src/app.ts", "src/util.ts"],
                  ["src/main.ts", "src/app.ts"], ["src/main.ts", "src/services/api.ts"],
                  ["src/main.ts", "src/util.ts"], ["src/services/api.ts", "src/util.ts"]],
        "entrypoints": ["src/main.ts"],
    },
    "golden": TS_CTRL01_GOLDEN,
    "expectedStatus": "FAIL", "expectedFindings": ["HALLUCINATED_EDGE"],
})

# ================================================================ TS plant-02
FIXTURES.append({
    "name": "ts-plant-02", "language": "typescript", "kind": "planted",
    "plantedClass": "wrong-entrypoint",
    "readme": "Planted WRONG_ENTRYPOINT: .repomapverify.toml declares src/main.ts, claimed map says src/app.ts. Repo identical to ts-ctrl-01.",
    "repo": dict(TS_CTRL01_REPO),
    "claimed": {
        "modules": ["src/app.ts", "src/main.ts", "src/services/api.ts", "src/util.ts"],
        "edges": [["src/app.ts", "src/services/api.ts"], ["src/app.ts", "src/util.ts"],
                  ["src/main.ts", "src/app.ts"], ["src/main.ts", "src/util.ts"],
                  ["src/services/api.ts", "src/util.ts"]],
        "entrypoints": ["src/app.ts"],
    },
    "golden": TS_CTRL01_GOLDEN,
    "expectedStatus": "FAIL", "expectedFindings": ["WRONG_ENTRYPOINT"],
})

# ================================================================ TS plant-03
FIXTURES.append({
    "name": "ts-plant-03", "language": "typescript", "kind": "planted",
    "plantedClass": "missing-edge",
    "readme": "Planted MISSING_EDGE: claimed map omits app -> util (module util stays listed, so no UNCLAIMED_REACHABLE_MODULE). Repo identical to ts-ctrl-01.",
    "repo": dict(TS_CTRL01_REPO),
    "claimed": {
        "modules": ["src/app.ts", "src/main.ts", "src/services/api.ts", "src/util.ts"],
        "edges": [["src/app.ts", "src/services/api.ts"],
                  ["src/main.ts", "src/app.ts"], ["src/main.ts", "src/util.ts"],
                  ["src/services/api.ts", "src/util.ts"]],
        "entrypoints": ["src/main.ts"],
    },
    "golden": TS_CTRL01_GOLDEN,
    "expectedStatus": "FAIL", "expectedFindings": ["MISSING_EDGE"],
})

# ================================================================ TS plant-04
FIXTURES.append({
    "name": "ts-plant-04", "language": "typescript", "kind": "planted",
    "plantedClass": "unclaimed-reachable-module",
    "readme": "Planted UNCLAIMED_REACHABLE_MODULE: claimed map omits the services/api module AND its incoming edge app -> api. api is reachable from the entry, so MISSING_EDGE cascades with it. Repo identical to ts-ctrl-01.",
    "repo": dict(TS_CTRL01_REPO),
    "claimed": {
        "modules": ["src/app.ts", "src/main.ts", "src/util.ts"],
        "edges": [["src/app.ts", "src/util.ts"],
                  ["src/main.ts", "src/app.ts"], ["src/main.ts", "src/util.ts"]],
        "entrypoints": ["src/main.ts"],
    },
    "golden": TS_CTRL01_GOLDEN,
    "expectedStatus": "FAIL", "expectedFindings": ["MISSING_EDGE", "UNCLAIMED_REACHABLE_MODULE"],
})

# ================================================================ TS plant-05
FIXTURES.append({
    "name": "ts-plant-05", "language": "typescript", "kind": "planted",
    "plantedClass": "name-collision",
    "readme": "Planted NAME_COLLISION_CONFUSION: two modules share basename util.ts (src/a/util.ts vs src/b/util.ts). Claimed map lists only a/util and claims b/worker -> a/util instead of b/worker -> b/util. b/util is also unclaimed-but-reachable, so UNCLAIMED_REACHABLE_MODULE cascades.",
    "repo": {
        "package.json": '{"name": "ts-plant-05", "version": "0.1.0"}\n',
        "tsconfig.json": '{"compilerOptions": {"baseUrl": ".", "moduleResolution": "bundler"}}\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["src/main.ts"]\n',
        "src/main.ts": 'import { wa } from "./a/worker";\nimport { wb } from "./b/worker";\nconsole.log(wa, wb);\n',
        "src/a/worker.ts": 'import { util } from "./util";\nexport const wa = util();\n',
        "src/a/util.ts": 'export function util() { return "a"; }\n',
        "src/b/worker.ts": 'import { util } from "./util";\nexport const wb = util();\n',
        "src/b/util.ts": 'export function util() { return "b"; }\n',
    },
    "claimed": {
        "modules": ["src/a/util.ts", "src/a/worker.ts", "src/b/worker.ts", "src/main.ts"],
        "edges": [["src/a/worker.ts", "src/a/util.ts"], ["src/b/worker.ts", "src/a/util.ts"],
                  ["src/main.ts", "src/a/worker.ts"], ["src/main.ts", "src/b/worker.ts"]],
        "entrypoints": ["src/main.ts"],
    },
    "golden": {
        "modules": [ts_mod("src/a/util.ts"), ts_mod("src/a/worker.ts"), ts_mod("src/b/util.ts"),
                    ts_mod("src/b/worker.ts"), ts_mod("src/main.ts", entry=True)],
        "edges": [edge("src/a/worker.ts", "src/a/util.ts"), edge("src/b/worker.ts", "src/b/util.ts"),
                  edge("src/main.ts", "src/a/worker.ts"), edge("src/main.ts", "src/b/worker.ts")],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "FAIL",
    "expectedFindings": ["HALLUCINATED_EDGE", "MISSING_EDGE", "NAME_COLLISION_CONFUSION", "UNCLAIMED_REACHABLE_MODULE"],
})

# ================================================================ TS plant-06
FIXTURES.append({
    "name": "ts-plant-06", "language": "typescript", "kind": "planted",
    "plantedClass": "dynamic-import-misread",
    "readme": "Planted DYNAMIC_IMPORT_MISREAD: main uses import(modName) with a VARIABLE argument (statically unresolvable -> DYNAMIC_IMPORT_UNKNOWN, no edge). Claimed map pretends the dynamic import resolved to ./other and claims main -> other.",
    "repo": {
        "package.json": '{"name": "ts-plant-06", "version": "0.1.0"}\n',
        "tsconfig.json": '{"compilerOptions": {"baseUrl": ".", "moduleResolution": "bundler"}}\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["src/main.ts"]\n',
        "src/main.ts": 'import { real } from "./real";\nconst modName = "./other";\nconst m = await import(modName);\nconsole.log(real, m);\n',
        "src/real.ts": 'export const real = 1;\n',
        "src/other.ts": 'export const other = 1;\n',
    },
    "claimed": {
        "modules": ["src/main.ts", "src/other.ts", "src/real.ts"],
        "edges": [["src/main.ts", "src/other.ts"], ["src/main.ts", "src/real.ts"]],
        "entrypoints": ["src/main.ts"],
    },
    "golden": {
        "modules": [ts_mod("src/main.ts", entry=True), ts_mod("src/other.ts"), ts_mod("src/real.ts")],
        "edges": [edge("src/main.ts", "src/real.ts")],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [unknown("src/main.ts", "modName", "DYNAMIC_IMPORT_UNKNOWN")],
        "excludedFiles": [],
    },
    "expectedStatus": "FAIL",
    "expectedFindings": ["DYNAMIC_IMPORT_UNKNOWN", "HALLUCINATED_EDGE"],
})

# ================================================================ TS plant-07
FIXTURES.append({
    "name": "ts-plant-07", "language": "typescript", "kind": "planted",
    "plantedClass": "re-export-misread",
    "readme": "Planted RE-EXPORT_MISREAD: claimed map passes through the barrel and claims main -> barrel/a directly, omitting main -> barrel/index. Repo identical to ts-ctrl-03.",
    "repo": {
        "package.json": '{"name": "ts-ctrl-03", "version": "0.1.0"}\n',
        "tsconfig.json": '{"compilerOptions": {"baseUrl": ".", "moduleResolution": "bundler"}}\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["src/main.ts"]\n',
        "src/main.ts": 'import { a, b } from "./barrel";\nconsole.log(a, b);\n',
        "src/barrel/index.ts": 'export * from "./a";\nexport { b } from "./b";\n',
        "src/barrel/a.ts": 'export const a = 1;\n',
        "src/barrel/b.ts": 'export const b = 2;\n',
    },
    "claimed": {
        "modules": ["src/barrel/a.ts", "src/barrel/b.ts", "src/barrel/index.ts", "src/main.ts"],
        "edges": [["src/barrel/index.ts", "src/barrel/a.ts"], ["src/barrel/index.ts", "src/barrel/b.ts"],
                  ["src/main.ts", "src/barrel/a.ts"]],
        "entrypoints": ["src/main.ts"],
    },
    "golden": {
        "modules": [ts_mod("src/barrel/a.ts"), ts_mod("src/barrel/b.ts"),
                    ts_mod("src/barrel/index.ts"), ts_mod("src/main.ts", entry=True)],
        "edges": [edge("src/barrel/index.ts", "src/barrel/a.ts"),
                  edge("src/barrel/index.ts", "src/barrel/b.ts"),
                  edge("src/main.ts", "src/barrel/index.ts")],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "FAIL", "expectedFindings": ["HALLUCINATED_EDGE", "MISSING_EDGE"],
})

# ================================================================ TS plant-08
FIXTURES.append({
    "name": "ts-plant-08", "language": "typescript", "kind": "planted",
    "plantedClass": "alias-misparse",
    "readme": "Planted ALIAS_MISPARSE: claimed map resolves @lib/util to src/lib/other.ts (a real but unrelated, isolated file) instead of src/lib/util.ts. Repo is ts-ctrl-02 plus an isolated src/lib/other.ts.",
    "repo": {
        "package.json": '{"name": "ts-ctrl-02", "version": "0.1.0"}\n',
        "tsconfig.json": '{"compilerOptions": {"baseUrl": ".", "moduleResolution": "bundler", "paths": {"@/*": ["src/*"], "@lib/*": ["src/lib/*"]}}}\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["src/main.ts"]\n',
        "src/main.ts": 'import { run } from "@/app";\nimport { util } from "@lib/util";\nrun(util());\n',
        "src/app.ts": 'import { util } from "@/lib/util";\nimport { User } from "./models/user";\nexport function run(u: string) { return u + User.name; }\n',
        "src/lib/util.ts": 'export function util() { return "u"; }\n',
        "src/lib/other.ts": 'export function other() { return "o"; }\n',
        "src/models/user.ts": 'export class User { static name = "u"; }\n',
    },
    "claimed": {
        "modules": ["src/app.ts", "src/lib/other.ts", "src/lib/util.ts", "src/main.ts", "src/models/user.ts"],
        "edges": [["src/app.ts", "src/lib/util.ts"], ["src/app.ts", "src/models/user.ts"],
                  ["src/main.ts", "src/app.ts"], ["src/main.ts", "src/lib/other.ts"]],
        "entrypoints": ["src/main.ts"],
    },
    "golden": {
        "modules": [ts_mod("src/app.ts"), ts_mod("src/lib/other.ts"), ts_mod("src/lib/util.ts"),
                    ts_mod("src/main.ts", entry=True), ts_mod("src/models/user.ts")],
        "edges": [edge("src/app.ts", "src/lib/util.ts"), edge("src/app.ts", "src/models/user.ts"),
                  edge("src/main.ts", "src/app.ts"), edge("src/main.ts", "src/lib/util.ts")],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "FAIL", "expectedFindings": ["HALLUCINATED_EDGE", "MISSING_EDGE"],
})

# ================================================================ Go ctrl-01
GO_CTRL01_REPO = {
    "go.mod": 'module example.com/demo\n\ngo 1.25\n',
    ".repomapverify.toml": '[entrypoints]\npaths = ["cmd/server/main.go"]\n',
    "cmd/server/main.go": 'package main\n\nimport (\n\t"fmt"\n\t"example.com/demo/internal/app"\n)\n\nfunc main() { fmt.Println(app.Name) }\n',
    "internal/app/app.go": 'package app\n\nimport (\n\t"fmt"\n\t"example.com/demo/internal/store"\n)\n\nconst Name = "app"\n\nfunc Use() { fmt.Println(store.V) }\n',
    "internal/app/app2.go": 'package app\n\nimport "fmt"\n\nfunc Use2() { fmt.Println("x") }\n',
    "internal/store/store.go": 'package store\n\nimport "fmt"\n\nconst V = 1\n\nfunc init() { fmt.Println(V) }\n',
}
GO_CTRL01_GOLDEN = {
    "modules": [
        go_mod("cmd/server", [go_file("cmd/server/main.go")], "main", entry=True),
        go_mod("internal/app", [go_file("internal/app/app.go"), go_file("internal/app/app2.go")], "app"),
        go_mod("internal/store", [go_file("internal/store/store.go")], "store"),
    ],
    "edges": [edge("cmd/server", "internal/app"), edge("internal/app", "internal/store")],
    "generatedEdges": [],
    "externalImportCount": 4,
    "unknowns": [],
    "excludedFiles": [],
}
FIXTURES.append({
    "name": "go-ctrl-01", "language": "go", "kind": "control",
    "plantedClass": None,
    "readme": "Control: basic Go packages; internal/app aggregates TWO .go files into one package node; intra-package references produce no edge.",
    "repo": GO_CTRL01_REPO,
    "claimed": {
        "modules": ["cmd/server", "internal/app", "internal/store"],
        "edges": [["cmd/server", "internal/app"], ["internal/app", "internal/store"]],
        "entrypoints": ["cmd/server"],
    },
    "golden": GO_CTRL01_GOLDEN,
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ Go ctrl-02
FIXTURES.append({
    "name": "go-ctrl-02", "language": "go", "kind": "control",
    "plantedClass": None,
    "readme": "Control: go.mod replace directive to a local directory (example.com/shared => ./third_party/shared).",
    "repo": {
        "go.mod": 'module example.com/demo\n\ngo 1.25\n\nreplace example.com/shared => ./third_party/shared\n',
        "third_party/shared/go.mod": 'module example.com/shared\n\ngo 1.25\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["cmd/main.go"]\n',
        "cmd/main.go": 'package main\n\nimport (\n\t"fmt"\n\t"example.com/shared/util"\n)\n\nfunc main() { fmt.Println(util.W) }\n',
        "third_party/shared/util/util.go": 'package util\n\nimport "fmt"\n\nconst W = 1\n\nfunc init() { fmt.Println(W) }\n',
    },
    "claimed": {
        "modules": ["cmd", "third_party/shared/util"],
        "edges": [["cmd", "third_party/shared/util"]],
        "entrypoints": ["cmd"],
    },
    "golden": {
        "modules": [
            go_mod("cmd", [go_file("cmd/main.go")], "main", entry=True),
            go_mod("third_party/shared/util", [go_file("third_party/shared/util/util.go")], "util"),
        ],
        "edges": [edge("cmd", "third_party/shared/util")],
        "generatedEdges": [],
        "externalImportCount": 2,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ Go ctrl-03
FIXTURES.append({
    "name": "go-ctrl-03", "language": "go", "kind": "control",
    "plantedClass": None,
    "readme": "Control: generated files (*.pb.go) marked GENERATED and excluded from core edges; a generated-only package is a GENERATED node; cgo file (import \"C\") marked CGO with no C-side expansion.",
    "repo": {
        "go.mod": 'module example.com/demo\n\ngo 1.25\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["cmd/server/main.go"]\n',
        "cmd/server/main.go": 'package main\n\nimport (\n\t"fmt"\n\t"example.com/demo/internal/gen"\n\t"example.com/demo/internal/native"\n\t"example.com/demo/internal/onlygen"\n)\n\nfunc main() { fmt.Println(gen.X, native.Y, onlygen.Z) }\n',
        "internal/gen/gen.go": 'package gen\n\nimport "fmt"\n\nconst X = 1\n\nfunc init() { fmt.Println(X) }\n',
        "internal/gen/gen.pb.go": '// Code generated by protoc-gen-go. DO NOT EDIT.\npackage gen\n\nimport "example.com/demo/internal/store"\n\nvar _ = store.V\n',
        "internal/onlygen/only.pb.go": '// Code generated by mockgen. DO NOT EDIT.\npackage onlygen\n\nimport "example.com/demo/internal/store"\n\nconst Z = 1\n\nvar _ = store.V\n',
        "internal/native/native.go": 'package native\n\nimport "C"\nimport "fmt"\n\nconst Y = 1\n\nfunc init() { fmt.Println(Y) }\n',
        "internal/store/store.go": 'package store\n\nimport "fmt"\n\nconst V = 1\n\nfunc init() { fmt.Println(V) }\n',
    },
    "claimed": {
        "modules": ["cmd/server", "internal/gen", "internal/native", "internal/onlygen", "internal/store"],
        "edges": [["cmd/server", "internal/gen"], ["cmd/server", "internal/native"],
                  ["cmd/server", "internal/onlygen"]],
        "entrypoints": ["cmd/server"],
    },
    "golden": {
        "modules": [
            go_mod("cmd/server", [go_file("cmd/server/main.go")], "main", entry=True),
            go_mod("internal/gen", [go_file("internal/gen/gen.go"), go_file("internal/gen/gen.pb.go", gen=True)], "gen"),
            go_mod("internal/native", [go_file("internal/native/native.go", cgo=True)], "native"),
            go_mod("internal/onlygen", [go_file("internal/onlygen/only.pb.go", gen=True)], "onlygen", gen=True),
            go_mod("internal/store", [go_file("internal/store/store.go")], "store"),
        ],
        "edges": [edge("cmd/server", "internal/gen"), edge("cmd/server", "internal/native"),
                  edge("cmd/server", "internal/onlygen")],
        "generatedEdges": [edge("internal/gen", "internal/store"), edge("internal/onlygen", "internal/store")],
        "externalImportCount": 4,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ Go ctrl-04
FIXTURES.append({
    "name": "go-ctrl-04", "language": "go", "kind": "control",
    "plantedClass": None,
    "readme": "Control: build tags under the frozen default (GOOS=linux/GOARCH=amd64). windows.go is BUILD_EXCLUDED; internal/winonly exists but is unreachable (isolated).",
    "repo": {
        "go.mod": 'module example.com/demo\n\ngo 1.25\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["cmd/main.go"]\n',
        "cmd/main.go": 'package main\n\nimport (\n\t"fmt"\n\t"example.com/demo/internal/plat"\n)\n\nfunc main() { fmt.Println(plat.P()) }\n',
        "internal/plat/linux.go": '//go:build linux\n\npackage plat\n\nimport "fmt"\n\nfunc P() string { fmt.Println("linux"); return "linux" }\n',
        "internal/plat/windows.go": '//go:build windows\n\npackage plat\n\nimport "example.com/demo/internal/winonly"\n\nfunc P() string { return winonly.W() }\n',
        "internal/winonly/winonly.go": 'package winonly\n\nfunc W() string { return "w" }\n',
    },
    "claimed": {
        "modules": ["cmd", "internal/plat", "internal/winonly"],
        "edges": [["cmd", "internal/plat"]],
        "entrypoints": ["cmd"],
    },
    "golden": {
        "modules": [
            go_mod("cmd", [go_file("cmd/main.go")], "main", entry=True),
            go_mod("internal/plat", [go_file("internal/plat/linux.go")], "plat"),
            go_mod("internal/winonly", [go_file("internal/winonly/winonly.go")], "winonly"),
        ],
        "edges": [edge("cmd", "internal/plat")],
        "generatedEdges": [],
        "externalImportCount": 2,
        "unknowns": [],
        "excludedFiles": [{"relativePath": "internal/plat/windows.go", "reason": "BUILD_EXCLUDED"}],
    },
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ Go ctrl-05
FIXTURES.append({
    "name": "go-ctrl-05", "language": "go", "kind": "control",
    "plantedClass": None,
    "readme": "Control: blank (_) and dot (.) imports still produce package edges.",
    "repo": {
        "go.mod": 'module example.com/demo\n\ngo 1.25\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["cmd/main.go"]\n',
        "cmd/main.go": 'package main\n\nimport (\n\t"fmt"\n\t_ "example.com/demo/internal/side"\n\t. "example.com/demo/internal/util"\n)\n\nfunc main() { fmt.Println(Hello) }\n',
        "internal/side/side.go": 'package side\n\nimport "example.com/demo/internal/util"\n\nvar _ = util.Hello\n',
        "internal/util/util.go": 'package util\n\nconst Hello = "hi"\n',
    },
    "claimed": {
        "modules": ["cmd", "internal/side", "internal/util"],
        "edges": [["cmd", "internal/side"], ["cmd", "internal/util"], ["internal/side", "internal/util"]],
        "entrypoints": ["cmd"],
    },
    "golden": {
        "modules": [
            go_mod("cmd", [go_file("cmd/main.go")], "main", entry=True),
            go_mod("internal/side", [go_file("internal/side/side.go")], "side"),
            go_mod("internal/util", [go_file("internal/util/util.go")], "util"),
        ],
        "edges": [edge("cmd", "internal/side"), edge("cmd", "internal/util"),
                  edge("internal/side", "internal/util")],
        "generatedEdges": [],
        "externalImportCount": 1,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ Go ctrl-06
FIXTURES.append({
    "name": "go-ctrl-06", "language": "go", "kind": "control",
    "plantedClass": None,
    "readme": "Control: NO .repomapverify.toml (no WRONG_ENTRYPOINT possible) + an external module require counted as external.",
    "repo": {
        "go.mod": 'module example.com/demo\n\ngo 1.25\n\nrequire github.com/foo/bar v1.2.3\n',
        "cmd/main.go": 'package main\n\nimport (\n\t"fmt"\n\t"github.com/foo/bar"\n\t"example.com/demo/internal/app"\n)\n\nfunc main() { fmt.Println(bar.X, app.Name) }\n',
        "internal/app/app.go": 'package app\n\nimport "fmt"\n\nconst Name = "app"\n\nfunc init() { fmt.Println(Name) }\n',
    },
    "claimed": {
        "modules": ["cmd", "internal/app"],
        "edges": [["cmd", "internal/app"]],
        "entrypoints": ["cmd"],
    },
    "golden": {
        "modules": [
            go_mod("cmd", [go_file("cmd/main.go")], "main"),
            go_mod("internal/app", [go_file("internal/app/app.go")], "app"),
        ],
        "edges": [edge("cmd", "internal/app")],
        "generatedEdges": [],
        "externalImportCount": 3,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ Go ctrl-07
FIXTURES.append({
    "name": "go-ctrl-07", "language": "go", "kind": "control",
    "plantedClass": None,
    "readme": "Control: vendor/ directory resolves github.com/foo/bar to the vendored package node vendor/github.com/foo/bar.",
    "repo": {
        "go.mod": 'module example.com/demo\n\ngo 1.25\n',
        "vendor/modules.txt": '# github.com/foo/bar v1.2.3\n## explicit; go 1.21\ngithub.com/foo/bar\n',
        "vendor/github.com/foo/bar/bar.go": 'package bar\n\nimport "fmt"\n\nconst X = 1\n\nfunc init() { fmt.Println(X) }\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["cmd/main.go"]\n',
        "cmd/main.go": 'package main\n\nimport (\n\t"fmt"\n\t"github.com/foo/bar"\n\t"example.com/demo/internal/app"\n)\n\nfunc main() { fmt.Println(bar.X, app.Name) }\n',
        "internal/app/app.go": 'package app\n\nimport "fmt"\n\nconst Name = "app"\n\nfunc init() { fmt.Println(Name) }\n',
    },
    "claimed": {
        "modules": ["cmd", "internal/app", "vendor/github.com/foo/bar"],
        "edges": [["cmd", "internal/app"], ["cmd", "vendor/github.com/foo/bar"]],
        "entrypoints": ["cmd"],
    },
    "golden": {
        "modules": [
            go_mod("cmd", [go_file("cmd/main.go")], "main", entry=True),
            go_mod("internal/app", [go_file("internal/app/app.go")], "app"),
            go_mod("vendor/github.com/foo/bar", [go_file("vendor/github.com/foo/bar/bar.go")], "bar"),
        ],
        "edges": [edge("cmd", "internal/app"), edge("cmd", "vendor/github.com/foo/bar")],
        "generatedEdges": [],
        "externalImportCount": 3,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ Go ctrl-08
FIXTURES.append({
    "name": "go-ctrl-08", "language": "go", "kind": "control",
    "plantedClass": None,
    "readme": "Control: root package (relativePath '.') + TWO declared entrypoints (main.go and cmd/tool/main.go).",
    "repo": {
        "go.mod": 'module example.com/demo\n\ngo 1.25\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["main.go", "cmd/tool/main.go"]\n',
        "main.go": 'package main\n\nimport (\n\t"fmt"\n\t"example.com/demo/internal/app"\n)\n\nfunc main() { fmt.Println(app.Name) }\n',
        "cmd/tool/main.go": 'package main\n\nimport "example.com/demo/internal/app"\n\nfunc main() { println(app.Name) }\n',
        "internal/app/app.go": 'package app\n\nconst Name = "app"\n',
    },
    "claimed": {
        "modules": [".", "cmd/tool", "internal/app"],
        "edges": [[".", "internal/app"], ["cmd/tool", "internal/app"]],
        "entrypoints": [".", "cmd/tool"],
    },
    "golden": {
        "modules": [
            go_mod(".", [go_file("main.go")], "main", entry=True),
            go_mod("cmd/tool", [go_file("cmd/tool/main.go")], "main", entry=True),
            go_mod("internal/app", [go_file("internal/app/app.go")], "app"),
        ],
        "edges": [edge(".", "internal/app"), edge("cmd/tool", "internal/app")],
        "generatedEdges": [],
        "externalImportCount": 1,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "PASS", "expectedFindings": [],
})

# ================================================================ Go plant-01
FIXTURES.append({
    "name": "go-plant-01", "language": "go", "kind": "planted",
    "plantedClass": "hallucinated-edge",
    "readme": "Planted HALLUCINATED_EDGE: claimed map adds cmd/server -> internal/store, which the server never imports (app imports store). Repo identical to go-ctrl-01.",
    "repo": dict(GO_CTRL01_REPO),
    "claimed": {
        "modules": ["cmd/server", "internal/app", "internal/store"],
        "edges": [["cmd/server", "internal/app"], ["cmd/server", "internal/store"],
                  ["internal/app", "internal/store"]],
        "entrypoints": ["cmd/server"],
    },
    "golden": GO_CTRL01_GOLDEN,
    "expectedStatus": "FAIL", "expectedFindings": ["HALLUCINATED_EDGE"],
})

# ================================================================ Go plant-02
FIXTURES.append({
    "name": "go-plant-02", "language": "go", "kind": "planted",
    "plantedClass": "wrong-entrypoint",
    "readme": "Planted WRONG_ENTRYPOINT: .repomapverify.toml declares cmd/server/main.go, claimed map says entrypoint internal/app. Repo identical to go-ctrl-01.",
    "repo": dict(GO_CTRL01_REPO),
    "claimed": {
        "modules": ["cmd/server", "internal/app", "internal/store"],
        "edges": [["cmd/server", "internal/app"], ["internal/app", "internal/store"]],
        "entrypoints": ["internal/app"],
    },
    "golden": GO_CTRL01_GOLDEN,
    "expectedStatus": "FAIL", "expectedFindings": ["WRONG_ENTRYPOINT"],
})

# ================================================================ Go plant-03
FIXTURES.append({
    "name": "go-plant-03", "language": "go", "kind": "planted",
    "plantedClass": "missing-edge",
    "readme": "Planted MISSING_EDGE: claimed map omits internal/app -> internal/store (store stays listed). Repo identical to go-ctrl-01.",
    "repo": dict(GO_CTRL01_REPO),
    "claimed": {
        "modules": ["cmd/server", "internal/app", "internal/store"],
        "edges": [["cmd/server", "internal/app"]],
        "entrypoints": ["cmd/server"],
    },
    "golden": GO_CTRL01_GOLDEN,
    "expectedStatus": "FAIL", "expectedFindings": ["MISSING_EDGE"],
})

# ================================================================ Go plant-04
FIXTURES.append({
    "name": "go-plant-04", "language": "go", "kind": "planted",
    "plantedClass": "unclaimed-reachable-module",
    "readme": "Planted UNCLAIMED_REACHABLE_MODULE: claimed map omits the internal/store package AND its incoming edge app -> store. store is reachable from the entry, so MISSING_EDGE cascades. Repo identical to go-ctrl-01.",
    "repo": dict(GO_CTRL01_REPO),
    "claimed": {
        "modules": ["cmd/server", "internal/app"],
        "edges": [["cmd/server", "internal/app"]],
        "entrypoints": ["cmd/server"],
    },
    "golden": GO_CTRL01_GOLDEN,
    "expectedStatus": "FAIL", "expectedFindings": ["MISSING_EDGE", "UNCLAIMED_REACHABLE_MODULE"],
})

# ================================================================ Go plant-05
FIXTURES.append({
    "name": "go-plant-05", "language": "go", "kind": "planted",
    "plantedClass": "name-collision",
    "readme": "Planted NAME_COLLISION_CONFUSION: two packages share the package NAME util (internal/a/util vs internal/b/util). Claimed map lists only a/util and claims b/svc -> a/util. b/util is also unclaimed-but-reachable, so UNCLAIMED_REACHABLE_MODULE cascades.",
    "repo": {
        "go.mod": 'module example.com/demo\n\ngo 1.25\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["cmd/main.go"]\n',
        "cmd/main.go": 'package main\n\nimport (\n\tasvc "example.com/demo/internal/a/svc"\n\tbsvc "example.com/demo/internal/b/svc"\n)\n\nfunc main() { asvc.Run(); bsvc.Run() }\n',
        "internal/a/svc/svc.go": 'package svc\n\nimport "example.com/demo/internal/a/util"\n\nfunc Run() { util.Hello() }\n',
        "internal/a/util/util.go": 'package util\n\nfunc Hello() {}\n',
        "internal/b/svc/svc.go": 'package svc\n\nimport "example.com/demo/internal/b/util"\n\nfunc Run() { util.Hello() }\n',
        "internal/b/util/util.go": 'package util\n\nfunc Hello() {}\n',
    },
    "claimed": {
        "modules": ["cmd", "internal/a/svc", "internal/a/util", "internal/b/svc"],
        "edges": [["cmd", "internal/a/svc"], ["cmd", "internal/b/svc"],
                  ["internal/a/svc", "internal/a/util"], ["internal/b/svc", "internal/a/util"]],
        "entrypoints": ["cmd"],
    },
    "golden": {
        "modules": [
            go_mod("cmd", [go_file("cmd/main.go")], "main", entry=True),
            go_mod("internal/a/svc", [go_file("internal/a/svc/svc.go")], "svc"),
            go_mod("internal/a/util", [go_file("internal/a/util/util.go")], "util"),
            go_mod("internal/b/svc", [go_file("internal/b/svc/svc.go")], "svc"),
            go_mod("internal/b/util", [go_file("internal/b/util/util.go")], "util"),
        ],
        "edges": [edge("cmd", "internal/a/svc"), edge("cmd", "internal/b/svc"),
                  edge("internal/a/svc", "internal/a/util"), edge("internal/b/svc", "internal/b/util")],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "FAIL",
    "expectedFindings": ["HALLUCINATED_EDGE", "MISSING_EDGE", "NAME_COLLISION_CONFUSION", "UNCLAIMED_REACHABLE_MODULE"],
})

# ================================================================ Go plant-06
FIXTURES.append({
    "name": "go-plant-06", "language": "go", "kind": "planted",
    "plantedClass": "alias-misparse",
    "readme": "Planted ALIAS_MISPARSE (replace-directive analogue): claimed map resolves example.com/shared/util to the replace root package third_party/shared instead of third_party/shared/util.",
    "repo": {
        "go.mod": 'module example.com/demo\n\ngo 1.25\n\nreplace example.com/shared => ./third_party/shared\n',
        "third_party/shared/go.mod": 'module example.com/shared\n\ngo 1.25\n',
        "third_party/shared/shared.go": 'package shared\n\nconst S = 1\n',
        "third_party/shared/util/util.go": 'package util\n\nimport "fmt"\n\nconst W = 1\n\nfunc init() { fmt.Println(W) }\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["cmd/main.go"]\n',
        "cmd/main.go": 'package main\n\nimport (\n\t"fmt"\n\t"example.com/shared/util"\n)\n\nfunc main() { fmt.Println(util.W) }\n',
    },
    "claimed": {
        "modules": ["cmd", "third_party/shared", "third_party/shared/util"],
        "edges": [["cmd", "third_party/shared"]],
        "entrypoints": ["cmd"],
    },
    "golden": {
        "modules": [
            go_mod("cmd", [go_file("cmd/main.go")], "main", entry=True),
            go_mod("third_party/shared", [go_file("third_party/shared/shared.go")], "shared"),
            go_mod("third_party/shared/util", [go_file("third_party/shared/util/util.go")], "util"),
        ],
        "edges": [edge("cmd", "third_party/shared/util")],
        "generatedEdges": [],
        "externalImportCount": 2,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "FAIL", "expectedFindings": ["HALLUCINATED_EDGE", "MISSING_EDGE"],
})

# ================================================================ Go plant-07
FIXTURES.append({
    "name": "go-plant-07", "language": "go", "kind": "planted",
    "plantedClass": "re-export-misread",
    "readme": "Planted RE-EXPORT_MISREAD (transitive-closure analogue; Go has no re-export): claimed map treats the transitive dependency cmd -> a -> b as a direct edge cmd -> b and omits cmd -> a.",
    "repo": {
        "go.mod": 'module example.com/demo\n\ngo 1.25\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["cmd/main.go"]\n',
        "cmd/main.go": 'package main\n\nimport "example.com/demo/internal/a"\n\nfunc main() { a.Run() }\n',
        "internal/a/a.go": 'package a\n\nimport "example.com/demo/internal/b"\n\nfunc Run() { b.Run() }\n',
        "internal/b/b.go": 'package b\n\nfunc Run() {}\n',
    },
    "claimed": {
        "modules": ["cmd", "internal/a", "internal/b"],
        "edges": [["cmd", "internal/b"], ["internal/a", "internal/b"]],
        "entrypoints": ["cmd"],
    },
    "golden": {
        "modules": [
            go_mod("cmd", [go_file("cmd/main.go")], "main", entry=True),
            go_mod("internal/a", [go_file("internal/a/a.go")], "a"),
            go_mod("internal/b", [go_file("internal/b/b.go")], "b"),
        ],
        "edges": [edge("cmd", "internal/a"), edge("internal/a", "internal/b")],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "expectedStatus": "FAIL", "expectedFindings": ["HALLUCINATED_EDGE", "MISSING_EDGE"],
})

# ================================================================ Go plant-08
FIXTURES.append({
    "name": "go-plant-08", "language": "go", "kind": "planted",
    "plantedClass": "build-tag-misread",
    "readme": "Planted BUILD-TAG_MISREAD (Go analogue of dynamic-import-misread: an edge that exists only in a file excluded from the frozen build): claimed map claims internal/plat -> internal/winonly, which only the windows-only file imports. Repo identical to go-ctrl-04.",
    "repo": {
        "go.mod": 'module example.com/demo\n\ngo 1.25\n',
        ".repomapverify.toml": '[entrypoints]\npaths = ["cmd/main.go"]\n',
        "cmd/main.go": 'package main\n\nimport (\n\t"fmt"\n\t"example.com/demo/internal/plat"\n)\n\nfunc main() { fmt.Println(plat.P()) }\n',
        "internal/plat/linux.go": '//go:build linux\n\npackage plat\n\nimport "fmt"\n\nfunc P() string { fmt.Println("linux"); return "linux" }\n',
        "internal/plat/windows.go": '//go:build windows\n\npackage plat\n\nimport "example.com/demo/internal/winonly"\n\nfunc P() string { return winonly.W() }\n',
        "internal/winonly/winonly.go": 'package winonly\n\nfunc W() string { return "w" }\n',
    },
    "claimed": {
        "modules": ["cmd", "internal/plat", "internal/winonly"],
        "edges": [["cmd", "internal/plat"], ["internal/plat", "internal/winonly"]],
        "entrypoints": ["cmd"],
    },
    "golden": {
        "modules": [
            go_mod("cmd", [go_file("cmd/main.go")], "main", entry=True),
            go_mod("internal/plat", [go_file("internal/plat/linux.go")], "plat"),
            go_mod("internal/winonly", [go_file("internal/winonly/winonly.go")], "winonly"),
        ],
        "edges": [edge("cmd", "internal/plat")],
        "generatedEdges": [],
        "externalImportCount": 2,
        "unknowns": [],
        "excludedFiles": [{"relativePath": "internal/plat/windows.go", "reason": "BUILD_EXCLUDED"}],
    },
    "expectedStatus": "FAIL", "expectedFindings": ["HALLUCINATED_EDGE"],
})


# ---------------------------------------------------------------- writer
def write_fixture(fx):
    lang = fx["language"]
    base = os.path.join(FIXDIR, lang, fx["name"])
    if os.path.exists(base):
        shutil.rmtree(base)
    repo_dir = os.path.join(base, "repo")
    for rel, content in fx["repo"].items():
        path = os.path.join(repo_dir, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(content)
    snap = snapshot_hash(fx["repo"])
    claimed = {
        "schema": "repomapverify.claimed-map/v1",
        "mapId": f"synthetic-{fx['name']}",
        "repo": fx["name"],
        "agent": "synthetic-agent-0.1",
        "completeness": "FULL_GRAPH",
        "repoSnapshotSha256": snap,
        "modules": [
            {"id": f"m{i+1}", "path": p,
             "kind": "package" if lang == "go" else "module"}
            for i, p in enumerate(sorted(fx["claimed"]["modules"]))
        ],
        "entrypoints": fx["claimed"]["entrypoints"],
        "edges": [{"from": a, "to": b} for a, b in fx["claimed"]["edges"]],
    }
    with open(os.path.join(base, "claimed-map.json"), "w", encoding="utf-8") as fh:
        json.dump(claimed, fh, indent=2, sort_keys=False)
        fh.write("\n")
    golden = {
        "fixture": fx["name"],
        "language": lang,
        "kind": fx["kind"],
        "plantedClass": fx["plantedClass"],
        "expected": fx["golden"],
        "expectedStatus": fx["expectedStatus"],
        "expectedFindings": sorted(fx["expectedFindings"]),
    }
    with open(os.path.join(base, "golden.json"), "w", encoding="utf-8") as fh:
        json.dump(golden, fh, indent=2, sort_keys=False)
        fh.write("\n")
    with open(os.path.join(base, "README.md"), "w", encoding="utf-8") as fh:
        fh.write(f"# {fx['name']}\n\n{fx['readme']}\n\n")
        fh.write(f"- Language: {lang}\n- Kind: {fx['kind']}\n")
        fh.write(f"- Planted class: {fx['plantedClass']}\n")
        fh.write(f"- Expected audit status: {fx['expectedStatus']}\n")
        fh.write(f"- Expected findings: {', '.join(sorted(fx['expectedFindings'])) or '(none)'}\n")


def main():
    ts = [f for f in FIXTURES if f["language"] == "typescript"]
    go = [f for f in FIXTURES if f["language"] == "go"]
    assert len(ts) == 16, f"typescript fixtures: {len(ts)} != 16"
    assert len(go) == 16, f"go fixtures: {len(go)} != 16"
    for lang, want in (("typescript", 8), ("go", 8)):
        ctrl = [f for f in FIXTURES if f["language"] == lang and f["kind"] == "control"]
        plant = [f for f in FIXTURES if f["language"] == lang and f["kind"] == "planted"]
        assert len(ctrl) == want, f"{lang} control: {len(ctrl)} != 8"
        assert len(plant) == want, f"{lang} planted: {len(plant)} != 8"
    names = [f["name"] for f in FIXTURES]
    assert len(set(names)) == len(names), "duplicate fixture names"
    for fx in FIXTURES:
        write_fixture(fx)
    print(f"wrote {len(FIXTURES)} fixtures ({len(ts)} typescript, {len(go)} go) to {FIXDIR}")


if __name__ == "__main__":
    main()
