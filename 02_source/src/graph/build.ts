/**
 * T005 — Ground-truth graph builder (PROJECT_BOOK §4.1–§4.2, §6.2; PLAN T005).
 *
 * Pure function over extractor output: no filesystem access, no
 * inference. Rules:
 *
 * - Modules are normalized through IdentityRegistry: same physical
 *   file via several in-repo paths merges to one node (alias kept);
 *   same-name different-path modules stay separate nodes.
 * - Edges are re-keyed to canonical module_ids and deduplicated by
 *   the contract edge identity (fromModuleId, toModuleId). Merging two
 *   spellings of one edge keeps the strongest flags (conditional /
 *   typeOnly are AND-ed: an unconditional, runtime spelling wins —
 *   the same rule the Python extractor uses).
 * - Edges whose endpoints are unknown after remapping, and self-edges,
 *   are DROPPED and recorded in `droppedEdges` — never silently kept.
 * - Entrypoints come ONLY from `entrypointPaths` (the
 *   `.repomapverify.toml` declaration). A graph root is never an
 *   entrypoint: in-degree-0 modules are listed separately as
 *   `entrypointCandidates` (informational only). A declared path that
 *   resolves to no module is recorded in `unresolvedEntrypoints`,
 *   never guessed. Go entrypoints are file paths: the node is the
 *   package directory of the file (root files map to ".").
 * - Reachability is BFS over ALL core edges from the declared
 *   entrypoints — conditional and type-only edges traverse, matching
 *   the independent Oracle (oracle.py `_reachability` /
 *   `_reachability_bfs` use every core edge). Python additionally gets
 *   the package-init closure: importing a submodule executes its
 *   ancestor `__init__.py` files, so those count as reachable without
 *   an explicit edge (same rule as the Oracle and the T002 extractor).
 * - `isEntrypoint` on the output modules is RECOMPUTED from the
 *   declaration, overriding whatever the extractors set — the graph is
 *   the single place where "declared entrypoint" is decided.
 */
import { posix } from "node:path";
import { edgeKey } from "../contracts/report.js";
import {
  normalizeRelativePath,
  type GroundTruthEdge,
  type ModuleV1,
} from "../contracts/module.js";
import {
  compareNormalizedPaths,
  IdentityRegistry,
  type ModuleIdentity,
  type PlatformCaseAdapter,
} from "../identity/index.js";
import type {
  BuildGraphInput,
  BuiltGraph,
  DroppedEdge,
} from "./types.js";

export interface BuildGraphOptions {
  caseAdapter?: PlatformCaseAdapter;
}

/**
 * Resolve one declared entrypoint file path to a registry record.
 * Python/TypeScript: the path is the module. Go: the path is a file
 * inside the package directory (root files map to ".").
 */
function resolveEntrypoint(
  registry: IdentityRegistry,
  declaredPath: string,
): ModuleIdentity | undefined {
  const normalized = normalizeRelativePath(declaredPath);
  for (const lang of ["python", "typescript"] as const) {
    const rec = registry.getByPath(lang, normalized);
    if (rec !== undefined) return rec;
  }
  const dir = posix.dirname(normalized);
  const pkgDir = dir === "." ? "." : dir;
  return registry.getByPath("go", pkgDir);
}

export function buildGraph(
  input: BuildGraphInput,
  options: BuildGraphOptions = {},
): BuiltGraph {
  const notes: string[] = [];
  const registry = new IdentityRegistry(options.caseAdapter);

  // Register modules in a deterministic order so a repeated
  // registration with different content resolves the same way
  // regardless of extractor discovery order.
  const sortedInputs = [...input.modules].sort(
    (a, b) =>
      (a.module.language < b.module.language
        ? -1
        : a.module.language > b.module.language
          ? 1
          : 0) ||
      compareNormalizedPaths(
        normalizeRelativePath(a.module.relativePath),
        normalizeRelativePath(b.module.relativePath),
      ) ||
      (a.module.contentSha256 < b.module.contentSha256
        ? -1
        : a.module.contentSha256 > b.module.contentSha256
          ? 1
          : 0),
  );

  // old moduleId -> final canonical record (held by reference: a later
  // merge may re-key the record's moduleId, so read it at use time).
  // `undefined` = the input was conflict-dropped (see registry).
  const resolutions = new Map<string, ModuleIdentity | undefined>();
  for (const m of sortedInputs) {
    const rec = registry.register({
      language: m.module.language,
      relativePath: m.module.relativePath,
      contentSha256: m.module.contentSha256,
      nodeKind: m.module.nodeKind,
      ...(m.files !== undefined ? { files: m.files } : {}),
      ...(m.realPath !== undefined ? { realPath: m.realPath } : {}),
      isGenerated: m.module.isGenerated,
      parseStatus: m.module.parseStatus,
    });
    const dropped =
      m.realPath !== undefined &&
      rec.realPath !== undefined &&
      rec.realPath !== m.realPath;
    resolutions.set(m.module.moduleId, dropped ? undefined : rec);
  }

  // Alias spellings found by a repo scan (symlinks the extractors
  // never listed). They can re-canonicalize a module (smallest path
  // wins), which is why edge remapping reads rec.moduleId lazily.
  let aliasMerges = 0;
  for (const a of input.aliases ?? []) {
    const rec = registry.registerAlias(a.language, a.aliasRelativePath, a.realPath);
    if (rec !== undefined) aliasMerges++;
  }
  if (aliasMerges > 0) {
    notes.push(`${aliasMerges} symlink alias spelling(s) merged into canonical modules`);
  }

  // Recompute entrypoints from the declaration ONLY.
  const declaredEntrypointPaths = input.entrypointPaths.map((p) =>
    normalizeRelativePath(p),
  );
  const declaredEntrypoints: string[] = [];
  const unresolvedEntrypoints: string[] = [];
  const entrypointIds = new Set<string>();
  for (const p of declaredEntrypointPaths) {
    const rec = resolveEntrypoint(registry, p);
    if (rec === undefined) {
      unresolvedEntrypoints.push(p);
      continue;
    }
    if (!entrypointIds.has(rec.moduleId)) {
      entrypointIds.add(rec.moduleId);
      declaredEntrypoints.push(rec.moduleId);
    }
  }
  declaredEntrypoints.sort();
  unresolvedEntrypoints.sort(compareNormalizedPaths);

  // Output modules (isEntrypoint recomputed from the declaration).
  const modules = new Map<string, ModuleV1>();
  for (const rec of registry.all()) {
    modules.set(rec.moduleId, {
      moduleId: rec.moduleId,
      language: rec.language,
      nodeKind: rec.nodeKind,
      relativePath: rec.relativePath,
      contentSha256: rec.contentSha256,
      isGenerated: rec.isGenerated ?? false,
      isEntrypoint: entrypointIds.has(rec.moduleId),
      parseStatus: rec.parseStatus ?? "OK",
      evidenceLevel: "STATIC_RULE",
    });
  }

  // Edges: remap to canonical ids, drop the unmappable, dedupe by pair.
  const edges = new Map<string, GroundTruthEdge>();
  const droppedEdges: DroppedEdge[] = [];
  const resolveId = (oldId: string): string | undefined => {
    const rec = resolutions.get(oldId);
    return rec === undefined ? undefined : rec.moduleId;
  };
  for (const e of input.edges) {
    const from = resolveId(e.fromModuleId);
    const to = resolveId(e.toModuleId);
    if (from === undefined || to === undefined) {
      const conflictDropped = (oldId: string): boolean =>
        resolutions.has(oldId) && resolutions.get(oldId) === undefined;
      droppedEdges.push({
        fromModuleId: e.fromModuleId,
        toModuleId: e.toModuleId,
        reason:
          conflictDropped(e.fromModuleId) || conflictDropped(e.toModuleId)
            ? "CONFLICT_DROPPED_ENDPOINT"
            : "UNKNOWN_ENDPOINT",
      });
      continue;
    }
    if (from === to) {
      droppedEdges.push({ fromModuleId: e.fromModuleId, toModuleId: e.toModuleId, reason: "SELF_EDGE" });
      continue;
    }
    const key = edgeKey(from, to);
    const prev = edges.get(key);
    if (prev === undefined) {
      edges.set(key, {
        fromModuleId: from,
        toModuleId: to,
        ...(e.conditional !== undefined ? { conditional: e.conditional } : {}),
        ...(e.typeOnly !== undefined ? { typeOnly: e.typeOnly } : {}),
      });
    } else {
      // Same pair twice: keep the strongest flags (unconditional,
      // runtime spelling wins) — the Python extractor's merge rule.
      edges.set(key, {
        fromModuleId: from,
        toModuleId: to,
        ...(prev.conditional !== undefined || e.conditional !== undefined
          ? { conditional: (prev.conditional ?? false) && (e.conditional ?? false) }
          : {}),
        ...(prev.typeOnly !== undefined || e.typeOnly !== undefined
          ? { typeOnly: (prev.typeOnly ?? false) && (e.typeOnly ?? false) }
          : {}),
      });
    }
  }
  droppedEdges.sort((a, b) =>
    a.fromModuleId < b.fromModuleId
      ? -1
      : a.fromModuleId > b.fromModuleId
        ? 1
        : a.toModuleId < b.toModuleId
          ? -1
          : a.toModuleId > b.toModuleId
            ? 1
            : 0,
  );

  // Reachability: BFS over all core edges from declared entrypoints.
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const id of modules.keys()) inDegree.set(id, 0);
  for (const e of edges.values()) {
    const list = adjacency.get(e.fromModuleId) ?? [];
    list.push(e.toModuleId);
    adjacency.set(e.fromModuleId, list);
    inDegree.set(e.toModuleId, (inDegree.get(e.toModuleId) ?? 0) + 1);
  }
  const reachable = new Set<string>();
  const queue: string[] = [...declaredEntrypoints];
  for (const id of queue) reachable.add(id);
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const next of adjacency.get(cur) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  // Python package-init closure (Oracle rule): a reachable submodule
  // makes its ancestor __init__.py files reachable too. Every
  // spelling of the module counts (canonical path AND aliases): a
  // module reached via a symlinked spelling still executes the
  // __init__.py files of its real package directory.
  const spellingsById = new Map<string, string[]>();
  for (const rec of registry.all()) {
    spellingsById.set(rec.moduleId, [rec.relativePath, ...rec.aliases]);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...reachable]) {
      const mod = modules.get(id);
      if (mod === undefined || mod.language !== "python") continue;
      for (const spelling of spellingsById.get(id) ?? [mod.relativePath]) {
        const parts = spelling.split("/");
        for (let i = 1; i < parts.length; i++) {
          const init = [...parts.slice(0, i), "__init__.py"].join("/");
          const initRec = registry.getByPath("python", init);
          if (initRec !== undefined && !reachable.has(initRec.moduleId)) {
            reachable.add(initRec.moduleId);
            changed = true;
          }
        }
      }
    }
  }

  const isolatedModuleIds = new Set<string>();
  for (const id of modules.keys()) {
    if (!reachable.has(id)) isolatedModuleIds.add(id);
  }

  // Entrypoint candidates: in-degree 0. INFORMATIONAL ONLY.
  const entrypointCandidates = [...modules.values()]
    .filter((m) => (inDegree.get(m.moduleId) ?? 0) === 0)
    .map((m) => m.relativePath)
    .sort(compareNormalizedPaths);

  const aliases = new Map<string, string[]>();
  for (const rec of registry.all()) {
    if (rec.aliases.length > 0) aliases.set(rec.moduleId, [...rec.aliases]);
  }

  if (input.repoSnapshotSha256 === undefined) {
    notes.push("no repo snapshot hash supplied with the extractor input");
  }

  return {
    graph: {
      modules,
      edges,
      reachableFromEntrypoints: reachable,
      isolatedModuleIds,
      externalImportCount: input.externalImportCount ?? 0,
      repoSnapshotSha256: input.repoSnapshotSha256 ?? "",
      ...(input.gitCommit !== undefined ? { gitCommit: input.gitCommit } : {}),
    },
    declaredEntrypoints,
    declaredEntrypointPaths,
    unresolvedEntrypoints,
    // FIX P024 R1 P1-01 follow-up: record an unreadable entrypoint
    // declaration ONLY when true, so existing deep-equality on built
    // graphs (and every readable/absent-toml repo) is unchanged.
    ...(input.entrypointsDeclarationUnreadable
      ? { entrypointsDeclarationUnreadable: true as const }
      : {}),
    // FIX P024 R2 P1-01: record unreadable / malformed TypeScript
    // resolution configs ONLY when non-empty, so existing
    // deep-equality on built graphs (and every readable/absent
    // config repo) is unchanged. Sorted by file for determinism.
    ...(input.typescriptConfigProblems !== undefined &&
    input.typescriptConfigProblems.length > 0
      ? {
          typescriptConfigProblems: [...input.typescriptConfigProblems].sort(
            (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
          ),
        }
      : {}),
    entrypointCandidates,
    aliases,
    duplicateContent: registry.findDuplicateContent(),
    conflicts: registry.conflicts(),
    droppedEdges,
    notes,
  };
}

/** Convenience: module paths of a built graph, sorted (NFC-first). */
export function sortedModulePaths(built: BuiltGraph): string[] {
  return [...built.graph.modules.values()]
    .map((m) => m.relativePath)
    .sort(compareNormalizedPaths);
}

/** Convenience: reachable / isolated module paths, sorted. */
export function reachabilityPaths(built: BuiltGraph): {
  reachable: string[];
  isolated: string[];
} {
  const pathOf = (id: string): string =>
    built.graph.modules.get(id)?.relativePath ?? id;
  return {
    reachable: [...built.graph.reachableFromEntrypoints].map(pathOf).sort(compareNormalizedPaths),
    isolated: [...built.graph.isolatedModuleIds].map(pathOf).sort(compareNormalizedPaths),
  };
}
