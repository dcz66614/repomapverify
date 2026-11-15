/**
 * T001 parser-scheme verification (PROJECT_BOOK §8.1, §12; PLAN §3.2, T001).
 *
 * Proves, by a REAL run under Node 24, that Tree-sitter WASM parses a
 * small Python / TypeScript / TSX / Go sample and that import statements
 * are findable with tree-sitter queries. Also proves that a syntactically
 * broken sample is DETECTED (hasError / ERROR node) — the property the
 * PARSE_ERROR finding depends on.
 *
 * Usage: node scripts/env/verify-tree-sitter.mjs
 * Exit 0 = all checks pass; non-zero = scheme NOT verified.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser, Query } from "web-tree-sitter";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NM = join(ROOT, "node_modules");

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/* ---- 1. Exact package identity: name + version + license (from disk) ---- */
const PACKAGES = [
  "web-tree-sitter",
  "tree-sitter-python",
  "tree-sitter-typescript",
  "tree-sitter-go",
];
console.log("== packages ==");
for (const name of PACKAGES) {
  const pkg = JSON.parse(readFileSync(join(NM, name, "package.json"), "utf8"));
  console.log(`  ${pkg.name}@${pkg.version}  license=${pkg.license}`);
  check(`package ${name} is MIT`, pkg.license === "MIT", `${pkg.version}`);
}

/* ---- 2. Init the WASM runtime ---- */
await Parser.init({
  locateFile: () => join(NM, "web-tree-sitter", "web-tree-sitter.wasm"),
});
console.log("== runtime initialised (web-tree-sitter WASM) ==");

async function loadGrammar(pkgName, wasmFile) {
  const lang = await Language.load(join(NM, pkgName, wasmFile));
  return lang;
}

function countCaptures(lang, querySrc, rootNode) {
  const query = new Query(lang, querySrc);
  return query.captures(rootNode).length;
}

/* ---- 3. Python sample ---- */
const PY = `import os
import billing.auth
from billing.api import get_invoice
from . import helpers
from ..pkg import util
from .x import y  # __init__ re-export shape
`;
{
  const lang = await loadGrammar("tree-sitter-python", "tree-sitter-python.wasm");
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(PY);
  const root = tree.rootNode;
  check("python: parses without error", !root.hasError, root.toString().slice(0, 120));
  check(
    "python: finds 2 import_statement nodes",
    countCaptures(lang, "(import_statement) @imp", root) === 2,
  );
  check(
    "python: finds 4 import_from_statement nodes",
    countCaptures(lang, "(import_from_statement) @imp", root) === 4,
  );
  console.log(`  python sexp: ${root.toString().slice(0, 200)}`);
}

/* ---- 4. TypeScript sample ---- */
const TS = `import { a } from "./a";
import b from "@/lib/b";
import type { T } from "./types";
export { c } from "./c";
const d = require("./d");
const e = await import("./e");
`;
{
  const lang = await loadGrammar(
    "tree-sitter-typescript",
    "tree-sitter-typescript.wasm",
  );
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(TS);
  const root = tree.rootNode;
  check("typescript: parses without error", !root.hasError, root.toString().slice(0, 120));
  check(
    "typescript: finds 3 import_statement nodes",
    countCaptures(lang, "(import_statement) @imp", root) === 3,
  );
  check(
    "typescript: finds 1 export_statement node",
    countCaptures(lang, "(export_statement) @exp", root) === 1,
  );
  console.log(`  typescript sexp: ${root.toString().slice(0, 200)}`);
}

/* ---- 5. TSX sample (same grammar family, separate WASM) ---- */
const TSX = `import React from "react";
import { Button } from "./Button";
export const App = () => <Button label="hi" />;
`;
{
  const lang = await loadGrammar("tree-sitter-typescript", "tree-sitter-tsx.wasm");
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(TSX);
  const root = tree.rootNode;
  check("tsx: parses without error", !root.hasError, root.toString().slice(0, 120));
  check(
    "tsx: finds 2 import_statement nodes",
    countCaptures(lang, "(import_statement) @imp", root) === 2,
  );
}

/* ---- 6. Go sample ---- */
const GO = `package billing

import (
	"fmt"
	"example.com/billing/auth"
	_ "example.com/billing/migrations"
)

func Run() { fmt.Println(auth.Name) }
`;
{
  const lang = await loadGrammar("tree-sitter-go", "tree-sitter-go.wasm");
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(GO);
  const root = tree.rootNode;
  check("go: parses without error", !root.hasError, root.toString().slice(0, 120));
  check(
    "go: finds 1 import_declaration node",
    countCaptures(lang, "(import_declaration) @imp", root) === 1,
  );
  check(
    "go: finds 3 import_spec nodes",
    countCaptures(lang, "(import_spec) @imp", root) === 3,
  );
  console.log(`  go sexp: ${root.toString().slice(0, 200)}`);
}

/* ---- 7. Broken input MUST be detected (PARSE_ERROR depends on this) ---- */
{
  const lang = await loadGrammar("tree-sitter-python", "tree-sitter-python.wasm");
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse("def broken(:\n  import os\n");
  check(
    "python: broken sample reports an error",
    tree.rootNode.hasError,
    tree.rootNode.toString().slice(0, 120),
  );
}

console.log(`\n== result: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ==`);
process.exit(failures === 0 ? 0 : 1);
