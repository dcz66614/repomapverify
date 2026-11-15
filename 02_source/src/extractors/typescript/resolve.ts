/**
 * T003 — TypeScript module resolution (PROJECT_BOOK §4.4; frozen scope:
 * tsconfig paths/baseUrl/moduleResolution, package.json exports, relative
 * extension completion .ts/.tsx/.js/.jsx).
 *
 * Anything outside this scope resolves to UNKNOWN — never guessed.
 * Resolution is purely lexical (file-existence checks against the repo
 * tree); nothing is executed and node_modules is never scanned.
 */
import { existsSync, readFileSync, statSync } from "node:fs";

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export type Resolution =
  | { kind: "module"; relativePath: string }
  | { kind: "external" }
  | { kind: "unknown"; reason: UnknownReason };

export type UnknownReason =
  | "ALIAS_NOT_RESOLVED"
  | "TARGET_NOT_FOUND"
  | "OUT_OF_SCOPE"
  /**
   * FIX P024 R2 P1-01: a resolution config (tsconfig.json /
   * package.json) that exists but could not be read or parsed leaves
   * alias / self-reference membership unknowable. An import that
   * cannot be ruled out as config-driven is UNKNOWN with this reason
   * — never `external`, never a guessed edge.
   */
  | "CONFIG_UNREADABLE";

/**
 * FIX P024 R2 P1-01: discriminated load status of a resolution
 * config file. The old loaders returned `undefined` both for "file
 * absent" and for "file exists but unreadable / malformed", so the
 * two cases were indistinguishable and the latter silently degraded
 * to "no config". Callers must be able to tell them apart.
 */
export type ConfigLoadStatus = "absent" | "ok" | "unreadable" | "malformed";

export interface TsConfigLoadResult {
  status: ConfigLoadStatus;
  /** Present only when status is "ok". */
  config?: TsConfig;
}

export interface PackageJsonLoadResult {
  status: ConfigLoadStatus;
  /** Present only when status is "ok". */
  packageJson?: PackageJson;
}

export interface TsConfig {
  baseUrl?: string | undefined;
  paths?: Record<string, string[]> | undefined;
  /** Present when tsconfig uses `extends` — out of frozen scope. */
  hasExtends: boolean;
  /** Raw moduleResolution value, recorded, not acted on beyond scope. */
  moduleResolution?: string | undefined;
}

export interface PackageJson {
  name?: string | undefined;
  /** Raw `exports` value (string | Record<string, unknown> | ...). */
  exports?: unknown;
}

/** Strip // and block comments plus trailing commas (JSONC, for tsconfig). */
export function stripJsonComments(text: string): string {
  let out = "";
  let i = 0;
  let quote: string | undefined;
  while (i < text.length) {
    const ch = text[i] as string;
    if (quote !== undefined) {
      out += ch;
      if (ch === "\\" && i + 1 < text.length) {
        out += text[i + 1] as string;
        i += 2;
        continue;
      }
      if (ch === quote) quote = undefined;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  // Remove trailing commas before } or ].
  return out.replace(/,\s*([}\]])/g, "$1");
}

/**
 * Load the repo-root tsconfig.json. Never throws. Read and parse are
 * separate steps (FIX P024 R2 P1-01): a file that exists but cannot
 * be read is "unreadable"; a file that reads but does not parse (or
 * is not a JSON object) is "malformed". Both are distinct from
 * "absent" — the caller must fail closed on them, never treat them
 * as "no config".
 */
export function loadTsConfig(repoRoot: string): TsConfigLoadResult {
  const path = join(repoRoot, "tsconfig.json");
  if (!existsSync(path)) return { status: "absent" };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { status: "unreadable" };
  }
  try {
    const raw = JSON.parse(stripJsonComments(text)) as {
      compilerOptions?: Record<string, unknown>;
      extends?: unknown;
    };
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { status: "malformed" };
    }
    // FIX P024 R4 P1-01: distinguish "field absent" from "field
    // explicitly null". The old `raw.compilerOptions ?? {}` converted
    // an explicit null to {}, so the `opts === null` check below was
    // dead code and {"compilerOptions":null} read as ok while the
    // Oracle said MALFORMED. Only undefined (absent) defaults to {}.
    const opts = raw.compilerOptions === undefined ? {} : raw.compilerOptions;
    if (typeof opts !== "object" || opts === null || Array.isArray(opts)) {
      return { status: "malformed" };
    }
    // FIX P024 R3 P1-02A: `paths` is a promised resolution input — a
    // present-but-wrong-typed value must be MALFORMED, never silently
    // ignored. The old code only entered the branch for objects and
    // then silently skipped non-array targets and dropped non-string
    // elements, so `paths: "not-an-object"` read as a valid empty
    // config while the Oracle said MALFORMED. Absent stays normal
    // (paths={}); an empty object stays ok. baseUrl /
    // moduleResolution keep their current lenient handling.
    const paths: Record<string, string[]> = {};
    if ("paths" in opts) {
      const rawPaths = opts.paths;
      if (
        typeof rawPaths !== "object" ||
        rawPaths === null ||
        Array.isArray(rawPaths)
      ) {
        return { status: "malformed" };
      }
      for (const [k, v] of Object.entries(rawPaths as Record<string, unknown>)) {
        if (!Array.isArray(v)) return { status: "malformed" };
        for (const x of v) {
          if (typeof x !== "string") return { status: "malformed" };
        }
        paths[k] = [...v];
      }
    }
    const baseUrl = typeof opts.baseUrl === "string" ? opts.baseUrl : undefined;
    const moduleResolution =
      typeof opts.moduleResolution === "string" ? opts.moduleResolution : undefined;
    return {
      status: "ok",
      config: { baseUrl, paths, hasExtends: raw.extends !== undefined, moduleResolution },
    };
  } catch {
    return { status: "malformed" };
  }
}

/**
 * Load the repo-root package.json. Never throws. Read and parse are
 * separate steps (FIX P024 R2 P1-01), exactly like loadTsConfig:
 * "unreadable" / "malformed" are distinct from "absent".
 */
export function loadPackageJson(repoRoot: string): PackageJsonLoadResult {
  const path = join(repoRoot, "package.json");
  if (!existsSync(path)) return { status: "absent" };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { status: "unreadable" };
  }
  try {
    const raw = JSON.parse(text) as {
      name?: unknown;
      exports?: unknown;
    };
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { status: "malformed" };
    }
    // FIX P024 R3 P1-02B: an explicitly present `name` that is not a
    // non-empty string is MALFORMED — it must not be silently
    // converted into "absent" (the old code did exactly that, so a
    // self-reference import was unknowable while the config read ok).
    // Absent stays normal (undefined); an empty string is not a
    // legal package name.
    if ("name" in raw && (typeof raw.name !== "string" || raw.name === "")) {
      return { status: "malformed" };
    }
    return {
      status: "ok",
      packageJson: {
        name: typeof raw.name === "string" ? raw.name : undefined,
        exports: raw.exports,
      },
    };
  } catch {
    return { status: "malformed" };
  }
}

/** Repo-relative POSIX path for an absolute path inside the repo, or undefined. */
function toRepoRelative(repoRoot: string, absPath: string): string | undefined {
  const rel = posix.normalize(
    absPath.replace(/\\/g, "/").replace(posix.normalize(repoRoot.replace(/\\/g, "/")), ""),
  );
  const clean = rel.replace(/^\//, "");
  if (clean === "" || clean.startsWith("..")) return undefined;
  return clean;
}

/** Candidate files for a base path (no extension, or .js/.jsx mapping). */
function extensionCandidates(baseAbs: string): string[] {
  if (baseAbs.endsWith(".js")) {
    const noExt = baseAbs.slice(0, -3);
    return [`${noExt}.ts`, `${noExt}.mts`, baseAbs, `${noExt}.d.ts`];
  }
  if (baseAbs.endsWith(".jsx")) {
    const noExt = baseAbs.slice(0, -4);
    return [`${noExt}.tsx`, baseAbs, `${noExt}.d.ts`];
  }
  if (/\.(ts|tsx|mts|cts|d\.ts)$/.test(baseAbs)) return [baseAbs];
  return [
    `${baseAbs}.ts`,
    `${baseAbs}.tsx`,
    `${baseAbs}.mts`,
    `${baseAbs}.cts`,
    `${baseAbs}.js`,
    `${baseAbs}.jsx`,
    `${baseAbs}.d.ts`,
    join(baseAbs, "index.ts"),
    join(baseAbs, "index.tsx"),
    join(baseAbs, "index.mts"),
    join(baseAbs, "index.js"),
    join(baseAbs, "index.jsx"),
    join(baseAbs, "index.d.ts"),
  ];
}

/**
 * Resolve a base path (absolute, extension maybe missing) to an existing
 * module file inside the repo. Returns the repo-relative path or undefined.
 */
export function resolveFileCandidate(
  repoRoot: string,
  baseAbs: string,
): string | undefined {
  for (const cand of extensionCandidates(baseAbs)) {
    if (existsSync(cand) && !isDirectory(cand)) {
      const rel = toRepoRelative(repoRoot, cand);
      if (rel !== undefined) return rel;
    }
  }
  return undefined;
}

import { join, normalize, posix } from "node:path";

export interface ResolverContext {
  repoRoot: string;
  /** Sorted list of module files, used only for existence checks fallback. */
  tsconfig?: TsConfig | undefined;
  packageJson?: PackageJson | undefined;
  /**
   * FIX P024 R2 P1-01: discriminated load status of each resolution
   * config. Absent when the caller did not load one (old callers):
   * resolution then behaves exactly as before. "unreadable" /
   * "malformed" means the config exists but its content is unknown —
   * resolveSpecifier must return CONFIG_UNREADABLE for any bare
   * specifier it cannot rule out as config-driven, never `external`.
   */
  tsconfigStatus?: ConfigLoadStatus;
  packageJsonStatus?: ConfigLoadStatus;
}

/** Is this specifier relative (./ or ../)? */
export function isRelativeSpecifier(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..";
}

/**
 * Match a tsconfig `paths` pattern (at most one `*`) against a specifier.
 * Returns the captured `*` text, or undefined when it does not match.
 */
export function matchPathsPattern(
  pattern: string,
  specifier: string,
): string | undefined {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === specifier ? "" : undefined;
  if (pattern.indexOf("*", star + 1) !== -1) return undefined; // out of scope
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!specifier.startsWith(prefix)) return undefined;
  if (suffix !== "" && !specifier.endsWith(suffix)) return undefined;
  if (specifier.length < prefix.length + suffix.length) return undefined;
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

/**
 * Resolve a package.json `exports` field for a subpath.
 * Supports: string export, exact subpath keys (".", "./lib/*"), and
 * condition objects. Condition preference depends on the import kind:
 * value imports resolve via import/require/default (never "types" — a
 * "types" target is a declaration file, not a runtime module); type-only
 * imports prefer "types" first.
 * Returns the export target (relative to the package root) or undefined.
 */
export function resolveExportsTarget(
  exportsField: unknown,
  subpath: string,
  preferTypes = false,
): string | undefined {
  if (typeof exportsField === "string") {
    return subpath === "." ? exportsField : undefined;
  }
  if (typeof exportsField !== "object" || exportsField === null) return undefined;
  const map = exportsField as Record<string, unknown>;
  // Exact key first.
  const exactKey = subpath === "." ? "." : `./${subpath}`;
  if (exactKey in map) return pickExportCondition(map[exactKey], preferTypes);
  // Wildcard keys "./lib/*".
  for (const [key, value] of Object.entries(map)) {
    const star = key.indexOf("*");
    if (star === -1 || key.indexOf("*", star + 1) !== -1) continue;
    const captured = matchPathsPattern(key, exactKey);
    if (captured === undefined) continue;
    const target = pickExportCondition(value, preferTypes);
    if (target === undefined) continue;
    return target.replace("*", captured);
  }
  return undefined;
}

function pickExportCondition(value: unknown, preferTypes: boolean): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const cond = value as Record<string, unknown>;
    const order = preferTypes
      ? ["types", "import", "require", "default"]
      : ["import", "require", "default"];
    for (const key of order) {
      if (typeof cond[key] === "string") return cond[key] as string;
    }
    // Nested condition object (e.g. {node: {import: ...}}): recurse
    // into OBJECT values only. A string value under an unselected
    // condition key (notably "types") must NEVER be returned for a
    // value import — a value import resolves through import/require/
    // default only (T007 regression: the old recursion returned the
    // "types" string itself, resolving value imports to .d.ts files).
    for (const v of Object.values(cond)) {
      if (typeof v !== "object" || v === null) continue;
      const nested = pickExportCondition(v, preferTypes);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

/**
 * Resolve one import specifier from one importing file.
 * `fromDirAbs` is the absolute directory of the importing file.
 * `opts.typeOnly` selects the "types" export condition for type-only
 * imports; value imports never resolve through "types".
 */
export function resolveSpecifier(
  ctx: ResolverContext,
  fromDirAbs: string,
  specifier: string,
  opts?: { typeOnly?: boolean | undefined },
): Resolution {
  const { repoRoot, tsconfig, packageJson } = ctx;

  if (isRelativeSpecifier(specifier)) {
    const baseAbs = normalize(join(fromDirAbs, specifier));
    const found = resolveFileCandidate(repoRoot, baseAbs);
    if (found !== undefined) return { kind: "module", relativePath: found };
    return { kind: "unknown", reason: "TARGET_NOT_FOUND" };
  }

  // Bare specifier: node builtins are external.
  if (specifier.startsWith("node:") || isNodeBuiltin(specifier)) {
    return { kind: "external" };
  }

  // 1. tsconfig paths (declaration order; longest-prefix pattern first
  //    is approximated by declaration order, per TS semantics).
  if (tsconfig !== undefined && tsconfig.paths !== undefined) {
    const base = tsconfig.baseUrl !== undefined
      ? join(repoRoot, tsconfig.baseUrl)
      : repoRoot;
    let anyPatternMatched = false;
    for (const [pattern, targets] of Object.entries(tsconfig.paths)) {
      const captured = matchPathsPattern(pattern, specifier);
      if (captured === undefined) continue;
      anyPatternMatched = true;
      for (const target of targets) {
        const substituted = target.replace("*", captured);
        const baseAbs = normalize(join(base, substituted));
        const found = resolveFileCandidate(repoRoot, baseAbs);
        if (found !== undefined) return { kind: "module", relativePath: found };
      }
    }
    if (anyPatternMatched) {
      return { kind: "unknown", reason: "ALIAS_NOT_RESOLVED" };
    }
    // 2. baseUrl fallback: specifier as a path under baseUrl.
    if (tsconfig.baseUrl !== undefined) {
      const baseAbs = normalize(join(base, specifier));
      const found = resolveFileCandidate(repoRoot, baseAbs);
      if (found !== undefined) return { kind: "module", relativePath: found };
    }
  }

  // 3. Self-referencing package via package.json exports.
  if (packageJson?.name !== undefined && packageJson.exports !== undefined) {
    const name = packageJson.name;
    if (specifier === name || specifier.startsWith(`${name}/`)) {
      const subpath = specifier === name ? "." : specifier.slice(name.length + 1);
      const target = resolveExportsTarget(packageJson.exports, subpath, opts?.typeOnly === true);
      if (target !== undefined) {
        const targetAbs = normalize(join(repoRoot, target.replace(/^\.\//, "")));
        const found = resolveFileCandidate(repoRoot, targetAbs);
        if (found !== undefined) return { kind: "module", relativePath: found };
        return { kind: "unknown", reason: "TARGET_NOT_FOUND" };
      }
      return { kind: "unknown", reason: "OUT_OF_SCOPE" };
    }
  }

  // 4. FIX P024 R2 P1-01: a resolution config that exists but could
  //    not be read or parsed leaves alias / self-reference membership
  //    unknowable. Every step above already ran with the configs
  //    that ARE readable (a readable tsconfig still resolves its
  //    aliases; a readable package.json still resolves self-refs),
  //    so a bare specifier reaching here while either config is bad
  //    cannot be ruled out as config-driven: it is UNKNOWN
  //    (CONFIG_UNREADABLE), never `external`. Returning `external`
  //    here made the edge silently vanish and the audit PASS.
  const tsConfigBad =
    ctx.tsconfigStatus === "unreadable" || ctx.tsconfigStatus === "malformed";
  const packageJsonBad =
    ctx.packageJsonStatus === "unreadable" || ctx.packageJsonStatus === "malformed";
  if (tsConfigBad || packageJsonBad) {
    return { kind: "unknown", reason: "CONFIG_UNREADABLE" };
  }

  // 5. Anything else bare: a specifier that is not even a valid bare
  //    package name (e.g. "@/x" with no tsconfig to give it meaning)
  //    is an unresolvable alias — UNKNOWN, never external.
  if (!isBarePackageSpecifier(specifier)) {
    return { kind: "unknown", reason: "ALIAS_NOT_RESOLVED" };
  }
  // FIX P024 R3 P1-01: `extends` chains are out of the frozen scope,
  // so when the current tsconfig uses `extends`, a bare specifier
  // reaching this fallback may be defined by the inherited config —
  // it cannot be ruled out as a third-party package and must be
  // UNKNOWN (ALIAS_NOT_RESOLVED), never `external`. Node builtins
  // already returned external at step 0, above; specifiers resolved
  // by the current paths/baseUrl or by self-reference returned
  // earlier; a bad config already returned CONFIG_UNREADABLE at
  // step 4. The reason string is the boundary-fixture convention
  // (tests/fixtures/boundary/ts-out-of-scope-extends/README.md).
  if (tsconfig?.hasExtends === true) {
    return { kind: "unknown", reason: "ALIAS_NOT_RESOLVED" };
  }
  return { kind: "external" };
}

/**
 * Is this a plausible bare package specifier (npm name, optionally
 * scoped, optionally with a subpath)? "@/x" (empty scope) is not.
 */
export function isBarePackageSpecifier(specifier: string): boolean {
  return /^(?:@[a-z0-9\-~][a-z0-9\-._~]*\/)?[a-z0-9\-~][a-z0-9\-._~]*(\/.*)?$/i.test(
    specifier,
  );
}

const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "console", "crypto",
  "dgram", "dns", "domain", "events", "fs", "http", "http2", "https",
  "net", "os", "path", "perf_hooks", "process", "punycode", "querystring",
  "readline", "repl", "stream", "string_decoder", "timers", "tls", "tty",
  "url", "util", "v8", "vm", "worker_threads", "zlib",
]);

function isNodeBuiltin(specifier: string): boolean {
  const first = specifier.split("/")[0] as string;
  return NODE_BUILTINS.has(first);
}
