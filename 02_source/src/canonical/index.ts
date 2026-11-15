/**
 * T005 — Canonical graph form and hash (PROJECT_BOOK §4.2, §10.1; PLAN T005/T008).
 *
 * The canonical form is the ONLY thing ever hashed for
 * determinism/replay purposes:
 *
 * - Modules sorted by NFC-normalized relative path (NFC first, then
 *   plain code-unit order — see identity/compareNormalizedPaths), then
 *   module_id. Aliases sorted. Edges sorted by (from path, to path).
 *   Reachable / isolated / entrypoints sorted by path. Duplicate
 *   content groups sorted by content hash. Object keys sorted
 *   recursively in the JSON encoding.
 * - The hash is SHA-256 over that canonical JSON. The same semantic
 *   graph therefore hashes identically regardless of extractor
 *   discovery order, input file order, or registration order; a
 *   content change changes the hash (via content_sha256) but never
 *   any module_id.
 * - Non-deterministic fields are excluded by construction: no
 *   timestamps, durations, absolute paths, temp-dir names or random
 *   ids ever enter the canonical form. (This is the same exclusion
 *   rule the S0 gate hashes by; T008 owns the report-level canonical
 *   hash, this module owns the graph-level one.)
 *
 * FROZEN SNAPSHOT ALGORITHM (T008 freeze; the T002 PoC formula, now
 * the single canonical definition — see 03_evidence/T008/SNAPSHOT_FREEZE.md):
 *
 *   CANONICAL_SNAPSHOT_ALGORITHM: SHA-256 over the sorted lines
 *   `relativePath + NUL + contentSha256 + "\n"`, one line per file,
 *   sorted by NFC-normalized relative path (NFC first, then sort).
 *   `computeCanonicalSnapshotSha256` is THE implementation; the
 *   Python extractor's `computeRepoSnapshotSha256` and the Go
 *   package combination hash use the same formula.
 *
 * Symlink behavior (T005 note, frozen by T008): the GRAPH snapshot
 * (src/graph/fromRepo.ts `computeRepoSnapshotSha256`) is over
 * PHYSICAL files — in-repo symlink spellings of one file collapse
 * to the canonical (smallest) path, so one physical file contributes
 * exactly one line. The PYTHON EXTRACTOR snapshot lists every
 * spelling it walks, so on a repo WITH in-repo symlinks the two
 * hashes DIFFER (deliberately: the graph snapshot answers "what
 * content is in this tree", the extractor snapshot answers "what
 * spellings were walked"). On symlink-free repos the two are
 * IDENTICAL — verified on all 16 Python S0 fixtures
 * (tests/canonical/canonical-t008.test.ts). The canonical function
 * itself takes an explicit file list, so callers choose which file
 * set they hash; the graph form (collapsed) is the shipped snapshot.
 */
import { createHash } from "node:crypto";
import { compareNormalizedPaths } from "../identity/normalize.js";
import { redactValue, type RedactionOptions } from "../privacy/redact.js";
import type { BuiltGraph } from "../graph/types.js";

export const CANONICAL_GRAPH_SCHEMA = "repomapverify.ground-truth/v1" as const;

/** Frozen snapshot algorithm, in words (see the module header). */
export const CANONICAL_SNAPSHOT_ALGORITHM =
  "sha256 over sorted lines: relativePath + NUL + contentSha256 + '\\n'" as const;

export interface CanonicalModule {
  moduleId: string;
  language: string;
  nodeKind: string;
  relativePath: string;
  contentSha256: string;
  isGenerated: boolean;
  isEntrypoint: boolean;
  parseStatus: string;
  aliases: string[];
}

export interface CanonicalEdge {
  from: string;
  to: string;
  fromModuleId: string;
  toModuleId: string;
  conditional: boolean;
  typeOnly: boolean;
}

export interface CanonicalGraph {
  schema: typeof CANONICAL_GRAPH_SCHEMA;
  modules: CanonicalModule[];
  edges: CanonicalEdge[];
  entrypoints: string[];
  reachableFromEntrypoints: string[];
  isolatedModules: string[];
  entrypointCandidates: string[];
  duplicateContent: Array<{
    contentSha256: string;
    moduleIds: string[];
    relativePaths: string[];
  }>;
  externalImportCount: number;
  repoSnapshotSha256: string;
  gitCommit?: string;
}

/**
 * The sorted snapshot lines for a file list (NFC-normalized paths,
 * NFC first, then sort). The canonical snapshot hash is SHA-256 over
 * the concatenation of these lines.
 */
export function canonicalSnapshotLines(
  files: ReadonlyArray<{ relativePath: string; contentSha256: string }>,
): string[] {
  // NFC FIRST: the path in the line is the normalized path, never the
  // raw spelling — an NFD input must hash exactly like its NFC twin.
  const normalized = files.map((f) => ({
    relativePath: f.relativePath.normalize("NFC"),
    contentSha256: f.contentSha256,
  }));
  const sorted = [...normalized].sort((a, b) =>
    compareNormalizedPaths(a.relativePath, b.relativePath),
  );
  return sorted.map((f) => `${f.relativePath}\0${f.contentSha256}\n`);
}

/**
 * Canonical snapshot hash (frozen by T005, frozen in words by T008):
 * SHA-256 over the sorted lines `relativePath + NUL + contentSha256
 * + "\n"`. Same formula as the Python extractor's snapshot and the Go
 * package combination hash; sorting makes it independent of discovery
 * order.
 */
export function computeCanonicalSnapshotSha256(
  files: ReadonlyArray<{ relativePath: string; contentSha256: string }>,
): string {
  return createHash("sha256")
    .update(canonicalSnapshotLines(files).join(""), "utf8")
    .digest("hex");
}

/**
 * Keys that are NEVER part of a canonical semantic hash (T008).
 * Timestamps, durations, absolute paths, temp-dir names, random ids,
 * host/process identifiers — anything that can differ between two
 * runs of the same semantic result. The list is explicit and closed:
 * a key not on it is hashed. Callers that carry their own volatile
 * keys pass them via `extraKeys` on `stripVolatileFields`.
 */
export const VOLATILE_HASH_KEYS: ReadonlySet<string> = new Set([
  // Time.
  "timestamp",
  "createdAt",
  "updatedAt",
  "startedAt",
  "finishedAt",
  // Durations.
  "duration",
  "durationMs",
  "elapsed",
  "elapsedMs",
  // Absolute paths / locations.
  "absolutePath",
  "repoRoot",
  "repoAbsolutePath",
  "tempDir",
  "tmpDir",
  "tmpdir",
  // Random / run identifiers.
  "runId",
  "taskId",
  "requestId",
  "randomId",
  "nonce",
  // Host / process.
  "hostname",
  "pid",
]);

/**
 * Deep-strip volatile keys from a JSON-shaped value (returns a new
 * value). Any key ending in `AbsolutePath` (case-insensitive) is
 * also stripped, whatever its prefix. Semantic keys — including
 * `moduleId`, `contentSha256`, `repoSnapshotSha256` and `schema` —
 * are never stripped.
 */
export function stripVolatileFields(
  value: unknown,
  extraKeys: ReadonlySet<string> = new Set(),
): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => stripVolatileFields(v, extraKeys));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_HASH_KEYS.has(k) || extraKeys.has(k)) continue;
      if (/absolutePath$/i.test(k)) continue;
      out[k] = stripVolatileFields(v, extraKeys);
    }
    return out;
  }
  return value;
}

/**
 * Canonical semantic hash (T008): SHA-256 over the canonical JSON of
 * a value AFTER volatile fields are stripped. The caller must pass
 * an already-normalized semantic result (NFC paths, relative paths
 * only, sorted lists or lists whose order is semantic). When
 * `redactOpts` is given, absolute paths / usernames inside string
 * values are redacted to relative paths / placeholders BEFORE
 * hashing, so the same semantic result hashes identically even when
 * it was produced under different absolute repo locations; without
 * `redactOpts` a raw absolute path in a string value is hashed
 * as-is (documented precondition — normalize first).
 */
export function canonicalSemanticHash(
  value: unknown,
  redactOpts?: RedactionOptions,
): string {
  const stripped = stripVolatileFields(value);
  const clean =
    redactOpts !== undefined ? redactValue(stripped, redactOpts) : stripped;
  return createHash("sha256").update(canonicalJson(clean), "utf8").digest("hex");
}

/** Deterministic JSON: recursively sort object keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** The canonical (order-independent, serializable) form of a built graph. */
export function canonicalizeGraph(built: BuiltGraph): CanonicalGraph {
  const byId = built.graph.modules;
  const pathOf = (id: string): string => byId.get(id)?.relativePath ?? id;

  const modules: CanonicalModule[] = [...byId.values()]
    .map((m) => ({
      moduleId: m.moduleId,
      language: m.language,
      nodeKind: m.nodeKind,
      relativePath: m.relativePath,
      contentSha256: m.contentSha256,
      isGenerated: m.isGenerated,
      isEntrypoint: m.isEntrypoint,
      parseStatus: m.parseStatus,
      aliases: [...(built.aliases.get(m.moduleId) ?? [])].sort(compareNormalizedPaths),
    }))
    .sort(
      (a, b) =>
        compareNormalizedPaths(a.relativePath, b.relativePath) ||
        (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0),
    );

  const edges: CanonicalEdge[] = [...built.graph.edges.values()]
    .map((e) => ({
      from: pathOf(e.fromModuleId),
      to: pathOf(e.toModuleId),
      fromModuleId: e.fromModuleId,
      toModuleId: e.toModuleId,
      conditional: e.conditional ?? false,
      typeOnly: e.typeOnly ?? false,
    }))
    .sort(
      (a, b) =>
        compareNormalizedPaths(a.from, b.from) ||
        compareNormalizedPaths(a.to, b.to) ||
        (a.fromModuleId < b.fromModuleId ? -1 : a.fromModuleId > b.fromModuleId ? 1 : 0) ||
        (a.toModuleId < b.toModuleId ? -1 : a.toModuleId > b.toModuleId ? 1 : 0),
    );

  const sortPaths = (ids: Iterable<string>): string[] =>
    [...ids].map(pathOf).sort(compareNormalizedPaths);

  return {
    schema: CANONICAL_GRAPH_SCHEMA,
    modules,
    edges,
    entrypoints: sortPaths(built.declaredEntrypoints),
    reachableFromEntrypoints: sortPaths(built.graph.reachableFromEntrypoints),
    isolatedModules: sortPaths(built.graph.isolatedModuleIds),
    entrypointCandidates: [...built.entrypointCandidates].sort(compareNormalizedPaths),
    duplicateContent: [...built.duplicateContent]
      .map((g) => ({
        contentSha256: g.contentSha256,
        moduleIds: [...g.moduleIds].sort(),
        relativePaths: [...g.relativePaths].sort(compareNormalizedPaths),
      }))
      .sort((a, b) => (a.contentSha256 < b.contentSha256 ? -1 : 1)),
    externalImportCount: built.graph.externalImportCount,
    repoSnapshotSha256: built.graph.repoSnapshotSha256,
    ...(built.graph.gitCommit !== undefined ? { gitCommit: built.graph.gitCommit } : {}),
  };
}

/** SHA-256 of the canonical JSON encoding — stable under input reordering. */
export function canonicalGraphHash(built: BuiltGraph): string {
  return createHash("sha256").update(canonicalJson(canonicalizeGraph(built)), "utf8").digest("hex");
}
