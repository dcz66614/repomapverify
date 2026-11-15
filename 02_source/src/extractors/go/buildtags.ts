/**
 * T003 — Go build-constraint evaluation (PROJECT_BOOK §4.5; frozen scope:
 * default build GOOS=linux / GOARCH=amd64, no custom tags).
 *
 * Evaluates `//go:build` lines (and legacy `// +build` lines) against the
 * frozen default build. A constraint that cannot be decided inside this
 * set (custom tag, `cgo`, `goexperiment.*`, ...) raises
 * UndecidableBuildConstraint — the caller records UNKNOWN, never guesses.
 *
 * Semantics (go/build):
 * - `//go:build` lines are ANDed; within one line, space = OR, `&&`/`||`
 *   / `!` / parens per the expression grammar.
 * - Legacy `// +build` lines are ANDed; within one line, space = OR,
 *   comma = AND, `!` prefix = negation.
 * - When both forms are present, `//go:build` wins.
 */
export class UndecidableBuildConstraint extends Error {
  constructor(
    public readonly constraint: string,
  ) {
    super(`undecidable build constraint: ${constraint}`);
    this.name = "UndecidableBuildConstraint";
  }
}

/** Frozen default build (T001). */
export interface BuildContext {
  goos: string;
  goarch: string;
  /** Major.minor Go version for `go1.N` tags, e.g. "1.25". */
  goVersion: string;
}

export const DEFAULT_BUILD: BuildContext = {
  goos: "linux",
  goarch: "amd64",
  goVersion: "1.25",
};

const KNOWN_GOOS = new Set([
  "aix", "android", "darwin", "dragonfly", "freebsd", "hurd", "illumos",
  "ios", "js", "linux", "nacl", "netbsd", "openbsd", "plan9", "solaris",
  "wasip1", "windows", "zos",
]);

const KNOWN_GOARCH = new Set([
  "386", "amd64", "arm", "arm64", "loong64", "mips", "mips64", "mips64le",
  "mipsle", "ppc64", "ppc64le", "riscv64", "s390x", "sparc64", "wasm",
]);

/** Truth value of one build-tag identifier under the frozen build. */
export function evalBuildTagIdent(
  ident: string,
  ctx: BuildContext,
): boolean {
  if (ident === "unix") return ctx.goos !== "windows" && ctx.goos !== "js";
  if (KNOWN_GOOS.has(ident)) return ident === ctx.goos;
  if (KNOWN_GOARCH.has(ident)) return ident === ctx.goarch;
  if (ident === "ignore") return false;
  const go1 = /^go1\.(\d+)$/.exec(ident);
  if (go1 !== null) {
    const minor = parseInt(ctx.goVersion.split(".")[1] ?? "0", 10);
    return parseInt(go1[1] as string, 10) <= minor;
  }
  throw new UndecidableBuildConstraint(ident);
}

/** Tokenize a //go:build expression. */
function tokenizeGoBuild(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i] as string;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "!") {
      tokens.push(ch);
      i++;
      continue;
    }
    if (ch === "&" && expr[i + 1] === "&") {
      tokens.push("&&");
      i += 2;
      continue;
    }
    if (ch === "|" && expr[i + 1] === "|") {
      tokens.push("||");
      i += 2;
      continue;
    }
    const m = /^[A-Za-z0-9_./-]+/.exec(expr.slice(i));
    if (m === null) throw new UndecidableBuildConstraint(expr);
    tokens.push(m[0]);
    i += m[0].length;
  }
  return tokens;
}

/** Evaluate a //go:build expression with a recursive-descent parser. */
export function evalGoBuildExpr(expr: string, ctx: BuildContext): boolean {
  const tokens = tokenizeGoBuild(expr);
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const next = (): string | undefined => tokens[pos++];

  const parseOr = (): boolean => {
    let value = parseAnd();
    while (peek() === "||") {
      next();
      value = parseAnd() || value;
    }
    return value;
  };
  const parseAnd = (): boolean => {
    let value = parseUnary();
    while (peek() === "&&") {
      next();
      value = parseUnary() && value;
    }
    return value;
  };
  const parseUnary = (): boolean => {
    if (peek() === "!") {
      next();
      return !parseUnary();
    }
    return parsePrimary();
  };
  const parsePrimary = (): boolean => {
    const tok = next();
    if (tok === "(") {
      const value = parseOr();
      if (next() !== ")") throw new UndecidableBuildConstraint(expr);
      return value;
    }
    if (tok === undefined) throw new UndecidableBuildConstraint(expr);
    return evalBuildTagIdent(tok, ctx);
  };

  const value = parseOr();
  if (pos !== tokens.length) throw new UndecidableBuildConstraint(expr);
  return value;
}

/** Evaluate one legacy `// +build` line: space = OR, comma = AND. */
function evalPlusBuildLine(line: string, ctx: BuildContext): boolean {
  const orTerms = line.trim().split(/\s+/);
  for (const term of orTerms) {
    let termValue = true;
    for (const part of term.split(",")) {
      if (part === "") continue;
      if (part.startsWith("!")) {
        termValue = termValue && !evalBuildTagIdent(part.slice(1), ctx);
      } else {
        termValue = termValue && evalBuildTagIdent(part, ctx);
      }
    }
    if (termValue) return true;
  }
  return false;
}

export interface FileConstraints {
  /** The //go:build expressions found (empty when absent). */
  goBuild: string[];
  /** The // +build lines found (empty when absent). */
  plusBuild: string[];
}

/**
 * Extract build constraints from the leading comment lines of a Go
 * source file (all comment lines before the `package` clause).
 */
export function extractConstraints(source: string): FileConstraints {
  const goBuild: string[] = [];
  const plusBuild: string[] = [];
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("package ")) break;
    if (!line.startsWith("//")) {
      // Blank lines and block comments before the package clause end
      // the leading-comment scan only if a non-comment, non-blank line
      // appears; block comments are conservatively skipped.
      if (line !== "" && !line.startsWith("/*")) break;
      continue;
    }
    const body = line.slice(2).trim();
    if (body.startsWith("go:build ")) {
      goBuild.push(body.slice("go:build ".length).trim());
    } else if (body.startsWith("+build ")) {
      plusBuild.push(body.slice("+build ".length).trim());
    }
  }
  return { goBuild, plusBuild };
}

/**
 * Decide whether a file participates in the frozen default build.
 * `//go:build` wins over `// +build` when both are present.
 */
export function fileInBuild(
  constraints: FileConstraints,
  ctx: BuildContext = DEFAULT_BUILD,
): boolean {
  if (constraints.goBuild.length > 0) {
    return constraints.goBuild.every((expr) => evalGoBuildExpr(expr, ctx));
  }
  if (constraints.plusBuild.length > 0) {
    return constraints.plusBuild.every((line) => evalPlusBuildLine(line, ctx));
  }
  return true;
}
