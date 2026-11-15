/**
 * T008 — claimed-map/v1 strict schema validation
 * (PROJECT_BOOK §6.1, §6.4; IMPLEMENTATION_PLAN §4.1; PLAN T008).
 *
 * The validator is the single gate for claimed-map input. It enforces
 * the frozen contract `ClaimedMapV1` (src/contracts/claimed-map.ts):
 *
 * - `schema` must be exactly "repomapverify.claimed-map/v1".
 * - `mapId`, `repo` are required non-empty strings.
 * - `completeness` is REQUIRED and must be FULL_GRAPH |
 *   PARTIAL_SUBGRAPH — never guessed.
 * - `repoSnapshotSha256` is REQUIRED and must be a 64-char lowercase
 *   hex SHA-256 — never guessed.
 * - `modules[]` entries are exactly { id, path, kind } plus the
 *   OPTIONAL `generated` boolean (T008 GENERATED_MISMATCH decision:
 *   see 03_evidence/T008/GENERATED_MISMATCH_DECISION.md). Absent
 *   `generated` means "no assertion" — never defaulted to true/false.
 * - `entrypoints[]`, `edges[]` are required arrays of safe relative
 *   paths ({ from, to } for edges).
 *
 * Strictness rules:
 * - Any unknown top-level / module / edge field is an ERROR naming
 *   the offending field (`modules[2].bogus`, `edges[0].weight` …).
 *   Nothing is silently misread.
 * - Any mistyped field is an ERROR naming the field.
 * - Invalid input is a usage/input error, exit-code class 3
 *   (CLI contract §6.4: exit 3 = usage / input error), never a
 *   silent pass and never an audit PASS/FAIL.
 * - Error messages NEVER echo raw input values verbatim: values are
 *   passed through privacy redaction first, so an absolute path or
 *   username in a bad map cannot leak through an error message.
 *
 * snake_case aliases: the PROJECT_BOOK §6.1 example spells the map
 * fields `map_id` / `repo_snapshot_sha256` / `git_commit`, while the
 * frozen interface contract (PLAN §4.1) spells them camelCase
 * (`mapId` / `repoSnapshotSha256` / `gitCommit`) — and the 48 S0
 * fixtures are split: Python fixtures use `map_id`, TS/Go use
 * `mapId`. v1 does NOT pick one spelling by fiat and does NOT
 * silently accept either: a snake_case alias is accepted ONLY with
 * an explicit WARNING naming the alias, and when BOTH spellings are
 * present with different values that is an ERROR naming both fields.
 * A future v2 should freeze a single spelling.
 */
import {
  CLAIMED_MAP_SCHEMA,
  type ClaimedMapV1,
  type ClaimedModuleRef,
  type Completeness,
} from "../contracts/claimed-map.js";
import {
  isUnsafeRelativePath,
  normalizeRelativePath,
} from "../contracts/module.js";
import { redactText } from "../privacy/redact.js";

/** Exit-code class for usage / input errors (CLI contract §6.4). */
export const CLAIMED_MAP_INPUT_EXIT_CODE = 3 as const;

/** One validation problem. `field` is a JSON path, e.g. `modules[2].kind`. */
export interface ValidationIssue {
  field: string;
  message: string;
}

export type ClaimedMapValidationResult =
  | { ok: true; map: ClaimedMapV1; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

const SHA256_HEX = /^[0-9a-f]{64}$/;
const GIT_COMMIT_HEX = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

const TOP_LEVEL_KEYS = new Set([
  "schema",
  "mapId",
  "map_id",
  "repo",
  "agent",
  "completeness",
  "repoSnapshotSha256",
  "repo_snapshot_sha256",
  "gitCommit",
  "git_commit",
  "modules",
  "entrypoints",
  "edges",
]);

const MODULE_KEYS = new Set(["id", "path", "kind", "generated"]);
const EDGE_KEYS = new Set(["from", "to"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Short, redacted echo of an offending value — never the raw value. */
function safeEcho(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v) ?? String(v);
  const redacted = redactText(s);
  return redacted.length > 80 ? `${redacted.slice(0, 77)}…` : redacted;
}

/**
 * Resolve a camelCase field with its snake_case alias. Returns the
 * value plus any warning / error. When both spellings are present
 * they must agree, or the input is ambiguous and rejected.
 */
function resolveAliasedStringField(
  input: Record<string, unknown>,
  camel: string,
  snake: string,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): string | undefined {
  const camelVal = input[camel];
  const snakeVal = input[snake];
  const camelPresent = camelVal !== undefined;
  const snakePresent = snakeVal !== undefined;
  if (camelPresent && snakePresent) {
    if (camelVal !== snakeVal) {
      errors.push({
        field: `${camel} / ${snake}`,
        message:
          `conflicting values for ${camel} (camelCase) and ${snake} (snake_case); ` +
          `supply exactly one spelling`,
      });
      return undefined;
    }
    warnings.push({
      field: snake,
      message:
        `both ${camel} and ${snake} present with the same value; ` +
        `canonical field is ${camel}, snake_case alias is deprecated`,
    });
  } else if (snakePresent) {
    warnings.push({
      field: snake,
      message:
        `snake_case alias ${snake} used; canonical field is ${camel} ` +
        `(PROJECT_BOOK §6.1 spells it snake_case, PLAN §4.1 camelCase)`,
    });
  }
  const raw = camelPresent ? camelVal : snakeVal;
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    errors.push({
      field: camel,
      message: `must be a string, got ${safeEcho(raw)}`,
    });
    return undefined;
  }
  return raw;
}

/**
 * Validate + normalize one claimed path. `"."` is the Go root-package
 * spelling and is kept as-is (the comparator reads it back from the
 * empty normalized path). Any other path is NFC-normalized; a
 * spelling change is a warning, never silent.
 */
function validateClaimedPath(
  raw: unknown,
  field: string,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): string | undefined {
  if (typeof raw !== "string" || raw === "") {
    errors.push({
      field,
      message: `must be a non-empty relative path string, got ${safeEcho(raw)}`,
    });
    return undefined;
  }
  if (raw === ".") return ".";
  if (isUnsafeRelativePath(raw)) {
    errors.push({
      field,
      message: `must be a repo-relative path (absolute paths and ".." escapes are rejected)`,
    });
    return undefined;
  }
  const normalized = normalizeRelativePath(raw);
  if (normalized === "") {
    errors.push({ field, message: `must be a non-empty relative path` });
    return undefined;
  }
  if (normalized !== raw) {
    warnings.push({
      field,
      message: `path spelling normalized to ${safeEcho(normalized)} (NFC first, backslashes and "./" collapsed)`,
    });
  }
  return normalized;
}

/** Strict validation of an unknown value against ClaimedMapV1. */
export function validateClaimedMap(
  input: unknown,
): ClaimedMapValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        {
          field: "$",
          message: `claimed map must be a JSON object, got ${safeEcho(input)}`,
        },
      ],
      warnings,
    };
  }

  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      errors.push({
        field: key,
        message: `unknown top-level field ${safeEcho(key)} — not part of claimed-map/v1`,
      });
    }
  }

  // schema: exact value.
  if (input["schema"] === undefined) {
    errors.push({ field: "schema", message: "missing required field schema" });
  } else if (input["schema"] !== CLAIMED_MAP_SCHEMA) {
    errors.push({
      field: "schema",
      message: `must be exactly ${CLAIMED_MAP_SCHEMA}, got ${safeEcho(input["schema"])}`,
    });
  }

  const mapId = resolveAliasedStringField(
    input,
    "mapId",
    "map_id",
    errors,
    warnings,
  );
  if (mapId === undefined && input["mapId"] === undefined && input["map_id"] === undefined) {
    errors.push({ field: "mapId", message: "missing required field mapId" });
  } else if (mapId !== undefined && mapId === "") {
    errors.push({ field: "mapId", message: "must be a non-empty string" });
  }

  if (input["repo"] === undefined) {
    errors.push({ field: "repo", message: "missing required field repo" });
  } else if (typeof input["repo"] !== "string" || input["repo"] === "") {
    errors.push({
      field: "repo",
      message: `must be a non-empty string, got ${safeEcho(input["repo"])}`,
    });
  }

  let agent: string | undefined;
  if (input["agent"] !== undefined) {
    if (typeof input["agent"] !== "string" || input["agent"] === "") {
      errors.push({
        field: "agent",
        message: `must be a non-empty string when present, got ${safeEcho(input["agent"])}`,
      });
    } else {
      agent = input["agent"];
    }
  }

  let completeness: Completeness | undefined;
  if (input["completeness"] === undefined) {
    errors.push({
      field: "completeness",
      message:
        "missing required field completeness (FULL_GRAPH | PARTIAL_SUBGRAPH) — never guessed",
    });
  } else if (
    input["completeness"] !== "FULL_GRAPH" &&
    input["completeness"] !== "PARTIAL_SUBGRAPH"
  ) {
    errors.push({
      field: "completeness",
      message: `must be FULL_GRAPH or PARTIAL_SUBGRAPH, got ${safeEcho(input["completeness"])}`,
    });
  } else {
    completeness = input["completeness"];
  }

  const snapshot = resolveAliasedStringField(
    input,
    "repoSnapshotSha256",
    "repo_snapshot_sha256",
    errors,
    warnings,
  );
  if (
    snapshot === undefined &&
    input["repoSnapshotSha256"] === undefined &&
    input["repo_snapshot_sha256"] === undefined
  ) {
    errors.push({
      field: "repoSnapshotSha256",
      message:
        "missing required field repoSnapshotSha256 (full working-tree snapshot SHA-256) — never guessed",
    });
  } else if (snapshot !== undefined && !SHA256_HEX.test(snapshot)) {
    errors.push({
      field: "repoSnapshotSha256",
      message: "must be a 64-character lowercase hex SHA-256",
    });
  }

  let gitCommit: string | undefined;
  const gitRaw = resolveAliasedStringField(
    input,
    "gitCommit",
    "git_commit",
    errors,
    warnings,
  );
  if (gitRaw !== undefined) {
    if (!GIT_COMMIT_HEX.test(gitRaw)) {
      errors.push({
        field: "gitCommit",
        message: "must be a 40- or 64-character lowercase hex git commit",
      });
    } else {
      gitCommit = gitRaw;
    }
  }

  // modules[]
  const modules: ClaimedModuleRef[] = [];
  if (input["modules"] === undefined) {
    errors.push({ field: "modules", message: "missing required field modules" });
  } else if (!Array.isArray(input["modules"])) {
    errors.push({
      field: "modules",
      message: `must be an array, got ${safeEcho(input["modules"])}`,
    });
  } else {
    const seenIds = new Set<string>();
    const seenPaths = new Set<string>();
    input["modules"].forEach((entry, i) => {
      const base = `modules[${i}]`;
      if (!isRecord(entry)) {
        errors.push({
          field: base,
          message: `must be an object { id, path, kind }, got ${safeEcho(entry)}`,
        });
        return;
      }
      for (const key of Object.keys(entry)) {
        if (!MODULE_KEYS.has(key)) {
          errors.push({
            field: `${base}.${key}`,
            message: `unknown module field ${safeEcho(key)} — not part of claimed-map/v1`,
          });
        }
      }
      if (entry["id"] === undefined) {
        errors.push({ field: `${base}.id`, message: "missing required field id" });
      } else if (typeof entry["id"] !== "string" || entry["id"] === "") {
        errors.push({
          field: `${base}.id`,
          message: `must be a non-empty string, got ${safeEcho(entry["id"])}`,
        });
      } else if (seenIds.has(entry["id"])) {
        errors.push({
          field: `${base}.id`,
          message: `duplicate module id ${safeEcho(entry["id"])}`,
        });
      } else {
        seenIds.add(entry["id"]);
      }
      const path = validateClaimedPath(entry["path"], `${base}.path`, errors, warnings);
      if (path !== undefined) {
        if (seenPaths.has(path)) {
          errors.push({
            field: `${base}.path`,
            message: `duplicate module path ${safeEcho(path)}`,
          });
        } else {
          seenPaths.add(path);
        }
      }
      let kind: ClaimedModuleRef["kind"] | undefined;
      if (entry["kind"] === undefined) {
        errors.push({ field: `${base}.kind`, message: "missing required field kind" });
      } else if (entry["kind"] !== "module" && entry["kind"] !== "package") {
        errors.push({
          field: `${base}.kind`,
          message: `must be "module" or "package", got ${safeEcho(entry["kind"])}`,
        });
      } else {
        kind = entry["kind"];
      }
      let generated: boolean | undefined;
      if (entry["generated"] !== undefined) {
        if (typeof entry["generated"] !== "boolean") {
          errors.push({
            field: `${base}.generated`,
            message: `optional generated assertion must be a boolean, got ${safeEcho(entry["generated"])}`,
          });
        } else {
          generated = entry["generated"];
        }
      }
      if (
        typeof entry["id"] === "string" &&
        entry["id"] !== "" &&
        path !== undefined &&
        kind !== undefined
      ) {
        const mod: ClaimedModuleRef = { id: entry["id"], path, kind };
        if (generated !== undefined) mod.generated = generated;
        modules.push(mod);
      }
    });
  }

  // entrypoints[]
  const entrypoints: string[] = [];
  if (input["entrypoints"] === undefined) {
    errors.push({
      field: "entrypoints",
      message: "missing required field entrypoints",
    });
  } else if (!Array.isArray(input["entrypoints"])) {
    errors.push({
      field: "entrypoints",
      message: `must be an array, got ${safeEcho(input["entrypoints"])}`,
    });
  } else {
    const seen = new Set<string>();
    input["entrypoints"].forEach((entry, i) => {
      const p = validateClaimedPath(entry, `entrypoints[${i}]`, errors, warnings);
      if (p === undefined) return;
      if (seen.has(p)) {
        warnings.push({
          field: `entrypoints[${i}]`,
          message: `duplicate entrypoint ${safeEcho(p)} ignored`,
        });
        return;
      }
      seen.add(p);
      entrypoints.push(p);
    });
  }

  // edges[]
  const edges: { from: string; to: string }[] = [];
  if (input["edges"] === undefined) {
    errors.push({ field: "edges", message: "missing required field edges" });
  } else if (!Array.isArray(input["edges"])) {
    errors.push({
      field: "edges",
      message: `must be an array, got ${safeEcho(input["edges"])}`,
    });
  } else {
    const seen = new Set<string>();
    input["edges"].forEach((entry, i) => {
      const base = `edges[${i}]`;
      if (!isRecord(entry)) {
        errors.push({
          field: base,
          message: `must be an object { from, to }, got ${safeEcho(entry)}`,
        });
        return;
      }
      for (const key of Object.keys(entry)) {
        if (!EDGE_KEYS.has(key)) {
          errors.push({
            field: `${base}.${key}`,
            message: `unknown edge field ${safeEcho(key)} — not part of claimed-map/v1`,
          });
        }
      }
      const from = validateClaimedPath(entry["from"], `${base}.from`, errors, warnings);
      const to = validateClaimedPath(entry["to"], `${base}.to`, errors, warnings);
      if (from === undefined || to === undefined) return;
      const key = `${from}\0${to}`;
      if (seen.has(key)) {
        warnings.push({
          field: base,
          message: `duplicate edge ${safeEcho(from)} -> ${safeEcho(to)} ignored`,
        });
        return;
      }
      seen.add(key);
      edges.push({ from, to });
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  const map: ClaimedMapV1 = {
    schema: CLAIMED_MAP_SCHEMA,
    mapId: mapId as string,
    repo: input["repo"] as string,
    completeness: completeness as Completeness,
    repoSnapshotSha256: snapshot as string,
    modules,
    entrypoints,
    edges,
  };
  if (agent !== undefined) map.agent = agent;
  if (gitCommit !== undefined) map.gitCommit = gitCommit;
  return { ok: true, map, warnings };
}

/**
 * Parse claimed-map JSON text and strictly validate it. A JSON
 * syntax error is itself an input error (exit class 3), never a
 * silent pass.
 */
export function parseClaimedMapJson(
  text: string,
): ClaimedMapValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (e) {
    return {
      ok: false,
      errors: [
        {
          field: "$",
          message: `invalid JSON: ${e instanceof Error ? redactText(e.message) : "parse error"}`,
        },
      ],
      warnings: [],
    };
  }
  return validateClaimedMap(parsed);
}
