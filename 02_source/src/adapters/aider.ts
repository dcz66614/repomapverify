/**
 * Aider Repo Map -> ClaimedMapV1 (T002 PoC, completed T008;
 * PROJECT_BOOK §6.5).
 *
 * Aider selects files/symbols by token budget, so its map is a clipped
 * subgraph: the contract FORCES PARTIAL_SUBGRAPH
 * (forcedCompleteness("aider-repo-map") === "PARTIAL_SUBGRAPH"), whatever
 * the input says. A PARTIAL_SUBGRAPH map never produces MISSING_EDGE /
 * UNCLAIMED_REACHABLE_MODULE findings downstream.
 *
 * ASSUMED UPSTREAM SHAPES — documented precisely (see
 * 03_evidence/T008/ADAPTER_SHAPES.md). The Aider repo-map TEXT format
 * is a ctags-style listing; no verified current Aider output sample
 * was available to T002 or T008, so the text grammar below is a
 * documented assumption:
 *
 *   Text (one file per header line):
 *     billing/api.py:
 *       def get_invoice(...)
 *       class Api
 *     billing/auth.py:
 *       def login(...)
 *   JSON (our own interchange shape, not an Aider-native format):
 *     { "files": ["billing/api.py", "billing/auth.py"],
 *       "repo_snapshot_sha256": "<64-hex>" }
 *
 * An Aider map asserts FILES (and their symbols), not import edges, so
 * the mapped claimed map carries modules and NO edges. Entry points are
 * not declared by an Aider map (entrypoints: []).
 *
 * Strictness (T008): the JSON form is structured input, so a
 * non-string `files[i]`, an unsafe (absolute / "..") path, or an
 * unknown top-level key is a REJECTION naming the field. The TEXT
 * form is a loose listing — a line that is not a `.py` header is a
 * symbol line, not an error — but an unsafe header path is dropped
 * with a REDACTED note (never echoed raw). The mapped map is run
 * through the SAME strict claimed-map/v1 validator as native input
 * before it is returned (finishMapping).
 */
import type { ClaimedModuleRef } from "../contracts/claimed-map.js";
import { forcedCompleteness } from "../contracts/adapters.js";
import { isUnsafeRelativePath } from "../contracts/module.js";
import {
  buildClaimedMap,
  derivedMapId,
  fail,
  finishMapping,
  isRecord,
  normalizeModulePath,
  noteJson,
  optionalStringField,
  resolveAliasedField,
  resolveSnapshot,
  type AdapterOptions,
  type AdapterResult,
} from "./shared.js";

/** Allowed top-level keys of the Aider JSON interchange shape. */
const AIDER_JSON_KEYS = new Set([
  "files",
  "map_id",
  "mapId",
  "repo",
  "agent",
  "repo_snapshot_sha256",
  "snapshot_sha256",
  "git_commit",
  "gitCommit",
  "completeness",
]);

/** Extract .py file paths from Aider repo-map text. */
export function parseAiderRepoMapText(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    // Header form: "path/to/file.py:" — strip the trailing colon.
    const header = /^(\S+\.py):\s*$/.exec(line);
    if (header !== null && header[1] !== undefined) {
      out.push(header[1]);
      continue;
    }
    // Bare path form: "path/to/file.py"
    if (/^\S+\.py$/.test(line)) out.push(line);
  }
  return [...new Set(out)];
}

export function mapAiderRepoMap(
  input: unknown,
  opts?: AdapterOptions,
): AdapterResult {
  const notes: string[] = [];
  let files: string[];
  let inputRecord: Record<string, unknown> | undefined;
  let jsonForm = false;

  if (typeof input === "string") {
    files = parseAiderRepoMapText(input);
  } else if (isRecord(input)) {
    jsonForm = true;
    inputRecord = input;
    for (const key of Object.keys(input)) {
      if (!AIDER_JSON_KEYS.has(key)) {
        return fail(
          `aider-repo-map input: unknown top-level field ${noteJson(key)} — not part of the Aider JSON shape`,
        );
      }
    }
    if (!Array.isArray(input["files"])) {
      return fail("aider-repo-map JSON input must carry files[]");
    }
    files = [];
    for (let i = 0; i < (input["files"] as unknown[]).length; i++) {
      const f = (input["files"] as unknown[])[i];
      if (typeof f !== "string" || f === "") {
        return fail(
          `aider-repo-map input: files[${i}] must be a non-empty string, got ${noteJson(f)}`,
        );
      }
      if (isUnsafeRelativePath(f)) {
        return fail(
          `aider-repo-map input: files[${i}] must be a repo-relative path (absolute paths and ".." escapes are rejected)`,
        );
      }
      files.push(f);
    }
  } else {
    return fail("aider-repo-map input must be repo-map text or { files: [] }");
  }

  const snapshot = resolveSnapshot(inputRecord ?? {}, opts);
  if (snapshot === undefined || snapshot === "") {
    return fail(
      "aider-repo-map input carries no repo_snapshot_sha256 (pass AdapterOptions.repoSnapshotSha256 to bind at audit time)",
    );
  }

  const mapId =
    inputRecord !== undefined
      ? resolveAliasedField(inputRecord, "mapId", "map_id", notes)
      : {};
  if (mapId.error !== undefined) return fail(`aider-repo-map input: ${mapId.error}`);
  const repo =
    inputRecord !== undefined ? optionalStringField(inputRecord, "repo") : {};
  if (repo.error !== undefined) return fail(`aider-repo-map input: ${repo.error}`);
  const agent =
    inputRecord !== undefined ? optionalStringField(inputRecord, "agent") : {};
  if (agent.error !== undefined) return fail(`aider-repo-map input: ${agent.error}`);
  const gitCommit =
    inputRecord !== undefined
      ? resolveAliasedField(inputRecord, "gitCommit", "git_commit", notes)
      : {};
  if (gitCommit.error !== undefined) {
    return fail(`aider-repo-map input: ${gitCommit.error}`);
  }
  if (
    inputRecord !== undefined &&
    inputRecord["completeness"] !== undefined &&
    inputRecord["completeness"] !== "PARTIAL_SUBGRAPH"
  ) {
    notes.push(
      `input completeness ${noteJson(inputRecord["completeness"])} ignored: Aider Repo Map is always PARTIAL_SUBGRAPH`,
    );
  }

  const modules: ClaimedModuleRef[] = [];
  for (const f of files) {
    // Text form: an unsafe header is dropped with a redacted note
    // (the text grammar is loose by nature). JSON form already
    // rejected unsafe paths above, so this only fires for text.
    const path = normalizeModulePath(f, notes);
    if (path === undefined) continue;
    modules.push({ id: path, path, kind: "module" });
  }
  if (modules.length === 0) {
    return fail(
      `aider-repo-map input listed no .py modules${jsonForm ? "" : " (text form: expected 'path/to/file.py:' headers)"}`,
    );
  }

  // Forced by contract — never FULL_GRAPH, regardless of input.
  const completeness = forcedCompleteness("aider-repo-map");
  if (completeness === undefined) {
    return fail("internal error: aider-repo-map must force PARTIAL_SUBGRAPH");
  }
  notes.push(
    "completeness forced to PARTIAL_SUBGRAPH (Aider Repo Map is token-budget clipped)",
  );

  const map = buildClaimedMap({
    mapId: mapId.value ?? derivedMapId("aider-repo-map", input),
    repo: repo.value ?? "unknown-repo",
    agent: agent.value ?? "aider-repo-map",
    completeness,
    repoSnapshotSha256: snapshot,
    gitCommit: gitCommit.value,
    modules,
    entrypoints: [],
    edges: [],
  });
  return finishMapping(map, 0, notes);
}
