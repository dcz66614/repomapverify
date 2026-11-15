/**
 * Python import-statement extraction from a tree-sitter parse tree (T002).
 *
 * Handles (PROJECT_BOOK §4.3):
 * - `import a.b` / `import a, b as c` (each name is one import)
 * - `from a.b import c, d as e` / `from a.b import *` / parenthesised lists
 * - relative imports: `from . import x`, `from ..pkg import y`
 * - conditional imports: inside try/except => conditional; inside
 *   `if TYPE_CHECKING:` (or `if <x>.TYPE_CHECKING:`) => conditional + typeOnly
 * - dynamic imports: `importlib.import_module(...)`, `__import__(...)`,
 *   `exec`/`eval` of a string containing an import statement.
 *
 * What this module does NOT do: resolve dotted names to files — that is
 * resolve.ts + index.ts. This module only reports what the source SAYS,
 * with line numbers and exact statement text as evidence.
 */
import type { Node } from "web-tree-sitter";
import { ancestors, fieldChildren, walkNamed } from "./parser.js";

/** One `import ...` statement, before resolution. */
export interface RawImport {
  kind: "import";
  /** Dotted name as written, e.g. "billing.auth". */
  dotted: string;
  line: number;
  statement: string;
  conditional: boolean;
  typeOnly: boolean;
}

/** One `from X import ...` statement, before resolution. */
export interface RawFromImport {
  kind: "from";
  /** Absolute base module, or null when the base is relative-only. */
  baseDotted: string | null;
  /** Relative level (dot count) when relative, else 0. */
  level: number;
  /** Dotted module part after the dots, when relative (null for `from . import`). */
  relativePart: string | null;
  /** Imported names (dotted text, e.g. "run"); "*" marks a wildcard import. */
  names: string[];
  /** True when the import list contains "*". */
  wildcard: boolean;
  line: number;
  statement: string;
  conditional: boolean;
  typeOnly: boolean;
}

export type RawStatement = RawImport | RawFromImport;

/** One dynamic-import call site, before classification. */
export interface RawDynamic {
  /** "importlib" | "__import__" | "exec" | "eval". */
  callee: "importlib" | "__import__" | "exec" | "eval";
  /** First argument as a plain string literal, when it is one. */
  literalArg: string | undefined;
  line: number;
  statement: string;
  /** True when inside try/except or an if TYPE_CHECKING block. */
  conditional: boolean;
  /** True when inside an if TYPE_CHECKING block. */
  typeOnly: boolean;
}

export interface ExtractedStatements {
  imports: RawStatement[];
  dynamics: RawDynamic[];
}

/** Dotted text of a dotted_name / aliased_import node (alias stripped). */
function dottedText(node: Node): string {
  if (node.type === "aliased_import") {
    const name = fieldChildren(node, "name")[0];
    return name !== undefined ? name.text : node.text;
  }
  return node.text;
}

/** Plain string value of a `string` node, or undefined (not a plain literal). */
function stringLiteralValue(node: Node): string | undefined {
  if (node.type !== "string") return undefined;
  const parts: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c === null) continue;
    if (c.type === "string_content") parts.push(c.text);
    else if (c.type === "string_start" || c.type === "string_end") continue;
    else return undefined; // interpolation / escape-sequence node: not a plain literal
  }
  return parts.join("");
}

/**
 * Conditional / type-only flags for a statement node, from its ancestors:
 * - any enclosing try_statement => conditional;
 * - any enclosing if_statement whose condition is `TYPE_CHECKING` or
 *   ends with `.TYPE_CHECKING` => conditional + typeOnly.
 */
function contextFlags(node: Node): { conditional: boolean; typeOnly: boolean } {
  let conditional = false;
  let typeOnly = false;
  for (const anc of ancestors(node)) {
    if (anc.type === "try_statement") conditional = true;
    if (anc.type === "if_statement") {
      const cond = fieldChildren(anc, "condition")[0];
      const text = cond?.text.trim() ?? "";
      if (text === "TYPE_CHECKING" || text.endsWith(".TYPE_CHECKING")) {
        conditional = true;
        typeOnly = true;
      }
    }
  }
  return { conditional, typeOnly };
}

/** 1-based line of a node + its exact statement text (single line, trimmed). */
function evidence(node: Node): { line: number; statement: string } {
  return {
    line: node.startPosition.row + 1,
    statement: node.text.split("\n")[0]?.trim() ?? node.text,
  };
}

/**
 * Extract all import statements and dynamic-import call sites from a
 * parsed tree. `source` is only used for multi-line statement text
 * fallback (statement text comes from node.text).
 */
export function extractStatements(root: Node): ExtractedStatements {
  const imports: RawStatement[] = [];
  const dynamics: RawDynamic[] = [];

  walkNamed(root, (node) => {
    if (node.type === "import_statement") {
      const { conditional, typeOnly } = contextFlags(node);
      const ev = evidence(node);
      for (const nameNode of fieldChildren(node, "name")) {
        imports.push({
          kind: "import",
          dotted: dottedText(nameNode),
          line: ev.line,
          statement: ev.statement,
          conditional,
          typeOnly,
        });
      }
      return;
    }

    if (node.type === "import_from_statement") {
      const { conditional, typeOnly } = contextFlags(node);
      const ev = evidence(node);
      const moduleName = fieldChildren(node, "module_name")[0];
      let baseDotted: string | null = null;
      let level = 0;
      let relativePart: string | null = null;
      if (moduleName !== undefined) {
        if (moduleName.type === "relative_import") {
          let prefix = "";
          let dotted: string | null = null;
          for (let i = 0; i < moduleName.childCount; i++) {
            const c = moduleName.child(i);
            if (c === null) continue;
            if (c.type === "import_prefix") prefix = c.text;
            if (c.type === "dotted_name") dotted = c.text;
          }
          level = prefix.length;
          relativePart = dotted;
          baseDotted = null;
        } else {
          baseDotted = moduleName.text;
        }
      }
      const names: string[] = [];
      let wildcard = false;
      for (const nameNode of fieldChildren(node, "name")) {
        names.push(dottedText(nameNode));
      }
      // A wildcard import's node carries NO field name (verified by probe):
      // scan all children for it.
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c !== null && c.type === "wildcard_import") wildcard = true;
      }
      imports.push({
        kind: "from",
        baseDotted,
        level,
        relativePart,
        names,
        wildcard,
        line: ev.line,
        statement: ev.statement,
        conditional,
        typeOnly,
      });
      return;
    }

    if (node.type === "call") {
      const fn = fieldChildren(node, "function")[0];
      if (fn === undefined) return;
      const args = fieldChildren(node, "arguments")[0];
      const firstArg = args?.namedChild(0);
      const literal =
        firstArg !== undefined && firstArg !== null
          ? stringLiteralValue(firstArg)
          : undefined;
      const ev = evidence(node);
      const fnText = fn.text;
      const dynFlags = contextFlags(node);
      if (fn.type === "attribute" && fnText === "importlib.import_module") {
        dynamics.push({ callee: "importlib", literalArg: literal, line: ev.line, statement: ev.statement, conditional: dynFlags.conditional, typeOnly: dynFlags.typeOnly });
      } else if (fn.type === "identifier" && fnText === "__import__") {
        dynamics.push({ callee: "__import__", literalArg: literal, line: ev.line, statement: ev.statement, conditional: dynFlags.conditional, typeOnly: dynFlags.typeOnly });
      } else if (fn.type === "identifier" && (fnText === "exec" || fnText === "eval")) {
        // Only an import-bearing string is a dynamic-import vector; a
        // plain exec("x = 1") imports nothing and is not flagged.
        if (literal !== undefined && /(^|\n)\s*(import|from)\s/.test(literal)) {
          dynamics.push({
            callee: fnText as "exec" | "eval",
            literalArg: literal,
            line: ev.line,
            statement: ev.statement,
            conditional: dynFlags.conditional,
            typeOnly: dynFlags.typeOnly,
          });
        }
      }
    }
  });

  return { imports, dynamics };
}
