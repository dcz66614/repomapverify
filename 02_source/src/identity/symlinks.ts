/**
 * T005 — Symlink classification and repo scanning
 * (PROJECT_BOOK §0.3, §4.2 rule 3; IMPLEMENTATION_PLAN T005).
 *
 * Rules frozen here:
 * - A symlink whose target resolves INSIDE the repo is followed for
 *   identity purposes: every in-repo path reaching the same physical
 *   file is an alias of ONE module (see IdentityRegistry).
 * - A symlink whose target resolves OUTSIDE the repo is NEVER followed:
 *   the link itself is not a module, its target is not scanned, and no
 *   alias is recorded for it.
 * - A broken symlink (target does not exist) is never followed and is
 *   reported as "symlink-broken", not silently dropped.
 * - Directory symlinks are classified but never descended into: the
 *   files are already reachable via the target directory's real path,
 *   and descending again would double-enumerate them. (The Python
 *   extractor descends in-repo dir symlinks itself; the graph builder
 *   merges those duplicates by physical key, so the two views agree.)
 * - `.git` and `node_modules` are never scanned (read-only boundary).
 */
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { normalizeRelativePath } from "../contracts/module.js";
import { DEFAULT_EXCLUDED_DIRS } from "../contracts/frozen-scope.js";
import { compareNormalizedPaths } from "./normalize.js";

/** Classification of one repo-relative path. */
export type SymlinkClass =
  | "regular"
  | "symlink-inside"
  | "symlink-outside"
  | "symlink-broken"
  | "symlink-dir-inside"
  | "symlink-dir-outside"
  | "symlink-dir-broken";

export interface ScannedEntry {
  /** Repo-relative POSIX path (normalized). */
  relativePath: string;
  /** "file" for regular files and file symlinks; "directory" otherwise. */
  kind: "file" | "directory";
  symlinkClass: SymlinkClass;
  /**
   * Canonical physical path (realpath) when the entry resolves to
   * something inside the repo; undefined for outside/broken links.
   * Two entries with the same realPath are the same physical file.
   */
  realPath?: string;
}

/** Extra directories to skip while scanning (in addition to the frozen set). */
export interface ScanOptions {
  excludeDirs?: ReadonlySet<string>;
}

/**
 * Classify one path (already repo-relative) without following it
 * blindly: lstat first, realpath only for symlinks.
 */
export function classifyRepoPath(
  repoRoot: string,
  relativePath: string,
): SymlinkClass {
  const abs = join(repoRoot, relativePath);
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    return "symlink-broken";
  }
  if (!st.isSymbolicLink()) return "regular";
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    return "symlink-broken";
  }
  let rootReal: string;
  try {
    rootReal = realpathSync(repoRoot);
  } catch {
    return "symlink-broken";
  }
  const inside = real === rootReal || real.startsWith(rootReal + sep);
  let isDir = false;
  try {
    isDir = lstatSync(real).isDirectory();
  } catch {
    return "symlink-broken";
  }
  if (!inside) return isDir ? "symlink-dir-outside" : "symlink-outside";
  return isDir ? "symlink-dir-inside" : "symlink-inside";
}

/**
 * Resolve a repo-relative path to its physical (realpath) location.
 * Returns undefined when the path does not exist, is broken, or
 * resolves outside the repo. Never throws for missing/broken links.
 */
export function resolveRealPathInsideRepo(
  repoRoot: string,
  relativePath: string,
): string | undefined {
  const abs = join(repoRoot, relativePath);
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    return undefined;
  }
  let rootReal: string;
  try {
    rootReal = realpathSync(repoRoot);
  } catch {
    return undefined;
  }
  if (real !== rootReal && !real.startsWith(rootReal + sep)) return undefined;
  return real;
}

/** Result of a detailed repo scan: entries plus the directories that
 * could not be listed at all. */
export interface ScanRepoFilesResult {
  entries: ScannedEntry[];
  /**
   * Repo-relative paths of directories whose listing failed (e.g.
   * unreadable, EACCES), sorted. The contents of these directories
   * are UNKNOWN — they must never be treated as "no files here"
   * (PROJECT_BOOK §5.1 "跳过项转 finding"). The repo root itself is
   * reported as "." when it cannot be listed.
   */
  unreadableDirs: string[];
}

/** Recursively scan a repo tree (read-only). Never follows dir symlinks. */
export function scanRepoFiles(
  repoRoot: string,
  options: ScanOptions = {},
): ScannedEntry[] {
  return scanRepoFilesDetailed(repoRoot, options).entries;
}

/**
 * Recursively scan a repo tree (read-only) and report the directories
 * that could not be listed. Never follows dir symlinks.
 *
 * FIX P024 R1 P1-01: the old scanRepoFiles silently returned on a
 * readdir failure, so an unreadable subdirectory (and everything in
 * it) vanished without a trace and the audit could PASS over an
 * incomplete tree. The failure is now recorded in `unreadableDirs`
 * so the snapshot hash and the comparators can fail closed on it.
 */
export function scanRepoFilesDetailed(
  repoRoot: string,
  options: ScanOptions = {},
): ScanRepoFilesResult {
  const excluded = new Set<string>(DEFAULT_EXCLUDED_DIRS);
  for (const d of options.excludeDirs ?? []) excluded.add(d);
  const out: ScannedEntry[] = [];
  const unreadableDirs: string[] = [];
  const walk = (dirAbs: string): void => {
    let entries;
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      // FIX P024 R1 P1-01: a directory that cannot be listed is
      // UNKNOWN content, not an empty directory. Record it (repo-
      // relative; the root itself is ".") instead of silently
      // returning as if nothing were there.
      const rel = normalizeRelativePath(relative(repoRoot, dirAbs));
      unreadableDirs.push(rel === "" ? "." : rel);
      return;
    }
    entries.sort((a, b) => compareNormalizedPaths(a.name, b.name));
    for (const entry of entries) {
      const abs = join(dirAbs, entry.name);
      const rel = normalizeRelativePath(relative(repoRoot, abs));
      if (entry.isDirectory()) {
        if (excluded.has(entry.name)) continue;
        out.push({ relativePath: rel, kind: "directory", symlinkClass: "regular" });
        walk(abs);
      } else if (entry.isSymbolicLink()) {
        const cls = classifyRepoPath(repoRoot, rel);
        const real =
          cls === "symlink-inside" || cls === "symlink-dir-inside"
            ? resolveRealPathInsideRepo(repoRoot, rel)
            : undefined;
        // A symlink to a directory is recorded, never descended into.
        const isDir =
          cls === "symlink-dir-inside" ||
          cls === "symlink-dir-outside" ||
          cls === "symlink-dir-broken";
        out.push({
          relativePath: rel,
          kind: isDir ? "directory" : "file",
          symlinkClass: cls,
          ...(real !== undefined ? { realPath: real } : {}),
        });
      } else if (entry.isFile()) {
        let real: string | undefined;
        try {
          real = realpathSync(abs);
        } catch {
          real = undefined;
        }
        out.push({
          relativePath: rel,
          kind: "file",
          symlinkClass: "regular",
          ...(real !== undefined ? { realPath: real } : {}),
        });
      }
      // Anything else (sockets, fifos, devices) is not a module: skipped.
    }
  };
  walk(repoRoot);
  out.sort((a, b) => compareNormalizedPaths(a.relativePath, b.relativePath));
  unreadableDirs.sort(compareNormalizedPaths);
  return { entries: out, unreadableDirs };
}

/**
 * Group scanned file entries by physical file. Each group is one
 * physical file reached via one or more in-repo paths; the canonical
 * path is the smallest normalized path in the group (deterministic,
 * independent of discovery order). Outside/broken links have no
 * realPath and never appear in a group.
 */
export function groupByRealPath(
  entries: ReadonlyArray<ScannedEntry>,
): Array<{ realPath: string; canonicalPath: string; paths: string[] }> {
  const byReal = new Map<string, string[]>();
  for (const e of entries) {
    if (e.kind !== "file" || e.realPath === undefined) continue;
    const list = byReal.get(e.realPath) ?? [];
    list.push(e.relativePath);
    byReal.set(e.realPath, list);
  }
  const groups: Array<{ realPath: string; canonicalPath: string; paths: string[] }> = [];
  for (const [realPath, paths] of [...byReal.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    const sorted = [...paths].sort(compareNormalizedPaths);
    groups.push({
      realPath,
      canonicalPath: sorted[0] as string,
      paths: sorted,
    });
  }
  return groups;
}
