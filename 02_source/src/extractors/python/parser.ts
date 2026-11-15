/**
 * Tree-sitter Python parser bootstrap (T002).
 *
 * Follows the proven T001 pattern (scripts/env/verify-tree-sitter.mjs):
 * web-tree-sitter 0.27.2 ESM has NO default export — use named imports
 * { Language, Parser, Query }. The WASM files are resolved relative to
 * this module, so the same code works from src/ (vitest) and dist/
 * (node): both live three levels below 02_source/.
 *
 * NOTE on the web-tree-sitter 0.27 Node API (verified by probe, T002):
 * - Node has NO childByFieldName / childrenByFieldName — iterate
 *   child(i) (0..childCount) and read fieldNameForChild(i).
 * - Node.parent walks to the enclosing node; node.text is the source slice.
 * - Comments are NAMED nodes: filter by node.type, never by child index.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";
import type { Node, Tree } from "web-tree-sitter";

let parserPromise: Promise<Parser> | undefined;

/** Lazily initialise the WASM runtime once and load tree-sitter-python. */
export async function getPythonParser(): Promise<Parser> {
  if (parserPromise === undefined) {
    parserPromise = (async () => {
      const here = dirname(fileURLToPath(import.meta.url));
      const nm = join(here, "..", "..", "..", "node_modules");
      await Parser.init({
        locateFile: () => join(nm, "web-tree-sitter", "web-tree-sitter.wasm"),
      });
      const lang = await Language.load(
        join(nm, "tree-sitter-python", "tree-sitter-python.wasm"),
      );
      const parser = new Parser();
      parser.setLanguage(lang);
      return parser;
    })();
  }
  return parserPromise;
}

/** Parse Python source text. The caller owns the returned tree. */
export async function parsePython(
  source: string,
  parser?: Parser,
): Promise<{ tree: Tree; parser: Parser }> {
  const p = parser ?? (await getPythonParser());
  const tree = p.parse(source);
  if (tree === null) throw new Error("tree-sitter failed to parse input");
  return { tree, parser: p };
}

/** All children of `node` carrying the given field name, in source order. */
export function fieldChildren(node: Node, field: string): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < node.childCount; i++) {
    if (node.fieldNameForChild(i) === field) {
      const child = node.child(i);
      if (child !== null) out.push(child);
    }
  }
  return out;
}

/** First child of `node` carrying the given field name, if any. */
export function fieldChild(node: Node, field: string): Node | undefined {
  return fieldChildren(node, field)[0];
}

/** Depth-first walk of NAMED nodes only (comments are named: filter by type). */
export function walkNamed(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child !== null) walkNamed(child, visit);
  }
}

/**
 * Ancestor chain of `node` (nearest first, excluding the node itself).
 * Used to detect try/except and `if TYPE_CHECKING:` context.
 */
export function ancestors(node: Node): Node[] {
  const out: Node[] = [];
  let p: Node | null = node.parent;
  while (p !== null) {
    out.push(p);
    p = p.parent;
  }
  return out;
}
