/**
 * T005 — Build a ground-truth graph from a repo on disk
 * (PROJECT_BOOK §4.1–§4.2, §6.2; PLAN T005).
 *
 * Pipeline (read-only; never writes to the repo, never executes it):
 *   1. Read `.repomapverify.toml` once — the ONLY entrypoint authority.
 *      A malformed file throws (fail loudly, like the Python extractor);
 *      absence means "no declared entrypoints".
 *   2. Run the three frozen extractors (Python / TypeScript / Go) and
 *      collect their modules and core edges. Generated-code edges are
 *      evidence elsewhere, not core edges, so they are not graphed.
 *   3. Resolve every module to its physical file (realpath) so the
 *      identity registry can merge in-repo symlink spellings. Scan the
 *      repo for symlinked source files the extractors never list
 *      (TypeScript/Go skip symlinks) and feed those as alias inputs;
 *      symlinks pointing OUTSIDE the repo are never followed and never
 *      become modules or aliases.
 *   4. Compute the canonical working-tree snapshot hash over every
 *      file under the repo root (excluding .git / node_modules /
 *      __pycache__ / .venv / venv), collapsing in-repo symlink
 *      spellings to their canonical path. On repos without symlinks
 *      this equals the Python extractor's snapshot hash exactly
 *      (same formula, same file set); with symlinks it differs
 *      deliberately — the snapshot is over physical content, and the
 *      alias collapse is recorded in `notes`.
 *   5. Delegate to the pure `buildGraph` for normalization, edge
 *      remapping, entrypoint resolution and BFS reachability.
 *
 * Known boundary (extractor-level, not fixed here — T005 must not
 * modify extractors): a symlinked `.go` FILE inside a package
 * directory is not a package constituent in the Go extractor's view,
 * so it contributes no content to the package hash. Whole-package
 * directory symlinks DO alias correctly. See HANDOFF_T005.md.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  ENTRYPOINTS_TOML_FILENAME,
  parseEntrypointsTomlOptional,
} from "../contracts/entrypoints.js";
import {
  computeContentSha256,
  normalizeRelativePath,
} from "../contracts/module.js";
import { extractPythonRepo } from "../extractors/python/index.js";
import { extractTypeScriptRepo } from "../extractors/typescript/index.js";
import { extractGoRepo } from "../extractors/go/index.js";
import {
  groupByRealPath,
  scanRepoFiles,
  scanRepoFilesDetailed,
  type PlatformCaseAdapter,
} from "../identity/index.js";
import { buildGraph } from "./build.js";
import type {
  BuiltGraph,
  GraphAliasInput,
  GraphEdgeInput,
  GraphModuleInput,
  TypeScriptConfigProblem,
} from "./types.js";

/** Directories the snapshot scan skips (matches the Python extractor). */
const SNAPSHOT_EXCLUDED_DIRS = new Set(["__pycache__", ".venv", "venv"]);

export interface BuildFromRepoOptions {
  caseAdapter?: PlatformCaseAdapter;
}

/** Physical path (realpath) of a repo-relative path, or undefined. */
function tryRealpath(abs: string): string | undefined {
  try {
    return realpathSync(abs);
  } catch {
    return undefined;
  }
}

function languageOfPath(relativePath: string): "python" | "typescript" | "go" | undefined {
  if (relativePath.endsWith(".py")) return "python";
  if (
    relativePath.endsWith(".ts") ||
    relativePath.endsWith(".tsx") ||
    relativePath.endsWith(".mts") ||
    relativePath.endsWith(".cts") ||
    relativePath.endsWith(".js") ||
    relativePath.endsWith(".jsx")
  ) {
    return "typescript";
  }
  if (relativePath.endsWith(".go")) return "go";
  return undefined;
}

/**
 * Canonical snapshot hash: SHA-256 over sorted lines
 * `relativePath + NUL + contentSha256 + "\n"` for every file under the
 * repo root (same formula as the Python extractor's snapshot and the
 * Go package combination hash). Symlink spellings of one physical file
 * collapse to the canonical (smallest) path; unreadable files and
 * unlistable directories contribute a marker line
 * `path + NUL + "UNREADABLE" + "\n"` each (FIX P024 R1 P1-01) so the
 * hash of an incompletely scanned tree can never quietly equal the
 * hash of a tree that genuinely lacks those paths. All lines
 * (content + markers) are sorted together, exactly like the Python
 * extractor's snapshot and the Oracle's snapshot_sha256.
 */
export function computeRepoSnapshotSha256(repoRoot: string): string {
  const { entries, unreadableDirs } = scanRepoFilesDetailed(repoRoot, {
    excludeDirs: SNAPSHOT_EXCLUDED_DIRS,
  });
  const groups = groupByRealPath(entries.filter((e) => e.kind === "file"));
  const lines: string[] = [];
  for (const g of groups) {
    let buf: Buffer;
    try {
      buf = readFileSync(join(repoRoot, g.canonicalPath));
    } catch {
      // FIX P024 R1 P1-01: an unreadable file is UNKNOWN content, not
      // an absent file. Mark it instead of silently skipping it.
      lines.push(`${g.canonicalPath}\0UNREADABLE\n`);
      continue;
    }
    lines.push(`${g.canonicalPath}\0${computeContentSha256(buf)}\n`);
  }
  for (const dir of unreadableDirs) {
    lines.push(`${dir}\0UNREADABLE\n`);
  }
  lines.sort();
  return createHash("sha256").update(lines.join(""), "utf8").digest("hex");
}

export async function buildGroundTruthGraphFromRepo(
  repoRoot: string,
  options: BuildFromRepoOptions = {},
): Promise<BuiltGraph> {
  // 1. Entrypoints: .repomapverify.toml is the ONLY authority.
  let entrypointPaths: string[] = [];
  let entrypointsDeclarationUnreadable = false;
  const tomlAbs = join(repoRoot, ENTRYPOINTS_TOML_FILENAME);
  if (existsSync(tomlAbs)) {
    // FIX P024 R1 P1-01: read and parse are separate steps. An
    // UNREADABLE declaration file means "no declaration" (the same
    // fallback the three extractors already use — the file is still
    // recorded as UNREADABLE by the snapshot marker, so the audit
    // cannot quietly PASS over it). A present-but-MALFORMED file
    // still throws via parseEntrypointsTomlOptional, exactly as
    // before: malformed is a loud failure, never a silent guess.
    //
    // FIX P024 R1 P1-01 follow-up: "no declaration" is NOT the same
    // as "no entrypoints declared". A file that exists but cannot be
    // read leaves the declaration UNKNOWN — the auditor must not
    // audit as if the repo had declared nothing (that path can PASS
    // via ENTRYPOINT_CANDIDATE). The unreadability is recorded on
    // the BuiltGraph so the comparator forces INCOMPLETE with an
    // explicit SOURCE_NOT_ENUMERATED finding for the toml file.
    let tomlText: string | undefined;
    try {
      tomlText = readFileSync(tomlAbs, "utf8");
    } catch {
      tomlText = undefined;
      entrypointsDeclarationUnreadable = true;
    }
    if (tomlText !== undefined) {
      entrypointPaths = parseEntrypointsTomlOptional(tomlText).paths.map(
        (p) => normalizeRelativePath(p),
      );
    }
  }

  // 2. The three extractors (sequential: tree-sitter parsers are
  //    process-global singletons in places; do not parallelize).
  const py = await extractPythonRepo(repoRoot);
  const ts = await extractTypeScriptRepo(repoRoot);
  const go = await extractGoRepo(repoRoot);

  const modules: GraphModuleInput[] = [];
  const modulePaths = new Set<string>();
  for (const m of py.modules) {
    const realPath = tryRealpath(join(repoRoot, m.relativePath));
    modules.push({
      module: m,
      ...(realPath !== undefined ? { realPath } : {}),
    });
    modulePaths.add(`python\0${m.relativePath}`);
  }
  for (const d of ts.modules) {
    const realPath = tryRealpath(join(repoRoot, d.module.relativePath));
    modules.push({
      module: d.module,
      ...(realPath !== undefined ? { realPath } : {}),
    });
    modulePaths.add(`typescript\0${d.module.relativePath}`);
  }
  for (const d of go.packages) {
    const realPath = tryRealpath(join(repoRoot, d.module.relativePath));
    modules.push({
      module: d.module,
      files: d.files.map((f) => ({
        relativePath: f.relativePath,
        contentSha256: f.contentSha256,
      })),
      ...(realPath !== undefined ? { realPath } : {}),
    });
    modulePaths.add(`go\0${d.module.relativePath}`);
  }

  // Edges: Python edges are path-based; TS/Go already carry moduleIds.
  const pyIdByPath = new Map(py.modules.map((m) => [m.relativePath, m.moduleId]));
  const edges: GraphEdgeInput[] = [];
  for (const e of py.edges) {
    const from = pyIdByPath.get(e.from);
    const to = pyIdByPath.get(e.to);
    if (from === undefined || to === undefined) continue;
    edges.push({
      fromModuleId: from,
      toModuleId: to,
      conditional: e.conditional,
      typeOnly: e.typeOnly,
    });
  }
  for (const e of ts.edges) {
    edges.push({
      fromModuleId: e.fromModuleId,
      toModuleId: e.toModuleId,
      typeOnly: e.typeOnly,
    });
  }
  for (const e of go.edges) {
    edges.push({ fromModuleId: e.fromModuleId, toModuleId: e.toModuleId });
  }

  // 3. Symlink aliases the extractors never listed (TS/Go skip
  //    symlinks entirely; Python lists in-repo ones itself). Only
  //    in-repo targets (realPath present) and only paths that are not
  //    already modules.
  const aliases: GraphAliasInput[] = [];
  const scanned = scanRepoFiles(repoRoot, { excludeDirs: SNAPSHOT_EXCLUDED_DIRS });
  for (const entry of scanned) {
    if (entry.kind !== "file") continue;
    if (entry.symlinkClass !== "symlink-inside") continue;
    if (entry.realPath === undefined) continue;
    const language = languageOfPath(entry.relativePath);
    if (language === undefined) continue;
    if (modulePaths.has(`${language}\0${entry.relativePath}`)) continue;
    aliases.push({
      language,
      aliasRelativePath: entry.relativePath,
      realPath: entry.realPath,
    });
  }

  // 4. Canonical snapshot hash.
  const repoSnapshotSha256 = computeRepoSnapshotSha256(repoRoot);

  const externalImportCount =
    py.externalImports.length + ts.externalImportCount + go.externalImportCount;

  // FIX P024 R2 P1-01: the snapshot hash already marks an unreadable
  // config file UNREADABLE, but a hash line is not a state the
  // comparator can act on. Derive the structured problems from the
  // TypeScript extractor's discriminated load statuses and hand them
  // to the builder (which records them on the BuiltGraph, present
  // only when non-empty): a config that exists but could not be read
  // or parsed is UNKNOWN content, not an absent config, and the
  // audit must be INCOMPLETE. The snapshot hash format is untouched
  // (the UNREADABLE marker line stays exactly as the R1 fix wrote
  // it, so the Oracle can still align on it).
  const typescriptConfigProblems: TypeScriptConfigProblem[] = [];
  if (ts.tsconfigStatus === "unreadable" || ts.tsconfigStatus === "malformed") {
    typescriptConfigProblems.push({
      file: "tsconfig.json",
      status: ts.tsconfigStatus === "unreadable" ? "UNREADABLE" : "MALFORMED",
    });
  }
  if (ts.packageJsonStatus === "unreadable" || ts.packageJsonStatus === "malformed") {
    typescriptConfigProblems.push({
      file: "package.json",
      status: ts.packageJsonStatus === "unreadable" ? "UNREADABLE" : "MALFORMED",
    });
  }
  typescriptConfigProblems.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

  // 5. Pure build.
  return buildGraph(
    {
      modules,
      edges,
      entrypointPaths,
      entrypointsDeclarationUnreadable,
      typescriptConfigProblems,
      aliases,
      externalImportCount,
      repoSnapshotSha256,
    },
    { ...(options.caseAdapter !== undefined ? { caseAdapter: options.caseAdapter } : {}) },
  );
}
