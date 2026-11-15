/**
 * Shared input-adapter helpers (T002 PoC; PROJECT_BOOK §6.5).
 *
 * All four v1 input shapes are normalized to the internal ClaimedMapV1
 * before comparison. Adapters NEVER invent claims: an edge whose
 * provenance marker is missing or non-static is dropped and counted,
 * never passed through as a verified static-import claim.
 */
import { createHash } from "node:crypto";
import {
  CLAIMED_MAP_SCHEMA,
  type ClaimedEdge,
  type ClaimedMapV1,
  type ClaimedModuleRef,
  type Completeness,
} from "../contracts/claimed-map.js";
import {
  isUnsafeRelativePath,
  normalizeRelativePath,
} from "../contracts/module.js";
import { validateClaimedMap } from "../io/validate-claimed-map.js";
import { redactText } from "../privacy/redact.js";

/** Result of one adapter mapping. `ok: false` carries a plain error string. */
export interface AdapterResult {
  ok: boolean;
  map?: ClaimedMapV1;
  error?: string;
  /** Edges dropped because their provenance was not static/EXTRACTED. */
  droppedEdges: number;
  /** Human-readable notes (dropped edges, derived ids, auto-added modules). */
  notes: string[];
}

/** Options a caller may pass when the input itself carries no snapshot. */
export interface AdapterOptions {
  /** Snapshot hash to bind when the input carries none (audit-time binding). */
  repoSnapshotSha256?: string;
}

export function fail(error: string): AdapterResult {
  return { ok: false, error, droppedEdges: 0, notes: [] };
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sha8(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/** Deterministic map id when the input carries none. */
export function derivedMapId(kind: string, input: unknown): string {
  return `${kind}-${sha8(JSON.stringify(input) ?? "")}`;
}

/** Snapshot: input field wins, then caller option, else an error. */
export function resolveSnapshot(
  input: Record<string, unknown>,
  opts: AdapterOptions | undefined,
): string | undefined {
  const fromInput =
    typeof input["repo_snapshot_sha256"] === "string"
      ? (input["repo_snapshot_sha256"] as string)
      : typeof input["snapshot_sha256"] === "string"
        ? (input["snapshot_sha256"] as string)
        : undefined;
  return fromInput ?? opts?.repoSnapshotSha256;
}

/** Completeness declared by the input; undefined when absent/invalid. */
export function inputCompleteness(
  input: Record<string, unknown>,
): Completeness | undefined {
  const c = input["completeness"];
  return c === "FULL_GRAPH" || c === "PARTIAL_SUBGRAPH" ? c : undefined;
}

export function stringField(
  input: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "string" && v !== "") return v;
  }
  return undefined;
}

/** Redacted JSON echo for adapter notes — never leaks an absolute path or username. */
export function noteJson(v: unknown): string {
  return redactText(JSON.stringify(v) ?? String(v));
}

/**
 * Resolve a camelCase field with its snake_case alias (same rule as
 * the T008 io validator: both spellings present with different
 * values is an error; a lone snake_case alias is accepted with a
 * note, never silently). Returns the value, or an error string
 * naming the field.
 */
export function resolveAliasedField(
  input: Record<string, unknown>,
  camel: string,
  snake: string,
  notes: string[],
): { value?: string; error?: string } {
  const camelVal = input[camel];
  const snakeVal = input[snake];
  if (camelVal !== undefined && snakeVal !== undefined) {
    if (camelVal !== snakeVal) {
      return {
        error:
          `conflicting values for ${camel} (camelCase) and ${snake} (snake_case); ` +
          `supply exactly one spelling`,
      };
    }
    notes.push(
      `both ${camel} and ${snake} present with the same value; canonical field is ${camel}`,
    );
  }
  const raw = camelVal !== undefined ? camelVal : snakeVal;
  if (raw === undefined) return {};
  if (typeof raw !== "string" || raw === "") {
    return { error: `${camel} must be a non-empty string` };
  }
  if (snakeVal !== undefined && camelVal === undefined) {
    notes.push(`snake_case alias ${snake} used; canonical field is ${camel}`);
  }
  return { value: raw };
}

/**
 * Optional top-level string field: absent is fine, present-but-
 * mistyped is an error naming the field (never a silent fallback).
 */
export function optionalStringField(
  input: Record<string, unknown>,
  key: string,
): { value?: string; error?: string } {
  const raw = input[key];
  if (raw === undefined) return {};
  if (typeof raw !== "string" || raw === "") {
    return { error: `${key} must be a non-empty string when present` };
  }
  return { value: raw };
}

/**
 * Post-mapping strict validation (T008 acceptance 2): every adapter
 * runs the SAME claimed-map/v1 validator as native input over the
 * map it built. A mapped map that fails validation is rejected with
 * the offending fields listed — never passed downstream.
 */
export function finishMapping(
  map: ClaimedMapV1,
  droppedEdges: number,
  notes: string[],
): AdapterResult {
  const checked = validateClaimedMap(map);
  if (!checked.ok) {
    return fail(
      `mapped claimed map failed strict validation: ${checked.errors
        .map((e) => `${e.field}: ${e.message}`)
        .join("; ")}`,
    );
  }
  for (const w of checked.warnings) {
    notes.push(`validation warning ${w.field}: ${w.message}`);
  }
  return { ok: true, map, droppedEdges, notes };
}

/**
 * Validate + normalize one claimed module path. Returns undefined (with
 * the reason appended to `notes`) when the path is unsafe.
 */
export function normalizeModulePath(
  raw: unknown,
  notes: string[],
): string | undefined {
  if (typeof raw !== "string" || raw === "") {
    notes.push(`dropped module with non-string path: ${noteJson(raw)}`);
    return undefined;
  }
  if (isUnsafeRelativePath(raw)) {
    notes.push(`dropped unsafe module path: ${noteJson(raw)}`);
    return undefined;
  }
  const norm = normalizeRelativePath(raw);
  if (norm === "") {
    notes.push(`dropped empty module path: ${noteJson(raw)}`);
    return undefined;
  }
  return norm;
}

/** Build the final ClaimedMapV1 from normalized parts. */
export function buildClaimedMap(args: {
  mapId: string;
  repo: string;
  agent: string | undefined;
  completeness: Completeness;
  repoSnapshotSha256: string;
  gitCommit: string | undefined;
  modules: ClaimedModuleRef[];
  entrypoints: string[];
  edges: ClaimedEdge[];
}): ClaimedMapV1 {
  const modules = dedupeModules(args.modules);
  const edges = dedupeEdges(args.edges);
  const map: ClaimedMapV1 = {
    schema: CLAIMED_MAP_SCHEMA,
    mapId: args.mapId,
    repo: args.repo,
    completeness: args.completeness,
    repoSnapshotSha256: args.repoSnapshotSha256,
    modules,
    entrypoints: [...new Set(args.entrypoints)],
    edges,
  };
  if (args.agent !== undefined) map.agent = args.agent;
  if (args.gitCommit !== undefined) map.gitCommit = args.gitCommit;
  return map;
}

function dedupeModules(modules: ClaimedModuleRef[]): ClaimedModuleRef[] {
  const seen = new Set<string>();
  const out: ClaimedModuleRef[] = [];
  for (const m of modules) {
    if (seen.has(m.path)) continue;
    seen.add(m.path);
    out.push(m);
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

function dedupeEdges(edges: ClaimedEdge[]): ClaimedEdge[] {
  const seen = new Set<string>();
  const out: ClaimedEdge[] = [];
  for (const e of edges) {
    const key = `${e.from}\0${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  out.sort((a, b) =>
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
  return out;
}
