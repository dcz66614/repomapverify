#!/usr/bin/env python3
"""T007 boundary fixtures generator.

Materialises tests/fixtures/boundary/<name>/ with repo/ + expected.json
(+ README.md). Every expected value in this script is a literal authored
by reasoning from PROJECT_BOOK §4.4–§4.5 and the frozen contracts — never
copied from extractor output. If a test disagrees with a literal, the
disagreement is investigated (extractor bug vs. wrong expectation) and
recorded; literals are never silently overwritten to match output.

Layout per fixture:
  repo/          synthetic repo (fixed file tree + fixed content)
  expected.json  extractor + graph + audit expectations (see below)
  README.md      boundary statement + reasoning notes

expected.json schema:
  fixture, language,
  extractor: {modules|packages, edges, generatedEdges,
              externalImportCount, unknowns, excludedFiles?}
    TS modules: {relativePath, isGenerated, isEntrypoint, parseStatus,
                 isDeclarationFile}; edges {from, to, typeOnly, kind?}
    Go packages: {relativePath, packageName, isGenerated, hasCgo,
                  files: [{relativePath, isGenerated, isCgo}]}
    unknowns: {from, reason, specifier?} (specifier asserted when present)
  graph: {modules: [paths], edges: [[from, to]],
          reachable: [paths], isolated: [paths]}
  audit: {claimed: {modules: [paths], entrypoints: [paths],
                    edges: [[from, to]]},
          status, findings: [{id, from?, to?}]}
  audit2: optional second claimed variant (go-generated: claiming a
          generated-only edge must yield GENERATED_MISMATCH, status PASS
          per the frozen T006 decision, not HALLUCINATED_EDGE).
"""
import json
import os
import shutil

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    "..", "..", "02_source", "tests", "fixtures", "boundary")

FIXTURES = {}

def fx(name, language, files, expected, readme):
    FIXTURES[name] = (language, files, expected, readme)

# ---------------------------------------------------------------- TS -----
fx("ts-dyn-import", "typescript", {
    "src/main.ts": (
        'import { lazy } from "./lazy";\n'
        'import("./ondemand").then(() => {});\n'
        'const name = "./lazy";\n'
        'import(name).then(() => {});\n'
        'import(`./${name}`).then(() => {});\n'
        'console.log(lazy);\n'
    ),
    "src/lazy.ts": "export const lazy = 1;\n",
    "src/ondemand.ts": "export const ondemand = 1;\n",
}, {
    "extractor": {
        "modules": [
            {"relativePath": "src/lazy.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/main.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/ondemand.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
        ],
        "edges": [
            {"from": "src/main.ts", "to": "src/lazy.ts", "typeOnly": False, "kind": "import"},
            {"from": "src/main.ts", "to": "src/ondemand.ts", "typeOnly": False, "kind": "dynamic-import"},
        ],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [
            {"from": "src/main.ts", "reason": "DYNAMIC_IMPORT_UNKNOWN", "specifier": "name"},
            {"from": "src/main.ts", "reason": "DYNAMIC_IMPORT_UNKNOWN", "specifier": "`./${name}`"},
        ],
    },
    "graph": {
        "modules": ["src/lazy.ts", "src/main.ts", "src/ondemand.ts"],
        "edges": [["src/main.ts", "src/lazy.ts"], ["src/main.ts", "src/ondemand.ts"]],
        "reachable": [],
        "isolated": ["src/lazy.ts", "src/main.ts", "src/ondemand.ts"],
    },
    "audit": {
        "claimed": {"modules": ["src/lazy.ts", "src/main.ts", "src/ondemand.ts"],
                    "entrypoints": [],
                    "edges": [["src/main.ts", "src/lazy.ts"], ["src/main.ts", "src/ondemand.ts"]]},
        "status": "INCOMPLETE",
        "findings": [{"id": "DYNAMIC_IMPORT_UNKNOWN", "from": "src/main.ts"}],
    },
}, """# ts-dyn-import — dynamic import() boundary (§4.4)

- Literal `import("./ondemand")` resolves to a core edge (kind dynamic-import).
- Variable argument `import(name)` and template-with-substitution
  `` import(`./${name}`) `` cannot be resolved statically: each yields a
  DYNAMIC_IMPORT_UNKNOWN unknown, never a guessed edge.
- Audit over the exact core graph is INCOMPLETE (never PASS) with exactly
  one DYNAMIC_IMPORT_UNKNOWN finding for src/main.ts (one per module).
""")

fx("ts-type-imports", "typescript", {
    "src/foo.ts": (
        "export type Foo = number;\n"
        "export type Baz = string;\n"
        "export type Qux = boolean;\n"
        "export const bar = 1;\n"
    ),
    "src/main.ts": (
        'import type { Foo } from "./foo";\n'
        'import { type Baz } from "./foo";\n'
        'import { type Qux, bar } from "./foo";\n'
        'export type { Foo } from "./foo";\n'
        'export { type Baz } from "./foo";\n'
        'const f: Foo = 1;\n'
        'const b: Baz = "x";\n'
        'const q: Qux = true;\n'
        'console.log(bar, f, b, q);\n'
    ),
}, {
    "extractor": {
        "modules": [
            {"relativePath": "src/foo.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/main.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
        ],
        # Extractor keeps the type-only and the runtime spelling as two
        # edges (dedup key includes typeOnly); the graph AND-merges them
        # into one runtime edge (see graph.edges below).
        "edges": [
            {"from": "src/main.ts", "to": "src/foo.ts", "typeOnly": True, "kind": "import"},
            {"from": "src/main.ts", "to": "src/foo.ts", "typeOnly": False, "kind": "import"},
        ],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
    },
    "graph": {
        "modules": ["src/foo.ts", "src/main.ts"],
        "edges": [["src/main.ts", "src/foo.ts"]],
        "reachable": [],
        "isolated": ["src/foo.ts", "src/main.ts"],
    },
    "audit": {
        "claimed": {"modules": ["src/foo.ts", "src/main.ts"],
                    "entrypoints": [],
                    "edges": [["src/main.ts", "src/foo.ts"]]},
        "status": "PASS",
        "findings": [],
    },
}, """# ts-type-imports — type-only import boundary (§4.4)

- `import type`, `import { type ... }`, `export type ... from`,
  `export { type ... } from` all produce TYPE_ONLY edges.
- A mixed clause `import { type Qux, bar }` is a RUNTIME edge (a value
  is imported), so the extractor holds two main.ts -> foo.ts edges
  (typeOnly true + false); the graph AND-merges them to one runtime edge.
- Audit over the exact graph is PASS.
""")

fx("ts-dts", "typescript", {
    "src/types.d.ts": (
        'import { Cfg } from "./cfg";\n'
        'export declare const t: Cfg;\n'
    ),
    "src/cfg.ts": "export type Cfg = { a: number };\nexport const c = 1;\n",
    "src/main.ts": (
        'import { t } from "./types";\n'
        'import { Cfg } from "./cfg";\n'
        'const x: Cfg = t as unknown as Cfg;\n'
        'console.log(x);\n'
    ),
}, {
    "extractor": {
        "modules": [
            {"relativePath": "src/cfg.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/main.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/types.d.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": True},
        ],
        "edges": [
            {"from": "src/main.ts", "to": "src/cfg.ts", "typeOnly": False, "kind": "import"},
            {"from": "src/main.ts", "to": "src/types.d.ts", "typeOnly": True, "kind": "import"},
            {"from": "src/types.d.ts", "to": "src/cfg.ts", "typeOnly": True, "kind": "import"},
        ],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
    },
    "graph": {
        "modules": ["src/cfg.ts", "src/main.ts", "src/types.d.ts"],
        "edges": [["src/main.ts", "src/cfg.ts"], ["src/main.ts", "src/types.d.ts"], ["src/types.d.ts", "src/cfg.ts"]],
        "reachable": [],
        "isolated": ["src/cfg.ts", "src/main.ts", "src/types.d.ts"],
    },
    "audit": {
        "claimed": {"modules": ["src/cfg.ts", "src/main.ts", "src/types.d.ts"],
                    "entrypoints": [],
                    "edges": [["src/main.ts", "src/cfg.ts"], ["src/main.ts", "src/types.d.ts"], ["src/types.d.ts", "src/cfg.ts"]]},
        "status": "PASS",
        "findings": [],
    },
}, """# ts-dts — declaration-file boundary (§4.4)

- A .d.ts file's own imports are TYPE_ONLY, and a value import whose
  target resolves to a .d.ts file is a TYPE_ONLY edge — a declaration
  file never produces a runtime edge.
- Audit over the exact graph is PASS.
""")

fx("ts-import-equals", "typescript", {
    "src/util.ts": "export const u = 1;\n",
    "src/helper.ts": "export const h = 1;\n",
    "src/main.ts": (
        'import util = require("./util");\n'
        'import helper = require("./helper");\n'
        'const r = require("./util");\n'
        'console.log(util, helper, r);\n'
    ),
}, {
    "extractor": {
        "modules": [
            {"relativePath": "src/helper.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/main.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/util.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
        ],
        # main -> util appears twice (import-equals + require) and dedups
        # to one edge, kind of the first spelling (import-equals).
        "edges": [
            {"from": "src/main.ts", "to": "src/helper.ts", "typeOnly": False, "kind": "import-equals"},
            {"from": "src/main.ts", "to": "src/util.ts", "typeOnly": False, "kind": "import-equals"},
        ],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
    },
    "graph": {
        "modules": ["src/helper.ts", "src/main.ts", "src/util.ts"],
        "edges": [["src/main.ts", "src/helper.ts"], ["src/main.ts", "src/util.ts"]],
        "reachable": [],
        "isolated": ["src/helper.ts", "src/main.ts", "src/util.ts"],
    },
    "audit": {
        "claimed": {"modules": ["src/helper.ts", "src/main.ts", "src/util.ts"],
                    "entrypoints": [],
                    "edges": [["src/main.ts", "src/helper.ts"], ["src/main.ts", "src/util.ts"]]},
        "status": "PASS",
        "findings": [],
    },
}, """# ts-import-equals — `import = require()` boundary (§4.4)

- `import x = require("./y")` produces an edge (kind import-equals);
  a literal `require("./y")` produces an edge too; the two spellings
  of the same pair dedup to one edge.
- Audit over the exact graph is PASS.
""")

fx("ts-tsconfig-paths", "typescript", {
    "tsconfig.json": json.dumps({"compilerOptions": {"baseUrl": "src", "paths": {"@/*": ["missing/*", "lib/*"], "@exact": ["lib/exact.ts"]}}}),
    "src/lib/util.ts": "export const u = 1;\n",
    "src/lib/exact.ts": "export const e = 1;\n",
    "src/lib/plain.ts": "export const p = 1;\n",
    "src/main.ts": (
        'import { u } from "@/util";\n'
        'import { e } from "@exact";\n'
        'import { p } from "lib/plain";\n'
        'import { m } from "@/gone";\n'
        'console.log(u, e, p, m);\n'
    ),
}, {
    "extractor": {
        "modules": [
            {"relativePath": "src/lib/exact.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/lib/plain.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/lib/util.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/main.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
        ],
        "edges": [
            {"from": "src/main.ts", "to": "src/lib/exact.ts", "typeOnly": False, "kind": "import"},
            {"from": "src/main.ts", "to": "src/lib/plain.ts", "typeOnly": False, "kind": "import"},
            {"from": "src/main.ts", "to": "src/lib/util.ts", "typeOnly": False, "kind": "import"},
        ],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [
            {"from": "src/main.ts", "reason": "ALIAS_NOT_RESOLVED", "specifier": "@/gone"},
        ],
    },
    "graph": {
        "modules": ["src/lib/exact.ts", "src/lib/plain.ts", "src/lib/util.ts", "src/main.ts"],
        "edges": [["src/main.ts", "src/lib/exact.ts"], ["src/main.ts", "src/lib/plain.ts"], ["src/main.ts", "src/lib/util.ts"]],
        "reachable": [],
        "isolated": ["src/lib/exact.ts", "src/lib/plain.ts", "src/lib/util.ts", "src/main.ts"],
    },
    "audit": {
        "claimed": {"modules": ["src/lib/exact.ts", "src/lib/plain.ts", "src/lib/util.ts", "src/main.ts"],
                    "entrypoints": [],
                    "edges": [["src/main.ts", "src/lib/exact.ts"], ["src/main.ts", "src/lib/plain.ts"], ["src/main.ts", "src/lib/util.ts"]]},
        "status": "INCOMPLETE",
        "findings": [],
    },
}, """# ts-tsconfig-paths — tsconfig paths + baseUrl boundary (§4.4)

- Wildcard `@/*`: the first target (missing/*) misses, the second
  (lib/*) hits — targets are tried in order.
- Exact (star-less) pattern `@exact` resolves via its single target.
- Bare `lib/plain` matches no pattern, so the baseUrl fallback
  (src + lib/plain) resolves it.
- `@/gone` matches the wildcard pattern but no target file exists:
  ALIAS_NOT_RESOLVED, never a guessed edge and never external.
- Audit over the exact core graph is INCOMPLETE (unresolvable import
  forces INCOMPLETE with no invented finding).
""")

fx("ts-exports-conditions", "typescript", {
    "package.json": json.dumps({"name": "example.com/self", "exports": {
        ".": {"types": "./dist/types.d.ts", "import": "./dist/index.js",
              "require": "./dist/index.cjs", "default": "./dist/fallback.js"},
        "./lib/*": {"import": "./dist/lib/*.js", "default": "./dist/lib/*.js"}}}),
    "dist/index.js": "export const x = 1;\n",
    "dist/fallback.js": "export const x = 2;\n",
    "dist/types.d.ts": "export declare const x: number;\n",
    "dist/lib/thing.js": "export const t = 1;\n",
    "src/main.ts": (
        'import { x } from "example.com/self";\n'
        'import { t } from "example.com/self/lib/thing";\n'
        'console.log(x, t);\n'
    ),
}, {
    "extractor": {
        "modules": [
            {"relativePath": "dist/fallback.js", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "dist/index.js", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "dist/lib/thing.js", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "dist/types.d.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": True},
            {"relativePath": "src/main.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
        ],
        "edges": [
            {"from": "src/main.ts", "to": "dist/index.js", "typeOnly": False, "kind": "import"},
            {"from": "src/main.ts", "to": "dist/lib/thing.js", "typeOnly": False, "kind": "import"},
        ],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
    },
    "graph": {
        "modules": ["dist/fallback.js", "dist/index.js", "dist/lib/thing.js", "dist/types.d.ts", "src/main.ts"],
        "edges": [["src/main.ts", "dist/index.js"], ["src/main.ts", "dist/lib/thing.js"]],
        "reachable": [],
        "isolated": ["dist/fallback.js", "dist/index.js", "dist/lib/thing.js", "dist/types.d.ts", "src/main.ts"],
    },
    "audit": {
        "claimed": {"modules": ["dist/fallback.js", "dist/index.js", "dist/lib/thing.js", "dist/types.d.ts", "src/main.ts"],
                    "entrypoints": [],
                    "edges": [["src/main.ts", "dist/index.js"], ["src/main.ts", "dist/lib/thing.js"]]},
        "status": "PASS",
        "findings": [],
    },
}, """# ts-exports-conditions — package.json exports condition objects (§4.4)

- Self-reference via package.json name + exports. A value import
  resolves through the `import` condition (never `types`, even though
  `types` is listed first in the object), and the `./lib/*` wildcard
  subpath resolves with `*` substitution.
- Audit over the exact graph is PASS.
""")

fx("ts-exports-types", "typescript", {
    "package.json": json.dumps({"name": "example.com/self", "exports": {".": {"types": "./dist/types.d.ts"}}}),
    "dist/types.d.ts": "export declare const x: number;\nexport declare type y = number;\n",
    "src/main.ts": (
        'import { x } from "example.com/self";\n'
        'import type { y } from "example.com/self";\n'
        'console.log(x);\n'
    ),
}, {
    "extractor": {
        "modules": [
            {"relativePath": "dist/types.d.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": True},
            {"relativePath": "src/main.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
        ],
        # REGRESSION (T007): a value import must NEVER resolve through
        # the `types` condition. The old nested-condition recursion
        # returned the "types" string itself, producing a bogus
        # TYPE_ONLY edge main -> dist/types.d.ts for the VALUE import.
        # Correct: value import is OUT_OF_SCOPE (unknown, no edge);
        # only the type-only import resolves via `types`.
        "edges": [
            {"from": "src/main.ts", "to": "dist/types.d.ts", "typeOnly": True, "kind": "import"},
        ],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [
            {"from": "src/main.ts", "reason": "OUT_OF_SCOPE", "specifier": "example.com/self"},
        ],
    },
    "graph": {
        "modules": ["dist/types.d.ts", "src/main.ts"],
        "edges": [["src/main.ts", "dist/types.d.ts"]],
        "reachable": [],
        "isolated": ["dist/types.d.ts", "src/main.ts"],
    },
    "audit": {
        "claimed": {"modules": ["dist/types.d.ts", "src/main.ts"],
                    "entrypoints": [],
                    "edges": [["src/main.ts", "dist/types.d.ts"]]},
        "status": "INCOMPLETE",
        "findings": [],
    },
}, """# ts-exports-types — value imports never resolve via `types` (§4.4)

REGRESSION test for the T003 bug class (exports `types` condition
preference): with exports `{".": {"types": "./dist/types.d.ts"}}`,
a VALUE import is OUT_OF_SCOPE (unknown, no edge); only the
`import type` spelling resolves through `types`, to a TYPE_ONLY edge.
Audit is INCOMPLETE (unresolvable value import), findings [].
""")

fx("ts-ext-completion", "typescript", {
    "src/a.ts": "export const a = 1;\n",
    "src/b.ts": "export const b = 1;\n",
    "src/c.tsx": "export const c = 1;\n",
    "src/d/index.ts": "export const d = 1;\n",
    "src/e/index.tsx": "export const e = 1;\n",
    "src/main.ts": (
        'import { a } from "./a";\n'
        'import { b } from "./b.js";\n'
        'import { c } from "./c.jsx";\n'
        'import { d } from "./d";\n'
        'import { e } from "./e";\n'
        'import { n } from "./nope";\n'
        'console.log(a, b, c, d, e, n);\n'
    ),
}, {
    "extractor": {
        "modules": [
            {"relativePath": "src/a.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/b.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/c.tsx", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/d/index.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/e/index.tsx", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/main.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
        ],
        "edges": [
            {"from": "src/main.ts", "to": "src/a.ts", "typeOnly": False, "kind": "import"},
            {"from": "src/main.ts", "to": "src/b.ts", "typeOnly": False, "kind": "import"},
            {"from": "src/main.ts", "to": "src/c.tsx", "typeOnly": False, "kind": "import"},
            {"from": "src/main.ts", "to": "src/d/index.ts", "typeOnly": False, "kind": "import"},
            {"from": "src/main.ts", "to": "src/e/index.tsx", "typeOnly": False, "kind": "import"},
        ],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [
            {"from": "src/main.ts", "reason": "TARGET_NOT_FOUND", "specifier": "./nope"},
        ],
    },
    "graph": {
        "modules": ["src/a.ts", "src/b.ts", "src/c.tsx", "src/d/index.ts", "src/e/index.tsx", "src/main.ts"],
        "edges": [["src/main.ts", "src/a.ts"], ["src/main.ts", "src/b.ts"], ["src/main.ts", "src/c.tsx"], ["src/main.ts", "src/d/index.ts"], ["src/main.ts", "src/e/index.tsx"]],
        "reachable": [],
        "isolated": ["src/a.ts", "src/b.ts", "src/c.tsx", "src/d/index.ts", "src/e/index.tsx", "src/main.ts"],
    },
    "audit": {
        "claimed": {"modules": ["src/a.ts", "src/b.ts", "src/c.tsx", "src/d/index.ts", "src/e/index.tsx", "src/main.ts"],
                    "entrypoints": [],
                    "edges": [["src/main.ts", "src/a.ts"], ["src/main.ts", "src/b.ts"], ["src/main.ts", "src/c.tsx"], ["src/main.ts", "src/d/index.ts"], ["src/main.ts", "src/e/index.tsx"]]},
        "status": "INCOMPLETE",
        "findings": [],
    },
}, """# ts-ext-completion — relative extension completion (§4.4)

- `./a` -> a.ts; `./b.js` -> b.ts (a .js specifier maps to the .ts
  source); `./c.jsx` -> c.tsx; `./d` -> d/index.ts; `./e` ->
  e/index.tsx (index files).
- `./nope` resolves to nothing: TARGET_NOT_FOUND, never guessed.
- Audit over the exact core graph is INCOMPLETE (missing target),
  findings [].
""")

fx("ts-out-of-scope-alias", "typescript", {
    "src/util.ts": "export const u = 1;\n",
    "src/main.ts": (
        'import { u } from "@/util";\n'
        'console.log(u);\n'
    ),
}, {
    "extractor": {
        "modules": [
            {"relativePath": "src/main.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/util.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
        ],
        "edges": [],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [
            {"from": "src/main.ts", "reason": "ALIAS_NOT_RESOLVED", "specifier": "@/util"},
        ],
    },
    "graph": {
        "modules": ["src/main.ts", "src/util.ts"],
        "edges": [],
        "reachable": [],
        "isolated": ["src/main.ts", "src/util.ts"],
    },
    "audit": {
        "claimed": {"modules": ["src/main.ts", "src/util.ts"],
                    "entrypoints": [],
                    "edges": []},
        "status": "INCOMPLETE",
        "findings": [],
    },
}, """# ts-out-of-scope-alias — out-of-frozen-scope is UNKNOWN (§4.4)

- `@/util` with NO tsconfig to give the alias meaning is
  ALIAS_NOT_RESOLVED: not an external package (not a plausible bare
  package name), not a guessed relative path, never a silent drop.
- Audit over the exact (empty-edge) graph is INCOMPLETE, findings [].
""")

fx("ts-out-of-scope-extends", "typescript", {
    "base.json": json.dumps({"compilerOptions": {"baseUrl": ".", "paths": {"@/*": ["src/*"]}}}),
    "tsconfig.json": json.dumps({"extends": "./base.json", "compilerOptions": {"baseUrl": "."}}),
    "src/util.ts": "export const u = 1;\n",
    "src/main.ts": (
        'import { u } from "@/util";\n'
        'import { u as v } from "./util";\n'
        'console.log(u, v);\n'
    ),
}, {
    "extractor": {
        "modules": [
            {"relativePath": "src/main.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
            {"relativePath": "src/util.ts", "isGenerated": False, "isEntrypoint": False, "parseStatus": "OK", "isDeclarationFile": False},
        ],
        # tsconfig `extends` is out of the frozen scope: paths from the
        # base config are NOT loaded, so @/util is unresolvable even
        # though base.json defines it. The relative import still resolves.
        "edges": [
            {"from": "src/main.ts", "to": "src/util.ts", "typeOnly": False, "kind": "import"},
        ],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [
            {"from": "src/main.ts", "reason": "ALIAS_NOT_RESOLVED", "specifier": "@/util"},
        ],
    },
    "graph": {
        "modules": ["src/main.ts", "src/util.ts"],
        "edges": [["src/main.ts", "src/util.ts"]],
        "reachable": [],
        "isolated": ["src/main.ts", "src/util.ts"],
    },
    "audit": {
        "claimed": {"modules": ["src/main.ts", "src/util.ts"],
                    "entrypoints": [],
                    "edges": [["src/main.ts", "src/util.ts"]]},
        "status": "INCOMPLETE",
        "findings": [],
    },
}, """# ts-out-of-scope-extends — tsconfig `extends` is out of scope (§4.4)

- The frozen scope covers tsconfig paths/baseUrl in the repo-root
  tsconfig itself; `extends` chains are NOT followed, so the alias
  defined only in base.json is ALIAS_NOT_RESOLVED (UNKNOWN, never
  guessed). The relative import in the same file still resolves.
- Audit over the exact core graph is INCOMPLETE, findings [].
""")

# ---------------------------------------------------------------- Go -----
fx("go-generated", "go", {
    "go.mod": "module example.com/m\n\ngo 1.25\n",
    "gen/g.pb.go": '// Code generated by protoc-gen-go. DO NOT EDIT.\npackage gen\n\nimport _ "example.com/m/target"\n',
    "gen/m.mock.go": '// Code generated by MockGen. DO NOT EDIT.\npackage gen\n\nimport _ "example.com/m/target"\n',
    "color/color.go": "package color\n\ntype Color int\n",
    "color/color_string.go": '// Code generated by "stringer -type=Color"; DO NOT EDIT.\npackage color\n\nimport _ "example.com/m/target"\n',
    "solo/s.pb.go": '// Code generated by protoc-gen-go. DO NOT EDIT.\npackage solo\n\nimport _ "example.com/m/target"\n',
    "target/t.go": "package target\n",
}, {
    "extractor": {
        "packages": [
            {"relativePath": "color", "packageName": "color", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "color/color.go", "isGenerated": False, "isCgo": False},
                       {"relativePath": "color/color_string.go", "isGenerated": True, "isCgo": False}]},
            {"relativePath": "gen", "packageName": "gen", "isGenerated": True, "hasCgo": False,
             "files": [{"relativePath": "gen/g.pb.go", "isGenerated": True, "isCgo": False},
                       {"relativePath": "gen/m.mock.go", "isGenerated": True, "isCgo": False}]},
            {"relativePath": "solo", "packageName": "solo", "isGenerated": True, "hasCgo": False,
             "files": [{"relativePath": "solo/s.pb.go", "isGenerated": True, "isCgo": False}]},
            {"relativePath": "target", "packageName": "target", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "target/t.go", "isGenerated": False, "isCgo": False}]},
        ],
        "edges": [],
        "generatedEdges": [
            {"from": "color", "to": "target"},
            {"from": "gen", "to": "target"},
            {"from": "solo", "to": "target"},
        ],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "graph": {
        "modules": ["color", "gen", "solo", "target"],
        "edges": [],
        "reachable": [],
        "isolated": ["color", "gen", "solo", "target"],
    },
    "audit": {
        "claimed": {"modules": ["color", "gen", "solo", "target"],
                    "entrypoints": [],
                    "edges": []},
        "status": "PASS",
        "findings": [],
    },
    "audit2": {
        # Claiming a generated-only edge: the edge exists, but only in
        # generated code -> GENERATED_MISMATCH (P2), NOT hallucinated,
        # and per the frozen T006 decision it does not flip PASS.
        "claimed": {"modules": ["color", "gen", "solo", "target"],
                    "entrypoints": [],
                    "edges": [["gen", "target"]]},
        "status": "PASS",
        "findings": [{"id": "GENERATED_MISMATCH", "from": "gen", "to": "target"}],
    },
}, """# go-generated — generated code boundary (§4.5)

- *.pb.go, *.mock.go (suffix) and stringer output (header
  `Code generated by "stringer ..."`) are all marked GENERATED; their
  edges live in generatedEdges only, never in the core graph.
- A package whose every file is generated (gen, solo) is itself
  isGenerated; a mixed package (color) is not.
- Audit A (generated edges unclaimed): PASS — generated edges are not
  MISSING_EDGEs. Audit B (generated edge claimed): PASS with exactly
  one GENERATED_MISMATCH finding (T006 frozen decision: the finding
  does not flip PASS; module-level generated-ness assertion is a T008
  schema matter — see HANDOFF_T007).
""")

fx("go-generated-dedup", "go", {
    "go.mod": "module example.com/m\n\ngo 1.25\n",
    "pkg/a.pb.go": '// Code generated by protoc-gen-go. DO NOT EDIT.\npackage pkg\n\nimport _ "example.com/m/target"\n',
    "pkg/z.go": 'package pkg\n\nimport _ "example.com/m/target"\n',
    "target/t.go": "package target\n",
}, {
    "extractor": {
        "packages": [
            {"relativePath": "pkg", "packageName": "pkg", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "pkg/a.pb.go", "isGenerated": True, "isCgo": False},
                       {"relativePath": "pkg/z.go", "isGenerated": False, "isCgo": False}]},
            {"relativePath": "target", "packageName": "target", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "target/t.go", "isGenerated": False, "isCgo": False}]},
        ],
        # REGRESSION (T007): the same package pair imported by BOTH a
        # generated file (a.pb.go, sorts first) and a hand-written file
        # (z.go) must appear in BOTH lists. The old single dedup set
        # dropped the core edge entirely (generated file won).
        "edges": [{"from": "pkg", "to": "target"}],
        "generatedEdges": [{"from": "pkg", "to": "target"}],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "graph": {
        "modules": ["pkg", "target"],
        "edges": [["pkg", "target"]],
        "reachable": [],
        "isolated": ["pkg", "target"],
    },
    "audit": {
        "claimed": {"modules": ["pkg", "target"],
                    "entrypoints": [],
                    "edges": [["pkg", "target"]]},
        "status": "PASS",
        "findings": [],
    },
}, """# go-generated-dedup — generated/hand dedup regression (§4.5)

REGRESSION (T007): a package pair imported by both a generated file
and a hand-written file must yield BOTH a core edge and a generated
edge. The old shared dedup set kept only the alphabetically-first
file's edge and silently lost the real hand-written edge from the
ground truth. Claiming the edge verifies against the core edge: PASS.
""")

fx("go-cgo", "go", {
    "go.mod": "module example.com/m\n\ngo 1.25\n",
    ".repomapverify.toml": '[entrypoints]\npaths = ["cmd/main.go"]\n',
    "cmd/main.go": 'package main\n\nimport (\n\t"C"\n\t_ "example.com/m/lib"\n)\n',
    "lib/l.go": "package lib\n",
}, {
    "extractor": {
        "packages": [
            {"relativePath": "cmd", "packageName": "main", "isGenerated": False, "hasCgo": True,
             "files": [{"relativePath": "cmd/main.go", "isGenerated": False, "isCgo": True}]},
            {"relativePath": "lib", "packageName": "lib", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "lib/l.go", "isGenerated": False, "isCgo": False}]},
        ],
        "edges": [{"from": "cmd", "to": "lib"}],
        "generatedEdges": [],
        # import "C" is a marker only: not an edge, not an external
        # import, not an unknown — cgo alone never makes an audit
        # INCOMPLETE.
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "graph": {
        "modules": ["cmd", "lib"],
        "edges": [["cmd", "lib"]],
        "reachable": ["cmd", "lib"],
        "isolated": [],
    },
    "audit": {
        "claimed": {"modules": ["cmd", "lib"],
                    "entrypoints": ["cmd/main.go"],
                    "edges": [["cmd", "lib"]]},
        "status": "PASS",
        "findings": [],
    },
}, """# go-cgo — cgo boundary (§4.5)

- A file importing "C" marks its package hasCgo; no edge is expanded
  to the C side, "C" is not counted as an external import, and no
  unknown is recorded — the audit is PASS, not INCOMPLETE, on the
  cgo account alone. The file's ordinary Go import still yields a
  core edge, and the declared entrypoint seeds reachability.
""")

fx("go-vendor", "go", {
    "go.mod": "module example.com/m\n\ngo 1.25\n\nrequire example.com/dep v1.0.0\n",
    "main.go": 'package main\n\nimport _ "example.com/dep/sub"\n',
    "vendor/example.com/dep/sub/s.go": "package sub\n",
    "vendor/modules.txt": "# example.com/dep v1.0.0\n## explicit; go 1.25\n",
}, {
    "extractor": {
        "packages": [
            {"relativePath": ".", "packageName": "main", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "main.go", "isGenerated": False, "isCgo": False}]},
            {"relativePath": "vendor/example.com/dep/sub", "packageName": "sub", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "vendor/example.com/dep/sub/s.go", "isGenerated": False, "isCgo": False}]},
        ],
        "edges": [{"from": ".", "to": "vendor/example.com/dep/sub"}],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "graph": {
        "modules": [".", "vendor/example.com/dep/sub"],
        "edges": [[".", "vendor/example.com/dep/sub"]],
        "reachable": [],
        "isolated": [".", "vendor/example.com/dep/sub"],
    },
    "audit": {
        "claimed": {"modules": [".", "vendor/example.com/dep/sub"],
                    "entrypoints": [],
                    "edges": [[".", "vendor/example.com/dep/sub"]]},
        "status": "PASS",
        "findings": [],
    },
}, """# go-vendor — vendor/ resolution boundary (§4.5)

- An external module import resolves to the vendored package under
  vendor/ when that content exists: the edge targets the vendor
  package node (not an external count, not UNKNOWN).
- Audit over the exact graph is PASS.
""")

fx("go-vendor-missing", "go", {
    "go.mod": "module example.com/m\n\ngo 1.25\n\nrequire example.com/dep v1.0.0\n",
    "main.go": 'package main\n\nimport (\n\t_ "example.com/dep"\n\t_ "example.com/other"\n)\n',
}, {
    "extractor": {
        "packages": [
            {"relativePath": ".", "packageName": "main", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "main.go", "isGenerated": False, "isCgo": False}]},
        ],
        "edges": [],
        "generatedEdges": [],
        # No vendor/ directory: external deps are NOT expanded and are
        # counted as EXTERNAL (2 import occurrences), not UNKNOWN —
        # the audit stays PASS over the exact (empty-edge) graph.
        "externalImportCount": 2,
        "unknowns": [],
        "excludedFiles": [],
    },
    "graph": {
        "modules": ["."],
        "edges": [],
        "reachable": [],
        "isolated": ["."],
    },
    "audit": {
        "claimed": {"modules": ["."],
                    "entrypoints": [],
                    "edges": []},
        "status": "PASS",
        "findings": [],
    },
}, """# go-vendor-missing — missing vendor/ boundary (§4.5)

- With no vendor/ directory, external module imports are counted
  (EXTERNAL_IMPORTS) and not expanded — never UNKNOWN, never edges.
- Audit over the exact graph is PASS.
""")

fx("go-buildtags", "go", {
    "go.mod": "module example.com/m\n\ngo 1.25\n",
    "pkg/old.go": '//go:build go1.21\n\npackage pkg\n\nimport _ "example.com/m/target"\n',
    "pkg/new.go": '//go:build go1.26\n\npackage pkg\n\nimport _ "example.com/m/target"\n',
    "pkg/both.go": '//go:build linux && amd64\n\npackage pkg\n\nimport _ "example.com/m/target"\n',
    "pkg/notamd.go": '//go:build linux && !amd64\n\npackage pkg\n\nimport _ "example.com/m/target"\n',
    "pkg/win.go": '// +build windows\n\npackage pkg\n\nimport _ "example.com/m/target"\n',
    "pkg/lin.go": '// +build linux\n\npackage pkg\n\nimport _ "example.com/m/target"\n',
    "pkg/mystery.go": '//go:build mytag\n\npackage pkg\n\nimport _ "example.com/m/target"\n',
    "target/t.go": "package target\n",
}, {
    "extractor": {
        "packages": [
            {"relativePath": "pkg", "packageName": "pkg", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "pkg/both.go", "isGenerated": False, "isCgo": False},
                       {"relativePath": "pkg/lin.go", "isGenerated": False, "isCgo": False},
                       {"relativePath": "pkg/old.go", "isGenerated": False, "isCgo": False}]},
            {"relativePath": "target", "packageName": "target", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "target/t.go", "isGenerated": False, "isCgo": False}]},
        ],
        # old.go (go1.21 <= frozen 1.25), both.go (linux && amd64) and
        # lin.go (legacy +build linux) participate; all three import the
        # same target, so one deduped core edge.
        "edges": [{"from": "pkg", "to": "target"}],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [
            {"from": "pkg", "reason": "UNDECIDABLE_BUILD_CONSTRAINT"},
        ],
        "excludedFiles": [
            {"relativePath": "pkg/mystery.go", "reason": "UNDECIDABLE_BUILD_CONSTRAINT"},
            {"relativePath": "pkg/new.go", "reason": "BUILD_EXCLUDED"},
            {"relativePath": "pkg/notamd.go", "reason": "BUILD_EXCLUDED"},
            {"relativePath": "pkg/win.go", "reason": "BUILD_EXCLUDED"},
        ],
    },
    "graph": {
        "modules": ["pkg", "target"],
        "edges": [["pkg", "target"]],
        "reachable": [],
        "isolated": ["pkg", "target"],
    },
    "audit": {
        "claimed": {"modules": ["pkg", "target"],
                    "entrypoints": [],
                    "edges": [["pkg", "target"]]},
        "status": "INCOMPLETE",
        "findings": [],
    },
}, """# go-buildtags — frozen build-tag boundary (§4.5, GOOS=linux/GOARCH=amd64)

- In the frozen build: go1.21 (<= 1.25) in, go1.26 out; `linux && amd64`
  in, `linux && !amd64` out; legacy `// +build linux` in,
  `// +build windows` out.
- Custom tag `mytag` is undecidable: the file is excluded AND an
  UNDECIDABLE_BUILD_CONSTRAINT unknown is recorded (never guessed in
  or out) — the audit is INCOMPLETE, findings [].
""")

fx("go-test-files", "go", {
    "go.mod": "module example.com/m\n\ngo 1.25\n",
    "pkg/p.go": 'package pkg\n\nimport _ "example.com/m/target"\n',
    "pkg/p_test.go": 'package pkg\n\nimport (\n\t"testing"\n\t_ "example.com/m/other"\n)\n\nvar _ = testing.T{}\n',
    "target/t.go": "package target\n",
    "other/o.go": "package other\n",
}, {
    "extractor": {
        "packages": [
            {"relativePath": "other", "packageName": "other", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "other/o.go", "isGenerated": False, "isCgo": False}]},
            {"relativePath": "pkg", "packageName": "pkg", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "pkg/p.go", "isGenerated": False, "isCgo": False}]},
            {"relativePath": "target", "packageName": "target", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "target/t.go", "isGenerated": False, "isCgo": False}]},
        ],
        # Only the hand-written file's import counts: the _test.go
        # import of example.com/m/other produces NO edge, and its
        # stdlib `testing` import is not counted either (the file is
        # excluded before parsing).
        "edges": [{"from": "pkg", "to": "target"}],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [
            {"relativePath": "pkg/p_test.go", "reason": "TEST_FILE"},
        ],
    },
    "graph": {
        "modules": ["other", "pkg", "target"],
        "edges": [["pkg", "target"]],
        "reachable": [],
        "isolated": ["other", "pkg", "target"],
    },
    "audit": {
        "claimed": {"modules": ["other", "pkg", "target"],
                    "entrypoints": [],
                    "edges": [["pkg", "target"]]},
        "status": "PASS",
        "findings": [],
    },
}, """# go-test-files — _test.go exclusion boundary (§4.5)

- `_test.go` files are excluded from package composition (TEST_FILE):
  their imports produce no edges and no external counts. The test
  file here imports a different in-repo package (other) precisely so
  that a wrongly-included test file would show up as a spurious
  pkg -> other edge.
- Audit over the exact graph is PASS.
""")

fx("go-replace", "go", {
    "go.mod": (
        "module example.com/m\n"
        "\n"
        "go 1.25\n"
        "\n"
        "replace example.com/a => ./local/a\n"
        "\n"
        "replace example.com/b => example.com/c v2.0.0\n"
        "\n"
        "replace example.com/d => ../outside-d\n"
    ),
    "main.go": 'package main\n\nimport (\n\t_ "example.com/a"\n\t_ "example.com/b"\n\t_ "example.com/d"\n)\n',
    "local/a/a.go": "package a\n",
}, {
    "extractor": {
        "packages": [
            {"relativePath": ".", "packageName": "main", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "main.go", "isGenerated": False, "isCgo": False}]},
            {"relativePath": "local/a", "packageName": "a", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "local/a/a.go", "isGenerated": False, "isCgo": False}]},
        ],
        "edges": [{"from": ".", "to": "local/a"}],
        "generatedEdges": [],
        # b is replaced by another (external) module path and d is
        # replaced by a path outside the repo: both are EXTERNAL
        # (counted, not expanded, not UNKNOWN).
        "externalImportCount": 2,
        "unknowns": [],
        "excludedFiles": [],
    },
    "graph": {
        "modules": [".", "local/a"],
        "edges": [[".", "local/a"]],
        "reachable": [],
        "isolated": [".", "local/a"],
    },
    "audit": {
        "claimed": {"modules": [".", "local/a"],
                    "entrypoints": [],
                    "edges": [[".", "local/a"]]},
        "status": "PASS",
        "findings": [],
    },
}, """# go-replace — replace-directive boundary (§4.5)

- `replace example.com/a => ./local/a` (local, in-repo) resolves to
  the local package.
- `replace example.com/b => example.com/c v2.0.0` (versioned, to
  another module) is external, not expanded.
- `replace example.com/d => ../outside-d` (local path escaping the
  repo) is external too — consistent with the absolute-path case —
  never UNKNOWN (T007 fix).
- Audit over the exact graph is PASS.
""")

fx("go-package-nodes", "go", {
    "go.mod": "module example.com/m\n\ngo 1.25\n",
    ".repomapverify.toml": '[entrypoints]\npaths = ["cmd/main.go"]\n',
    "cmd/main.go": 'package main\n\nimport _ "example.com/m/pkg"\n',
    "pkg/a.go": 'package pkg\n\nimport _ "example.com/m/lib1"\n',
    "pkg/b.go": 'package pkg\n\nimport _ "example.com/m/lib2"\n',
    "lib1/x.go": "package lib1\n",
    "lib2/y.go": "package lib2\n",
}, {
    "extractor": {
        "packages": [
            {"relativePath": "cmd", "packageName": "main", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "cmd/main.go", "isGenerated": False, "isCgo": False}]},
            {"relativePath": "lib1", "packageName": "lib1", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "lib1/x.go", "isGenerated": False, "isCgo": False}]},
            {"relativePath": "lib2", "packageName": "lib2", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "lib2/y.go", "isGenerated": False, "isCgo": False}]},
            {"relativePath": "pkg", "packageName": "pkg", "isGenerated": False, "hasCgo": False,
             "files": [{"relativePath": "pkg/a.go", "isGenerated": False, "isCgo": False},
                       {"relativePath": "pkg/b.go", "isGenerated": False, "isCgo": False}]},
        ],
        # Two files, one package node, two package-level edges; no
        # file-level edges and no intra-package (pkg -> pkg) edge.
        "edges": [
            {"from": "cmd", "to": "pkg"},
            {"from": "pkg", "to": "lib1"},
            {"from": "pkg", "to": "lib2"},
        ],
        "generatedEdges": [],
        "externalImportCount": 0,
        "unknowns": [],
        "excludedFiles": [],
    },
    "graph": {
        "modules": ["cmd", "lib1", "lib2", "pkg"],
        "edges": [["cmd", "pkg"], ["pkg", "lib1"], ["pkg", "lib2"]],
        "reachable": ["cmd", "lib1", "lib2", "pkg"],
        "isolated": [],
    },
    "audit": {
        "claimed": {"modules": ["cmd", "lib1", "lib2", "pkg"],
                    "entrypoints": ["cmd/main.go"],
                    "edges": [["cmd", "pkg"], ["pkg", "lib1"], ["pkg", "lib2"]]},
        "status": "PASS",
        "findings": [],
    },
}, """# go-package-nodes — package-level node boundary (§4.5, §4.1)

- Graph nodes are PACKAGES: pkg/a.go + pkg/b.go aggregate to one
  `pkg` node (files are composition evidence, not nodes); the two
  files' imports become two package-level edges pkg -> lib1/lib2,
  with no file-level edges and no intra-package edge.
- The declared entrypoint seeds reachability over all four packages.
- Audit over the exact graph is PASS.
""")

# ---------------------------------------------------------------- main ----
def main():
    if os.path.exists(ROOT):
        shutil.rmtree(ROOT)
    for name, (language, files, expected, readme) in sorted(FIXTURES.items()):
        d = os.path.join(ROOT, name)
        for rel, content in files.items():
            p = os.path.join(d, "repo", rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                f.write(content)
        doc = {"fixture": name, "language": language}
        doc.update(expected)
        with open(os.path.join(d, "expected.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2, ensure_ascii=False)
            f.write("\n")
        with open(os.path.join(d, "README.md"), "w", encoding="utf-8") as f:
            f.write(readme)
        print(f"{name}: {len(files)} repo files")
    print(f"total: {len(FIXTURES)} boundary fixtures in {ROOT}")

if __name__ == "__main__":
    main()
