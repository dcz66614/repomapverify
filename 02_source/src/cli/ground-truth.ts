/**
 * T009 — `ground-truth` command (PROJECT_BOOK §6.4; PLAN T009).
 *
 * Prints ONLY the ground-truth JSON (schema
 * `repomapverify.ground-truth/v1`) to stdout — for debugging and
 * Oracle comparison. Nothing else goes to stdout; errors go to
 * stderr with exit code 3. `--lang` filters the graph to one
 * language (modules, edges, reachable / isolated sets,
 * entrypoints and duplicate-content groups); the external-import
 * count stays repo-wide because the built graph does not split it
 * per language.
 */
import { canonicalizeGraph, type CanonicalGraph } from "../canonical/index.js";
import { buildGroundTruthGraphFromRepo } from "../graph/fromRepo.js";
import { UsageError, type GroundTruthOptions } from "./parse.js";
import { DEFAULT_WRITERS, type Writers } from "./audit.js";
import { resolve } from "node:path";
import { statSync } from "node:fs";

/** Filter a canonical graph to one language (empty = no filter). */
export function filterCanonicalGraphByLang(
  graph: CanonicalGraph,
  lang: string,
): CanonicalGraph {
  const modules = graph.modules.filter((m) => m.language === lang);
  const keepIds = new Set(modules.map((m) => m.moduleId));
  const keepPaths = new Set(modules.map((m) => m.relativePath));
  const edges = graph.edges.filter(
    (e) => keepIds.has(e.fromModuleId) && keepIds.has(e.toModuleId),
  );
  const inSet = (xs: string[]): string[] => xs.filter((p) => keepPaths.has(p));
  return {
    ...graph,
    modules,
    edges,
    entrypoints: inSet(graph.entrypoints),
    reachableFromEntrypoints: inSet(graph.reachableFromEntrypoints),
    isolatedModules: inSet(graph.isolatedModules),
    entrypointCandidates: inSet(graph.entrypointCandidates),
    duplicateContent: graph.duplicateContent
      .map((g) => ({
        ...g,
        relativePaths: g.relativePaths.filter((p) => keepPaths.has(p)),
        moduleIds: g.moduleIds.filter((id) => keepIds.has(id)),
      }))
      .filter((g) => g.relativePaths.length > 0),
  };
}

/**
 * Run ground-truth. Returns 0 on success; throws UsageError (exit 3)
 * on usage/input errors. Prints only the ground-truth JSON to stdout.
 */
export async function runGroundTruth(
  options: GroundTruthOptions,
  writers: Writers = DEFAULT_WRITERS,
): Promise<number> {
  const repoRoot = resolve(options.repo);
  let st;
  try {
    st = statSync(repoRoot);
  } catch {
    throw new UsageError(`repo path does not exist: ${JSON.stringify(options.repo)}`);
  }
  if (!st.isDirectory()) {
    throw new UsageError(`repo path is not a directory: ${JSON.stringify(options.repo)}`);
  }
  const built = await buildGroundTruthGraphFromRepo(repoRoot);
  let graph = canonicalizeGraph(built);
  if (options.lang !== undefined) {
    graph = filterCanonicalGraphByLang(graph, options.lang);
  }
  writers.stdout(`${JSON.stringify(graph, null, 2)}\n`);
  return 0;
}
