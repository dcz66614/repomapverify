/**
 * T003 — go.mod parsing (PROJECT_BOOK §4.5).
 *
 * Minimal, deterministic parser for the directives the extractor needs:
 * `module`, `go`, `replace` (single-line and block forms), `require`.
 * It is NOT a general go.mod parser: unknown directives are ignored
 * (they do not affect import resolution), malformed lines are skipped
 * rather than guessed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface GoReplace {
  /** Module path (or path prefix) being replaced, without version. */
  oldPath: string;
  /** Replacement: a module path, or a local filesystem path. */
  newPath: string;
  /** True when the replacement is a local path (./, ../, or absolute). */
  newIsLocal: boolean;
}

export interface GoMod {
  modulePath?: string | undefined;
  goVersion?: string | undefined;
  replaces: GoReplace[];
  /** Required module paths (external deps; recorded, not resolved). */
  requires: string[];
}

/** Strip a trailing // comment (go.mod has no quoted '#' concerns). */
function stripComment(line: string): string {
  const idx = line.indexOf("//");
  return (idx === -1 ? line : line.slice(0, idx)).trim();
}

function parseReplaceLine(line: string): GoReplace | undefined {
  // replace old [version] => new [version]
  const m = /^replace\s+(\S+)(?:\s+\S+)?\s*=>\s*(\S+)(?:\s+\S+)?$/.exec(line);
  if (m === null) return undefined;
  const oldPath = m[1] as string;
  const newPath = m[2] as string;
  const newIsLocal =
    newPath.startsWith("./") || newPath.startsWith("../") || newPath.startsWith("/");
  return { oldPath, newPath, newIsLocal };
}

/** Parse go.mod text. Never throws. */
export function parseGoMod(text: string): GoMod {
  const result: GoMod = { replaces: [], requires: [] };
  const lines = text.split(/\r?\n/);
  let block: string | undefined;
  for (const raw of lines) {
    const line = stripComment(raw);
    if (line === "") continue;
    if (block !== undefined) {
      if (line === ")") {
        block = undefined;
        continue;
      }
      if (block === "replace") {
        const r = parseReplaceLine(`replace ${line}`);
        if (r !== undefined) result.replaces.push(r);
      } else if (block === "require") {
        const first = line.split(/\s+/)[0];
        if (first !== undefined && first !== "") result.requires.push(first);
      }
      continue;
    }
    const blockStart = /^(replace|require|exclude|retract)\s*\($/.exec(line);
    if (blockStart !== null) {
      block = blockStart[1] as string;
      continue;
    }
    if (line.startsWith("replace ")) {
      const r = parseReplaceLine(line);
      if (r !== undefined) result.replaces.push(r);
      continue;
    }
    if (line.startsWith("require ")) {
      const parts = line.split(/\s+/);
      if (parts[1] !== undefined) result.requires.push(parts[1]);
      continue;
    }
    const mod = /^module\s+(\S+)\s*$/.exec(line);
    if (mod !== null) {
      result.modulePath = mod[1] as string;
      continue;
    }
    const go = /^go\s+(\S+)\s*$/.exec(line);
    if (go !== null) {
      result.goVersion = go[1] as string;
      continue;
    }
  }
  return result;
}

/** Load and parse the repo-root go.mod, or undefined when absent. */
export function loadGoMod(repoRoot: string): GoMod | undefined {
  const path = join(repoRoot, "go.mod");
  if (!existsSync(path)) return undefined;
  try {
    return parseGoMod(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}
