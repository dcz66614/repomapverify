/**
 * Python module resolution against the T001-frozen search paths
 * (PROJECT_BOOK §4.3; contracts/frozen-scope.ts PYTHON_FROZEN_SCOPE).
 *
 * Search paths: the repo root, plus an explicit `src` layout when a
 * `src/` directory exists. A package boundary is the presence of
 * `__init__.py`: a dotted name `a.b.c` resolves only when every
 * intermediate package directory holds an `__init__.py` (namespace
 * packages without `__init__.py` are OUT of the frozen scope and do not
 * resolve — they become UNKNOWN, never guessed).
 *
 * Dotted names are computed against the LONGEST matching search root, so
 * `src/app/api.py` is `app.api` (src is on the path), not `src.app.api`.
 * When a repo-root file and a src/ file map to the same dotted name, the
 * repo-root file wins (search-path order: repo root first, src second).
 *
 * Resolution order for a dotted name:
 *   1. repo-local module file (`<search>/<dotted path>.py`), or package
 *      `__init__.py` (`<search>/<dotted path>/__init__.py`);
 *   2. otherwise NOT a repo edge (classified by the caller as stdlib /
 *      third-party EXTERNAL, or as an unresolvable repo-local import when
 *      the top-level name is repo-local).
 *
 * `from a.b import c` sub-module rule (spec §4.3): `c` is a sub-module
 * edge ONLY when `a.b.c` resolves as a module file; otherwise `c` is an
 * attribute of `a.b` and produces no edge. That check lives in the
 * extractor (extract.ts); this module only answers "does dotted X exist
 * as a module, and at which path?".
 */
import { normalizeRelativePath } from "../../contracts/module.js";

/** One .py file known to the index, with its dotted name per search root. */
export interface IndexedModule {
  /** Repo-relative POSIX path, e.g. "src/app/api.py". */
  relativePath: string;
  /** Dotted name relative to its search root, e.g. "app.api". */
  dottedName: string;
  /** True when this file is a package __init__.py. */
  isPackageInit: boolean;
}

export type ResolveResult =
  | { kind: "module"; module: IndexedModule }
  | { kind: "not-found" };

export class PythonModuleIndex {
  /** Dotted name -> module (search-path order wins on collision). */
  private byDotted = new Map<string, IndexedModule>();
  /** Repo-relative path -> module. */
  private byPath = new Map<string, IndexedModule>();
  /** Dotted package names that exist (that directory holds an __init__.py). */
  private packages = new Set<string>();
  /** Top-level names present anywhere repo-local (module or package). */
  private topLevelNames = new Set<string>();

  constructor(modules: IndexedModule[]) {
    for (const m of modules) {
      this.byPath.set(m.relativePath, m);
      // First entry wins: callers pass modules in search-path priority
      // order (repo root before src/), so collisions resolve deterministically.
      if (!this.byDotted.has(m.dottedName)) {
        this.byDotted.set(m.dottedName, m);
      }
      const top = m.dottedName.split(".")[0];
      if (top !== undefined && top !== "") this.topLevelNames.add(top);
      if (m.isPackageInit) this.packages.add(m.dottedName);
    }
  }

  /** All indexed modules, sorted by relativePath. */
  allModules(): IndexedModule[] {
    return [...this.byPath.values()].sort((a, b) =>
      a.relativePath < b.relativePath
        ? -1
        : a.relativePath > b.relativePath
          ? 1
          : 0,
    );
  }

  byRelativePath(relativePath: string): IndexedModule | undefined {
    return this.byPath.get(normalizeRelativePath(relativePath));
  }

  /**
   * True when the dotted name resolves to a repo module file AND every
   * intermediate package holds an `__init__.py` (frozen package boundary).
   */
  resolveDotted(dotted: string): ResolveResult {
    const m = this.byDotted.get(dotted);
    if (m === undefined) return { kind: "not-found" };
    const parts = dotted.split(".");
    for (let i = 1; i < parts.length; i++) {
      if (!this.packages.has(parts.slice(0, i).join("."))) {
        return { kind: "not-found" };
      }
    }
    return { kind: "module", module: m };
  }

  /** True when `dotted` names a package (its directory has __init__.py). */
  isPackage(dotted: string): boolean {
    return this.packages.has(dotted);
  }

  /** True when the top-level name has any repo-local module or package. */
  hasTopLevel(top: string): boolean {
    return this.topLevelNames.has(top);
  }

  /**
   * Package dotted name of a module, from its INDEXED dotted name:
   * - "pkg.sub.mod" (plain module) -> "pkg.sub"
   * - "pkg" (__init__ of pkg)     -> "pkg"
   * - "mod" (top-level module)    -> "" (no package)
   */
  static packageOfDotted(dottedName: string, isPackageInit: boolean): string {
    const parts = dottedName.split(".");
    if (isPackageInit) return dottedName;
    return parts.slice(0, -1).join(".");
  }

  /**
   * Resolve a relative import (PROJECT_BOOK §4.3).
   *
   * `level` is the dot count (1 = current package). `modulePart` is the
   * dotted name after the dots, or null for `from . import x`.
   * Returns the ABSOLUTE dotted base module, or an escape/no-package
   * failure (never guessed).
   */
  resolveRelative(
    importingDotted: string,
    importingIsInit: boolean,
    level: number,
    modulePart: string | null,
  ):
    | { kind: "module"; dotted: string }
    | { kind: "escape" }
    | { kind: "no-package" } {
    const pkg = PythonModuleIndex.packageOfDotted(
      importingDotted,
      importingIsInit,
    );
    const pkgParts = pkg === "" ? [] : pkg.split(".");
    // Level 1 = current package; each extra dot climbs one package.
    const climb = level - 1;
    if (climb > pkgParts.length) return { kind: "escape" };
    const baseParts = pkgParts.slice(0, pkgParts.length - climb);
    if (modulePart === null) {
      if (baseParts.length === 0) return { kind: "no-package" };
      return { kind: "module", dotted: baseParts.join(".") };
    }
    const dotted = [...baseParts, modulePart].join(".");
    return { kind: "module", dotted };
  }
}

/**
 * Build the index from repo-relative .py paths.
 *
 * `searchRoots` are repo-relative prefixes in priority order: "" (repo
 * root) first, then "src". A file's dotted name is computed against the
 * LONGEST matching search root; collisions on the same dotted name are
 * resolved by search-root priority (repo root wins), then by path.
 */
export function buildPythonModuleIndex(
  relativePyPaths: string[],
  searchRoots: string[],
): PythonModuleIndex {
  const ranked = searchRoots
    .map((root, rank) => ({ root, rank, prefix: root === "" ? "" : `${root}/` }))
    .sort((a, b) => b.prefix.length - a.prefix.length || a.rank - b.rank);
  const byDotted = new Map<
    string,
    { module: IndexedModule; rank: number }
  >();
  for (const rel of relativePyPaths) {
    const norm = normalizeRelativePath(rel);
    if (!norm.endsWith(".py")) continue;
    // Longest matching search root decides the dotted name.
    const match = ranked.find((r) => norm.startsWith(r.prefix));
    if (match === undefined) continue;
    const under = norm.slice(match.prefix.length);
    const noExt = under.slice(0, -".py".length);
    const parts = noExt.split("/");
    const isInit = parts[parts.length - 1] === "__init__";
    const dottedParts = isInit ? parts.slice(0, -1) : parts;
    // A bare "__init__.py" directly under a search root has no dotted name.
    if (dottedParts.length === 0) continue;
    const module: IndexedModule = {
      relativePath: norm,
      dottedName: dottedParts.join("."),
      isPackageInit: isInit,
    };
    const prev = byDotted.get(module.dottedName);
    if (
      prev === undefined ||
      match.rank < prev.rank ||
      (match.rank === prev.rank && norm < prev.module.relativePath)
    ) {
      byDotted.set(module.dottedName, { module, rank: match.rank });
    }
  }
  // Index constructor is first-wins per dotted name: feed the winners
  // in search-root priority order, then every remaining file (byPath
  // must list EVERY .py file, even a shadowed one — both are real
  // modules in the graph; only the dotted-name lookup has one winner).
  const winners = [...byDotted.values()]
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.module.relativePath < b.module.relativePath
          ? -1
          : a.module.relativePath > b.module.relativePath
            ? 1
            : 0),
    )
    .map((e) => e.module);
  const all: IndexedModule[] = [];
  for (const rel of relativePyPaths) {
    const norm = normalizeRelativePath(rel);
    if (!norm.endsWith(".py")) continue;
    const match = ranked.find((r) => norm.startsWith(r.prefix));
    if (match === undefined) continue;
    const under = norm.slice(match.prefix.length);
    const noExt = under.slice(0, -".py".length);
    const parts = noExt.split("/");
    const isInit = parts[parts.length - 1] === "__init__";
    const dottedParts = isInit ? parts.slice(0, -1) : parts;
    if (dottedParts.length === 0) continue;
    all.push({
      relativePath: norm,
      dottedName: dottedParts.join("."),
      isPackageInit: isInit,
    });
  }
  return new PythonModuleIndex(mergeForIndex(winners, all));
}

/**
 * Merge the dotted-name winners (which decide byDotted) with the full
 * file list (which decides byPath): byPath must list every .py file,
 * byDotted keeps the search-path-priority winner per dotted name.
 */
function mergeForIndex(
  winners: IndexedModule[],
  all: IndexedModule[],
): IndexedModule[] {
  const seen = new Set<string>();
  const out: IndexedModule[] = [];
  for (const m of winners) {
    out.push(m);
    seen.add(m.relativePath);
  }
  for (const m of all) {
    if (!seen.has(m.relativePath)) out.push(m);
  }
  return out;
}
