/**
 * Understand-Anything .ua graph data -> ClaimedMapV1 (T002 PoC,
 * completed T008).
 *
 * ASSUMED UPSTREAM SHAPE — documented precisely because no verified
 * real .ua sample was available to T002 or T008 (see
 * 03_evidence/T008/ADAPTER_SHAPES.md for the full record, the fields
 * that were searched for, and what would falsify this shape):
 *
 *   {
 *     "map_id" | "mapId": "ua-run-1",        // optional, either spelling
 *     "repo": "billing-service",             // optional
 *     "agent": "understand-anything-0.9",    // optional
 *     "completeness": "FULL_GRAPH",          // REQUIRED
 *     "repo_snapshot_sha256": "<64-hex>",    // or via AdapterOptions
 *     "git_commit" | "gitCommit": "<hex>",   // optional
 *     "nodes": [{ "id": "n1", "path": "billing/api.py",
 *                 "kind": "module",           // optional, module|package
 *                 "generated": false }],      // optional boolean (T008)
 *     "edges": [{ "from": "n1", "to": "n2", "origin": "static" }],
 *     "entrypoints": ["billing/main.py"]     // optional
 *   }
 *
 * Rules (contracts/adapters.ts): Understand-Anything mixes Tree-sitter
 * static extraction with LLM-inferred relations. Only statically
 * extracted edges are claims. An edge is kept ONLY when its origin
 * marker says "static" (case-insensitive); "llm" / "inferred" /
 * missing origins are dropped and counted — unknown provenance is
 * never a claim. This is a DEFINED rule, not ambiguity: the drop is
 * counted and noted. Endpoint resolution and module auto-add follow
 * mapGraphify, and every other consumed field is validated STRICTLY
 * (T008): a node without a string `path`, a `kind` outside
 * module|package, a non-boolean `generated`, a non-string entrypoint,
 * or a duplicate module path / node id is a REJECTION naming the
 * field. The mapped map is run through the SAME strict claimed-map/v1
 * validator as native input before it is returned (finishMapping).
 */
import type {
  ClaimedEdge,
  ClaimedModuleRef,
} from "../contracts/claimed-map.js";
import {
  buildClaimedMap,
  derivedMapId,
  fail,
  finishMapping,
  inputCompleteness,
  isRecord,
  normalizeModulePath,
  noteJson,
  optionalStringField,
  resolveAliasedField,
  resolveSnapshot,
  type AdapterOptions,
  type AdapterResult,
} from "./shared.js";
import { isUnsafeRelativePath } from "../contracts/module.js";

export function mapUnderstandAnything(
  input: unknown,
  opts?: AdapterOptions,
): AdapterResult {
  const notes: string[] = [];
  if (!isRecord(input)) {
    return fail("understand-anything input must be a JSON object");
  }
  const completeness = inputCompleteness(input);
  if (completeness === undefined) {
    return fail(
      "understand-anything input must declare completeness (FULL_GRAPH | PARTIAL_SUBGRAPH)",
    );
  }
  const snapshot = resolveSnapshot(input, opts);
  if (snapshot === undefined || snapshot === "") {
    return fail(
      "understand-anything input carries no repo_snapshot_sha256 (pass AdapterOptions.repoSnapshotSha256 to bind at audit time)",
    );
  }
  if (!Array.isArray(input["nodes"]) || !Array.isArray(input["edges"])) {
    return fail("understand-anything input must carry nodes[] and edges[] arrays");
  }
  const mapId = resolveAliasedField(input, "mapId", "map_id", notes);
  if (mapId.error !== undefined) return fail(`understand-anything input: ${mapId.error}`);
  const repo = optionalStringField(input, "repo");
  if (repo.error !== undefined) return fail(`understand-anything input: ${repo.error}`);
  const agent = optionalStringField(input, "agent");
  if (agent.error !== undefined) return fail(`understand-anything input: ${agent.error}`);
  const gitCommit = resolveAliasedField(input, "gitCommit", "git_commit", notes);
  if (gitCommit.error !== undefined) {
    return fail(`understand-anything input: ${gitCommit.error}`);
  }

  const modules: ClaimedModuleRef[] = [];
  const byId = new Map<string, string>();
  const seenPaths = new Map<string, number>();
  for (let i = 0; i < (input["nodes"] as unknown[]).length; i++) {
    const n = (input["nodes"] as unknown[])[i];
    if (!isRecord(n)) {
      return fail(
        `understand-anything input: nodes[${i}] must be an object, got ${noteJson(n)}`,
      );
    }
    if (typeof n["path"] !== "string" || n["path"] === "") {
      return fail(
        `understand-anything input: nodes[${i}].path must be a non-empty string, got ${noteJson(n["path"])}`,
      );
    }
    if (isUnsafeRelativePath(n["path"])) {
      return fail(
        `understand-anything input: nodes[${i}].path must be a repo-relative path (absolute paths and ".." escapes are rejected)`,
      );
    }
    const path = normalizeModulePath(n["path"], notes);
    if (path === undefined) {
      return fail(
        `understand-anything input: nodes[${i}].path is not a usable module path`,
      );
    }
    if (seenPaths.has(path)) {
      return fail(
        `understand-anything input: nodes[${i}].path duplicates nodes[${seenPaths.get(path)}].path (${noteJson(path)})`,
      );
    }
    seenPaths.set(path, i);
    let kind: ClaimedModuleRef["kind"] = "module";
    if (n["kind"] !== undefined) {
      if (n["kind"] !== "module" && n["kind"] !== "package") {
        return fail(
          `understand-anything input: nodes[${i}].kind must be "module" or "package", got ${noteJson(n["kind"])}`,
        );
      }
      kind = n["kind"];
    }
    let generated: boolean | undefined;
    if (n["generated"] !== undefined) {
      if (typeof n["generated"] !== "boolean") {
        return fail(
          `understand-anything input: nodes[${i}].generated must be a boolean, got ${noteJson(n["generated"])}`,
        );
      }
      generated = n["generated"];
    }
    let id = path;
    if (n["id"] !== undefined) {
      if (typeof n["id"] !== "string" || n["id"] === "") {
        return fail(
          `understand-anything input: nodes[${i}].id must be a non-empty string when present, got ${noteJson(n["id"])}`,
        );
      }
      id = n["id"];
      const prev = byId.get(id);
      if (prev !== undefined && prev !== path) {
        return fail(
          `understand-anything input: nodes[${i}].id ${noteJson(id)} already maps to ${noteJson(prev)}`,
        );
      }
      byId.set(id, path);
    }
    const mod: ClaimedModuleRef = { id, path, kind };
    if (generated !== undefined) mod.generated = generated;
    modules.push(mod);
  }

  const entrypoints: string[] = [];
  if (input["entrypoints"] !== undefined) {
    if (!Array.isArray(input["entrypoints"])) {
      return fail("understand-anything input: entrypoints must be an array of strings");
    }
    for (let i = 0; i < (input["entrypoints"] as unknown[]).length; i++) {
      const ep = (input["entrypoints"] as unknown[])[i];
      if (typeof ep !== "string" || ep === "") {
        return fail(
          `understand-anything input: entrypoints[${i}] must be a non-empty string, got ${noteJson(ep)}`,
        );
      }
      if (isUnsafeRelativePath(ep)) {
        return fail(
          `understand-anything input: entrypoints[${i}] must be a repo-relative path`,
        );
      }
      entrypoints.push(ep);
    }
  }

  const edges: ClaimedEdge[] = [];
  let droppedEdges = 0;
  for (let i = 0; i < (input["edges"] as unknown[]).length; i++) {
    const e = (input["edges"] as unknown[])[i];
    if (!isRecord(e)) {
      return fail(
        `understand-anything input: edges[${i}] must be an object, got ${noteJson(e)}`,
      );
    }
    const origin =
      typeof e["origin"] === "string" ? e["origin"].trim().toLowerCase() : "";
    if (origin !== "static") {
      droppedEdges++;
      notes.push(
        `dropped non-static edge (origin=${noteJson(e["origin"])}): ${noteJson(e["from"] ?? e["source"])} -> ${noteJson(e["to"] ?? e["target"])}`,
      );
      continue;
    }
    const fromRes = resolveEndpoint(e, "from", "source", byId, i);
    if (fromRes.error !== undefined) return fail(fromRes.error);
    const toRes = resolveEndpoint(e, "to", "target", byId, i);
    if (toRes.error !== undefined) return fail(toRes.error);
    const from = fromRes.path as string;
    const to = toRes.path as string;
    edges.push({ from, to });
    for (const p of [from, to]) {
      if (!modules.some((m) => m.path === p)) {
        modules.push({ id: p, path: p, kind: "module" });
        notes.push(`auto-added edge endpoint as claimed module: ${noteJson(p)}`);
      }
    }
  }

  const map = buildClaimedMap({
    mapId: mapId.value ?? derivedMapId("understand-anything", input),
    repo: repo.value ?? "unknown-repo",
    agent: agent.value ?? "understand-anything",
    completeness,
    repoSnapshotSha256: snapshot,
    gitCommit: gitCommit.value,
    modules,
    entrypoints,
    edges,
  });
  return finishMapping(map, droppedEdges, notes);
}

function resolveEndpoint(
  e: Record<string, unknown>,
  primary: string,
  alias: string,
  byId: Map<string, string>,
  edgeIndex: number,
): { path?: string; error?: string } {
  const a = e[primary];
  const b = e[alias];
  if (a !== undefined && b !== undefined && a !== b) {
    return {
      error:
        `understand-anything input: edges[${edgeIndex}].${primary} (${noteJson(a)}) conflicts with ` +
        `edges[${edgeIndex}].${alias} (${noteJson(b)}); supply exactly one spelling`,
    };
  }
  const raw = a !== undefined ? a : b;
  if (raw === undefined) {
    return {
      error: `understand-anything input: edges[${edgeIndex}].${primary} is missing (static edges must name both endpoints)`,
    };
  }
  if (typeof raw !== "string" || raw === "") {
    return {
      error: `understand-anything input: edges[${edgeIndex}].${primary} must be a non-empty string, got ${noteJson(raw)}`,
    };
  }
  const byIdHit = byId.get(raw);
  if (byIdHit !== undefined) return { path: byIdHit };
  if (isUnsafeRelativePath(raw)) {
    return {
      error:
        `understand-anything input: edges[${edgeIndex}].${primary} must be a node id or a ` +
        `repo-relative path (absolute paths and ".." escapes are rejected)`,
    };
  }
  const notes: string[] = [];
  const path = normalizeModulePath(raw, notes);
  if (path === undefined) {
    return {
      error: `understand-anything input: edges[${edgeIndex}].${primary} is not a usable module path`,
    };
  }
  return { path };
}
