/**
 * T003 — Go tree-sitter parsing (PROJECT_BOOK §4.5).
 * Loads the tree-sitter-go WASM grammar (verified by T001) and exposes
 * a small typed wrapper plus Go-specific node helpers.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser, type Node as SyntaxNode } from "web-tree-sitter";

function nodeModulesPath(...parts: string[]): string {
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
let goLanguage: Language | undefined;

async function initOnce(): Promise<void> {
  if (initPromise !== undefined) return initPromise;
  initPromise = (async () => {
    await Parser.init({
      locateFile: () => nodeModulesPath("web-tree-sitter", "web-tree-sitter.wasm"),
    });
    goLanguage = await Language.load(
      nodeModulesPath("tree-sitter-go", "tree-sitter-go.wasm"),
    );
  })();
  return initPromise;
}

export interface ParsedGoFile {
  source: string;
  hasError: boolean;
  root: SyntaxNode;
}

export async function parseGoFile(source: string): Promise<ParsedGoFile> {
  await initOnce();
  if (goLanguage === undefined) throw new Error("tree-sitter-go not loaded");
  const parser = new Parser();
  parser.setLanguage(goLanguage);
  const tree = parser.parse(source);
  if (tree === null) throw new Error("tree-sitter parse returned null");
  return { source, hasError: tree.rootNode.hasError, root: tree.rootNode };
}

export function nodeText(source: string, node: SyntaxNode): string {
  return source.slice(node.startIndex, node.endIndex);
}

export function nodeLine(node: SyntaxNode): number {
  return node.startPosition.row + 1;
}

/** First named child of a given type, or null. */
export function childOfType(node: SyntaxNode, type: string): SyntaxNode | null {
  for (const child of node.namedChildren) {
    if (child.type === type) return child;
  }
  return null;
}

/**
 * Value of a Go interpreted string literal node (unquoted). Handles the
 * standard escapes via JSON.parse (Go interpreted strings share JSON's
 * escape syntax for the cases that occur in import paths).
 */
export function goStringValue(source: string, node: SyntaxNode): string | undefined {
  const raw = nodeText(source, node);
  if (!raw.startsWith('"') || !raw.endsWith('"')) return undefined;
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw.slice(1, -1);
  }
}

export type { SyntaxNode };
