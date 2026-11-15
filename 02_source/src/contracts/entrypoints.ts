/**
 * Entrypoint declaration contract (P0 fix #4, PROJECT_BOOK §6.5,
 * IMPLEMENTATION_PLAN §4.5).
 *
 * The ONLY authoritative source for entrypoints is the optional
 * `.repomapverify.toml` at the repo root:
 *
 *   [entrypoints]
 *   paths = ["src/main.ts", "src/cli.ts"]
 *
 * Rules frozen by the spec:
 * - A repo may declare MULTIPLE entrypoints; never infer a single unique
 *   entrypoint from graph roots alone.
 * - With NO file, or an empty `paths` list, WRONG_ENTRYPOINT is NEVER
 *   raised; the auditor only emits ENTRYPOINT_CANDIDATE hints.
 * - Claimed-map `entrypoints` must agree with this declaration when present.
 *
 * This module defines the type and a minimal, strict, dependency-free
 * parser for exactly this shape. It is NOT a general TOML parser: any
 * other section/key is rejected so a malformed declaration fails loudly
 * instead of being silently misread.
 */

export interface EntrypointsToml {
  /** Declared entrypoint paths, repo-relative, in declaration order. */
  paths: string[];
}

export const ENTRYPOINTS_TOML_FILENAME = ".repomapverify.toml" as const;

/** Error raised when a .repomapverify.toml cannot be parsed as declared. */
export class EntrypointsTomlError extends Error {
  constructor(message: string) {
    super(`invalid ${ENTRYPOINTS_TOML_FILENAME}: ${message}`);
    this.name = "EntrypointsTomlError";
  }
}

/**
 * Parse the `[entrypoints] paths = [...]` declaration. Accepts comments
 * (`# ...`), single/double-quoted strings, trailing commas and arbitrary
 * whitespace. Rejects unknown sections/keys, duplicate sections, and a
 * missing `paths` key (an empty file means "no declaration" only when the
 * caller treats absence as such — see parseEntrypointsTomlOptional).
 */
export function parseEntrypointsToml(text: string): EntrypointsToml {
  const lines = text.split(/\r?\n/);
  let inEntrypoints = false;
  let seenSection = false;
  let paths: string[] | undefined;

  for (const rawLine of lines) {
    // Strip comments that are not inside quotes (paths contain no '#'
    // in practice; a '#' inside a quoted string is preserved by the
    // string scanner below, so strip only a '#' preceded by whitespace
    // or at line start when outside quotes — conservative approach:
    // scan char by char tracking quote state).
    let line = "";
    let quote: string | undefined;
    for (let i = 0; i < rawLine.length; i++) {
      const ch = rawLine[i] as string;
      if (quote !== undefined) {
        line += ch;
        if (ch === quote) quote = undefined;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        line += ch;
      } else if (ch === "#") {
        break;
      } else {
        line += ch;
      }
    }
    line = line.trim();
    if (line === "") continue;

    const section = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (section !== null) {
      const name = section[1] as string;
      if (name === "entrypoints") {
        if (seenSection) {
          throw new EntrypointsTomlError("duplicate [entrypoints] section");
        }
        seenSection = true;
        inEntrypoints = true;
      } else {
        throw new EntrypointsTomlError(`unsupported section [${name}]`);
      }
      continue;
    }

    if (!inEntrypoints) {
      throw new EntrypointsTomlError(`key outside [entrypoints]: ${line}`);
    }
    const kv = /^paths\s*=\s*(.+)$/.exec(line);
    if (kv === null) {
      throw new EntrypointsTomlError(`unsupported key in [entrypoints]: ${line}`);
    }
    if (paths !== undefined) {
      throw new EntrypointsTomlError("duplicate paths key");
    }
    paths = parseStringArray(kv[1] as string);
  }

  if (!seenSection) {
    throw new EntrypointsTomlError("missing [entrypoints] section");
  }
  if (paths === undefined) {
    throw new EntrypointsTomlError("missing paths key in [entrypoints]");
  }
  for (const p of paths) {
    if (p === "" || p.startsWith("/") || p.split("/").includes("..")) {
      throw new EntrypointsTomlError(`entrypoint path must be repo-relative: ${JSON.stringify(p)}`);
    }
  }
  return { paths };
}

/**
 * Parse when the file may be absent: `undefined` text means "no file" and
 * yields an empty declaration (no WRONG_ENTRYPOINT, only candidates).
 * A present-but-malformed file still throws.
 */
export function parseEntrypointsTomlOptional(
  text: string | undefined,
): EntrypointsToml {
  if (text === undefined) return { paths: [] };
  if (text.trim() === "") return { paths: [] };
  return parseEntrypointsToml(text);
}

function parseStringArray(raw: string): string[] {
  const s = raw.trim();
  if (!s.startsWith("[") || !s.endsWith("]")) {
    throw new EntrypointsTomlError(`paths must be an array: ${raw}`);
  }
  const inner = s.slice(1, -1).trim();
  if (inner === "") return [];
  const out: string[] = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i] as string)) i++;
    if (i >= inner.length) break;
    const q = inner[i] as string;
    if (q !== '"' && q !== "'") {
      throw new EntrypointsTomlError(`paths entries must be quoted strings: ${raw}`);
    }
    i++;
    let value = "";
    let closed = false;
    while (i < inner.length) {
      const ch = inner[i] as string;
      if (ch === "\\" && q === '"' && i + 1 < inner.length) {
        value += inner[i + 1] as string;
        i += 2;
        continue;
      }
      if (ch === q) {
        closed = true;
        i++;
        break;
      }
      value += ch;
      i++;
    }
    if (!closed) {
      throw new EntrypointsTomlError(`unterminated string in paths: ${raw}`);
    }
    out.push(value);
  }
  return out;
}
