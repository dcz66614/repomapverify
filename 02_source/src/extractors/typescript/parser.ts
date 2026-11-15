/**
 * T003 — TypeScript tree-sitter parsing (PROJECT_BOOK §4.4; frozen scope
 * in src/contracts/frozen-scope.ts).
 *
 * Loads the tree-sitter-typescript / tree-sitter-tsx WASM grammars
 * (verified by T001, scripts/env/verify-tree-sitter.mjs) and exposes a
 * small typed wrapper. No resolution logic lives here — see resolve.ts.
 */
import { Language, Parser, type Node as SyntaxNode } from "web-tree-sitter";

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve a file inside 02_source/node_modules from this module. */
function nodeModulesPath(...parts: string[]): string {
  // Walk up from this file (src/... in dev, dist/... after build) until
  // a directory containing node_modules is found.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "node_modules", "web-tree-sitter"))) {
      return join(dir, "node_modules", ...parts);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("node_modules with web-tree-sitter not found");
}

let initPromise: Promise<void> | undefined;
let tsLanguage: Language | undefined;
let tsxLanguage: Language | undefined;

async function initOnce(): Promise<void> {
  if (initPromise !== undefined) return initPromise;
  initPromise = (async () => {
    await Parser.init({
      locateFile: () =>
        nodeModulesPath("web-tree-sitter", "web-tree-sitter.wasm"),
    });
    tsLanguage = await Language.load(
      nodeModulesPath(
        "tree-sitter-typescript",
        "tree-sitter-typescript.wasm",
      ),
    );
    tsxLanguage = await Language.load(
      nodeModulesPath("tree-sitter-typescript", "tree-sitter-tsx.wasm"),
    );
  })();
  return initPromise;
}

export interface ParsedFile {
  /** Raw source text (kept so callers can slice node text). */
  source: string;
  /** True when the tree contains an ERROR node / hasError. */
  hasError: boolean;
  /** The parsed tree root node. */
  root: SyntaxNode;
}

export function isTsxFile(relativePath: string): boolean {
  return relativePath.endsWith(".tsx") || relativePath.endsWith(".jsx");
}

/** Parse one TypeScript / TSX / JS / JSX source file. */
export async function parseTypeScriptFile(
  source: string,
  relativePath: string,
): Promise<ParsedFile> {
  await initOnce();
  const lang = isTsxFile(relativePath) ? tsxLanguage : tsLanguage;
  if (lang === undefined) throw new Error("tree-sitter grammar not loaded");
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(source);
  if (tree === null) throw new Error("tree-sitter parse returned null");
  return { source, hasError: tree.rootNode.hasError, root: tree.rootNode };
}

/** Text of a syntax node, sliced from the source it was parsed from. */
export function nodeText(source: string, node: SyntaxNode): string {
  return source.slice(node.startIndex, node.endIndex);
}

/** 1-based line number of a node. */
export function nodeLine(node: SyntaxNode): number {
  return node.startPosition.row + 1;
}

/**
 * Value of a string literal node, or undefined when the node is not a
 * plain single/double-quoted string (template literals with
 * substitutions are NOT static literals).
 * Handles both `string` nodes and `template_string` nodes without
 * substitutions.
 */
export function stringLiteralValue(
  source: string,
  node: SyntaxNode,
): string | undefined {
  if (node.type === "string") {
    // Children are string_fragment nodes; quotes are anonymous tokens.
    const parts: string[] = [];
    for (const child of node.namedChildren) {
      if (child.type === "string_fragment") parts.push(nodeText(source, child));
    }
    // A string with no fragment children is the empty string "".
    return parts.join("");
  }
  if (node.type === "template_string") {
    if (source.slice(node.startIndex, node.endIndex).includes("${")) {
      return undefined;
    }
    const parts: string[] = [];
    for (const child of node.namedChildren) {
      if (child.type === "string_fragment") parts.push(nodeText(source, child));
    }
    return parts.join("");
  }
  return undefined;
}
