/**
 * Python import-extraction orchestrator (T002; PROJECT_BOOK §4.3).
 *
 * Pipeline per repo:
 *   1. Enumerate .py files (skip .git / node_modules / __pycache__ / .venv / venv;
 *      never follow a symlink out of the repo; never execute repo code).
 *   2. Build the frozen-scope module index (repo root + src/, __init__.py
 *      package boundary).
 *   3. Parse each file with tree-sitter-python; extract import statements
 *      and dynamic-import call sites.
 *   4. Resolve every import against the index:
 *      - repo module found          => edge (with line + statement evidence)
 *      - top-level name repo-local
 *        but deeper path missing    => UNKNOWN (UNRESOLVABLE_REPO_LOCAL)
 *      - top-level name not in repo => EXTERNAL (stdlib / third-party count)
 *      - relative import escaping
 *        the package tree           => UNKNOWN (RELATIVE_ESCAPE)
 *      - `from a.b import c`        => sub-module edge ONLY when a.b.c is
 *        a real module file (else `c` is an attribute: no edge)
 *      - dynamic import, literal    => resolved like a static import
 *      - dynamic import, variable   => DYNAMIC_IMPORT_UNKNOWN (INCOMPLETE)
 *   5. Reachability from the .repomapverify.toml entrypoints, plus the
 *      package-init closure: importing a submodule executes its ancestor
 *      __init__.py files, so those are reachable too.
 *
 * Out-of-scope resolution is UNKNOWN, never guessed. Generated-code
 * modules are still listed as nodes, but edges touching them are kept
 * out of the core edge set (generatedExcludedEdges) per spec §4.3.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import {
  computeContentSha256,
  computeModuleId,
  normalizeRelativePath,
  type ModuleV1,
} from "../../contracts/module.js";
import {
  ENTRYPOINTS_TOML_FILENAME,
  parseEntrypointsTomlOptional,
} from "../../contracts/entrypoints.js";
import { GENERATED_MARKERS } from "../../contracts/frozen-scope.js";
import { getPythonParser, parsePython } from "./parser.js";
import { extractStatements } from "./extract.js";
import { buildPythonModuleIndex, type PythonModuleIndex } from "./resolve.js";
import type {
  DynamicUnknown,
  ExternalImport,
  PythonEdge,
  PythonExtractionResult,
  UnknownImport,
} from "./types.js";
import { PYTHON_MAX_FILE_BYTES } from "./types.js";

/** Directories never scanned (PROJECT_BOOK §0.3 read-only boundary). */
const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
]);

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function isGenerated(content: string): boolean {
  const head = content.slice(0, 2048);
  return GENERATED_MARKERS.some((m) => head.includes(m));
}

/**
 * Canonical working-tree snapshot hash (PoC algorithm, T002 — see
 * types.ts). Deterministic over (relativePath, contentSha256) pairs.
 *
 * FIX P024 R1 P1-01: `unreadablePaths` (files that could not be read
 * and directories that could not be listed) contribute a marker line
 * `path + NUL + "UNREADABLE" + "\n"` each, so the hash of a tree
 * scanned incompletely can never quietly equal the hash of a tree
 * that genuinely lacks those paths. The Oracle's snapshot_sha256
 * uses the identical marker format. On a fully readable tree the
 * list is empty and the hash is unchanged.
 */
export function computeRepoSnapshotSha256(
  files: ReadonlyArray<{ relativePath: string; contentSha256: string }>,
  unreadablePaths: ReadonlyArray<string> = [],
): string {
  const lines = files.map((f) => `${f.relativePath}\0${f.contentSha256}\n`);
  for (const p of unreadablePaths) lines.push(`${p}\0UNREADABLE\n`);
  // All lines (content + markers) are sorted together, exactly like
  // the Oracle's snapshot_sha256 and the graph snapshot: the marker
  // for an unreadable path sorts in with the content lines, so the
  // three snapshot computations agree line-for-line.
  lines.sort();
  return sha256Hex(lines.join(""));
}

/** Recursively list files under `dir`, repo-relative POSIX paths. */
function listFilesRecursive(
  repoRoot: string,
  dirAbs: string,
  out: string[],
  unreadableDirs: string[],
): void {
  let entries;
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    // FIX P024 R1 P1-01: a directory that cannot be listed is UNKNOWN
    // content, not an empty directory. Record it ("" is the repo
    // root) instead of silently returning as if nothing were there.
    const rel = normalizeRelativePath(relative(repoRoot, dirAbs));
    unreadableDirs.push(rel === "" ? "." : rel);
    return;
  }
  for (const entry of entries) {
    const abs = join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      // Never follow a directory symlink out of the repo.
      if (entry.isSymbolicLink()) {
        try {
          const real = realpathSync(abs);
          if (!real.startsWith(realpathSync(repoRoot) + sep) && real !== realpathSync(repoRoot)) continue;
        } catch {
          continue;
        }
      }
      listFilesRecursive(repoRoot, abs, out, unreadableDirs);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      // A symlinked file is followed only when it stays inside the repo.
      if (entry.isSymbolicLink()) {
        try {
          const real = realpathSync(abs);
          const rootReal = realpathSync(repoRoot);
          if (real !== rootReal && !real.startsWith(rootReal + sep)) continue;
        } catch {
          continue;
        }
      }
      out.push(
        normalizeRelativePath(relative(repoRoot, abs)),
      );
    }
  }
}

/** Read a file as bytes; undefined when unreadable. */
function readIfPossible(abs: string): Buffer | undefined {
  try {
    return readFileSync(abs);
  } catch {
    return undefined;
  }
}

export async function extractPythonRepo(
  repoRoot: string,
): Promise<PythonExtractionResult> {
  const rootAbs = repoRoot;
  const allFiles: string[] = [];
  // FIX P024 R1 P1-01: directories that could not be listed. Their
  // contents are UNKNOWN (possibly .py files); they are reported as
  // UNREADABLE unknowns below and marked in the snapshot, never
  // treated as empty.
  const unreadableDirs: string[] = [];
  listFilesRecursive(rootAbs, rootAbs, allFiles, unreadableDirs);
  allFiles.sort();

  const pyFiles = allFiles.filter((p) => p.endsWith(".py"));

  // Search paths: repo root + src/ when present (frozen scope).
  const searchRoots = existsSync(join(rootAbs, "src")) &&
    lstatSync(join(rootAbs, "src")).isDirectory()
    ? ["", "src"]
    : [""];
  const index: PythonModuleIndex = buildPythonModuleIndex(pyFiles, searchRoots);

  // Entrypoints: .repomapverify.toml is the ONLY authority (spec §6.5).
  let entrypoints: string[] = [];
  const tomlAbs = join(rootAbs, ENTRYPOINTS_TOML_FILENAME);
  if (existsSync(tomlAbs)) {
    const text = readIfPossible(tomlAbs)?.toString("utf8");
    entrypoints = parseEntrypointsTomlOptional(text).paths.map((p) =>
      normalizeRelativePath(p),
    );
  }
  const entrySet = new Set(entrypoints);

  // Snapshot over every file in the tree (PoC algorithm).
  const snapshotFiles: { relativePath: string; contentSha256: string }[] = [];
  const contents = new Map<string, Buffer>();
  for (const rel of allFiles) {
    const buf = readIfPossible(join(rootAbs, rel));
    if (buf === undefined) continue;
    contents.set(rel, buf);
    snapshotFiles.push({
      relativePath: rel,
      contentSha256: computeContentSha256(buf),
    });
  }
  // FIX P024 R1 P1-01: files that could not be read (present in
  // allFiles but absent from contents) and directories that could
  // not be listed are marked UNREADABLE in the snapshot hash, so an
  // incompletely scanned tree can never hash like a clean tree.
  const unreadableFiles = allFiles.filter((rel) => !contents.has(rel));
  const repoSnapshotSha256 = computeRepoSnapshotSha256(snapshotFiles, [
    ...unreadableFiles,
    ...unreadableDirs,
  ]);

  // Modules.
  const modules: ModuleV1[] = [];
  const generatedPaths = new Set<string>();
  for (const indexed of index.allModules()) {
    const rel = indexed.relativePath;
    const buf = contents.get(rel);
    if (buf === undefined) {
      modules.push({
        moduleId: computeModuleId("python", rel),
        language: "python",
        nodeKind: "module",
        relativePath: rel,
        contentSha256: "",
        isGenerated: false,
        isEntrypoint: entrySet.has(rel),
        parseStatus: "UNREADABLE",
        evidenceLevel: "STATIC_RULE",
      });
      continue;
    }
    const text = buf.toString("utf8");
    const gen = isGenerated(text);
    if (gen) generatedPaths.add(rel);
    modules.push({
      moduleId: computeModuleId("python", rel),
      language: "python",
      nodeKind: "module",
      relativePath: rel,
      contentSha256: computeContentSha256(buf),
      isGenerated: gen,
      isEntrypoint: entrySet.has(rel),
      parseStatus:
        buf.length > PYTHON_MAX_FILE_BYTES ? "TOO_LARGE" : "OK",
      evidenceLevel: "STATIC_RULE",
    });
  }

  // Parse + resolve.
  const edgesByKey = new Map<string, PythonEdge>();
  const generatedExcludedEdges: PythonEdge[] = [];
  const unknownByKey = new Map<string, UnknownImport>();
  const dynamicByKey = new Map<string, DynamicUnknown>();
  const externalImports: ExternalImport[] = [];

  function addEdge(edge: PythonEdge): void {
    const key = `${edge.from}\0${edge.to}`;
    const prev = edgesByKey.get(key);
    if (prev === undefined) {
      if (generatedPaths.has(edge.from) || generatedPaths.has(edge.to)) {
        generatedExcludedEdges.push(edge);
        return;
      }
      edgesByKey.set(key, edge);
      return;
    }
    // Same edge twice: keep the strongest (unconditional, non-type-only)
    // evidence and the earliest line.
    const merged: PythonEdge = {
      from: prev.from,
      to: prev.to,
      conditional: prev.conditional && edge.conditional,
      typeOnly: prev.typeOnly && edge.typeOnly,
      evidence:
        edge.evidence.line < prev.evidence.line ? edge.evidence : prev.evidence,
    };
    edgesByKey.set(key, merged);
  }

  function addUnknown(u: UnknownImport): void {
    const key = `${u.from}\0${u.specifier}`;
    if (!unknownByKey.has(key)) unknownByKey.set(key, u);
  }

  // FIX P024 R1 P1-01: directories that could not be listed hold
  // UNKNOWN content (possibly .py files). Each becomes an UNREADABLE
  // unknown: the comparator turns it into a SOURCE_NOT_ENUMERATED
  // finding and forces INCOMPLETE (spec §5.1), and the Oracle mirrors
  // the identical entry (same from/specifier/reason/line/statement),
  // so the two verdicts agree.
  for (const dir of unreadableDirs) {
    addUnknown({
      from: dir,
      specifier: "",
      reason: "UNREADABLE",
      line: 1,
      statement: `directory "${dir}" could not be listed; its contents are unknown`,
    });
  }

  function addDynamic(d: DynamicUnknown): void {
    const key = `${d.path}\0${d.line}\0${d.kind}`;
    if (!dynamicByKey.has(key)) dynamicByKey.set(key, d);
  }

  /** Classify an unresolvable absolute dotted name. */
  function classifyUnresolved(
    from: string,
    dotted: string,
    line: number,
    statement: string,
    conditional: boolean,
  ): void {
    const top = dotted.split(".")[0] as string;
    if (index.hasTopLevel(top)) {
      addUnknown({
        from,
        specifier: dotted,
        reason: "UNRESOLVABLE_REPO_LOCAL",
        line,
        statement,
      });
    } else {
      externalImports.push({
        from,
        specifier: dotted,
        line,
        conditional,
      });
    }
  }

  const parser = await getPythonParser();

  for (const mod of modules) {
    if (mod.parseStatus !== "OK") continue; // UNREADABLE / TOO_LARGE: no edges, finding downstream
    const rel = mod.relativePath;
    const buf = contents.get(rel);
    if (buf === undefined) continue;
    const text = buf.toString("utf8");
    const { tree } = await parsePython(text, parser);
    try {
      const indexed = index.byRelativePath(rel);
      if (indexed === undefined) continue;
      if (tree.rootNode.hasError) {
        mod.parseStatus = "PARSE_ERROR";
        continue;
      }
      const { imports, dynamics } = extractStatements(tree.rootNode);

      for (const st of imports) {
        if (st.kind === "import") {
          const res = index.resolveDotted(st.dotted);
          if (res.kind === "module") {
            if (res.module.relativePath !== rel) {
              addEdge({
                from: rel,
                to: res.module.relativePath,
                conditional: st.conditional,
                typeOnly: st.typeOnly,
                evidence: { line: st.line, statement: st.statement },
              });
            }
          } else {
            classifyUnresolved(rel, st.dotted, st.line, st.statement, st.conditional);
          }
          continue;
        }
        // from-import: resolve the base module first.
        let baseDotted: string | null = null;
        if (st.baseDotted !== null) {
          baseDotted = st.baseDotted;
        } else {
          const r = index.resolveRelative(
            indexed.dottedName,
            indexed.isPackageInit,
            st.level,
            st.relativePart,
          );
          if (r.kind === "module") {
            baseDotted = r.dotted;
          } else {
            addUnknown({
              from: rel,
              specifier:
                ".".repeat(st.level) + (st.relativePart ?? ""),
              reason:
                r.kind === "escape" ? "RELATIVE_ESCAPE" : "RELATIVE_NO_PACKAGE",
              line: st.line,
              statement: st.statement,
            });
            continue;
          }
        }
        const base = index.resolveDotted(baseDotted);
        if (base.kind === "not-found") {
          classifyUnresolved(rel, baseDotted, st.line, st.statement, st.conditional);
          continue;
        }
        const baseModule = base.module;
        if (baseModule.relativePath !== rel) {
          addEdge({
            from: rel,
            to: baseModule.relativePath,
            conditional: st.conditional,
            typeOnly: st.typeOnly,
            evidence: { line: st.line, statement: st.statement },
          });
        }
        if (st.wildcard) continue;
        // from a.b import c: sub-module edge ONLY when a.b.c is a module
        // file AND a.b is a package (base is its __init__.py).
        if (!baseModule.isPackageInit) continue;
        for (const name of st.names) {
          const sub = index.resolveDotted(`${baseDotted}.${name}`);
          if (sub.kind === "module" && sub.module.relativePath !== rel) {
            addEdge({
              from: rel,
              to: sub.module.relativePath,
              conditional: st.conditional,
              typeOnly: st.typeOnly,
              evidence: { line: st.line, statement: st.statement },
            });
          }
          // Otherwise `name` is an attribute of the base module: no edge.
        }
      }

      for (const dyn of dynamics) {
        if (dyn.callee === "exec" || dyn.callee === "eval") {
          addDynamic({
            path: rel,
            line: dyn.line,
            statement: dyn.statement,
            kind: "EXEC_EVAL_IMPORT",
          });
          continue;
        }
        if (dyn.literalArg === undefined) {
          addDynamic({
            path: rel,
            line: dyn.line,
            statement: dyn.statement,
            kind:
              dyn.callee === "importlib"
                ? "IMPORTLIB_VARIABLE"
                : "DUNDER_IMPORT_VARIABLE",
          });
          continue;
        }
        // Literal dynamic target: resolved exactly like a static import.
        const res = index.resolveDotted(dyn.literalArg);
        if (res.kind === "module") {
          if (res.module.relativePath !== rel) {
            addEdge({
              from: rel,
              to: res.module.relativePath,
              conditional: dyn.conditional,
              typeOnly: dyn.typeOnly,
              evidence: { line: dyn.line, statement: dyn.statement },
            });
          }
        } else {
          classifyUnresolved(
            rel,
            dyn.literalArg,
            dyn.line,
            dyn.statement,
            dyn.conditional,
          );
        }
      }
    } finally {
      tree.delete();
    }
  }

  const edges = [...edgesByKey.values()].sort((a, b) =>
    a.from < b.from
      ? -1
      : a.from > b.from
        ? 1
        : a.to < b.to
          ? -1
          : a.to > b.to
            ? 1
            : 0,
  );
  generatedExcludedEdges.sort((a, b) =>
    a.from < b.from
      ? -1
      : a.from > b.from
        ? 1
        : a.to < b.to
          ? -1
          : a.to > b.to
            ? 1
            : 0,
  );
  const unknownImports = [...unknownByKey.values()].sort((a, b) =>
    a.from < b.from
      ? -1
      : a.from > b.from
        ? 1
        : a.specifier < b.specifier
          ? -1
          : a.specifier > b.specifier
            ? 1
            : 0,
  );
  const dynamicUnknown = [...dynamicByKey.values()].sort((a, b) =>
    a.path < b.path
      ? -1
      : a.path > b.path
        ? 1
        : a.line - b.line,
  );
  externalImports.sort((a, b) =>
    a.from < b.from
      ? -1
      : a.from > b.from
        ? 1
        : a.specifier < b.specifier
          ? -1
          : a.specifier > b.specifier
            ? 1
            : a.line - b.line,
  );

  // Reachability: BFS from declared entrypoints over the core edges,
  // plus the package-init closure (importing a submodule executes its
  // ancestor __init__.py files).
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const list = adjacency.get(e.from) ?? [];
    list.push(e.to);
    adjacency.set(e.from, list);
  }
  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const ep of entrypoints) {
    if (index.byRelativePath(ep) !== undefined && !reachable.has(ep)) {
      reachable.add(ep);
      queue.push(ep);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const next of adjacency.get(cur) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  // Ancestor __init__.py closure (fixpoint: adding an __init__ may add
  // its own ancestors).
  let changed = true;
  while (changed) {
    changed = false;
    for (const rel of [...reachable]) {
      const parts = rel.split("/");
      for (let i = 1; i < parts.length; i++) {
        const init = [...parts.slice(0, i), "__init__.py"].join("/");
        if (index.byRelativePath(init) !== undefined && !reachable.has(init)) {
          reachable.add(init);
          changed = true;
        }
      }
    }
  }
  const reachableFromEntrypoints = [...reachable].sort();
  const isolatedModules = modules
    .map((m) => m.relativePath)
    .filter((p) => !reachable.has(p))
    .sort();

  return {
    modules,
    edges,
    unknownImports,
    dynamicUnknown,
    externalImports,
    generatedExcludedEdges,
    entrypoints,
    reachableFromEntrypoints,
    isolatedModules,
    repoSnapshotSha256,
  };
}
