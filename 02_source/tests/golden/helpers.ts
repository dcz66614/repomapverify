/**
 * T011 shared test helpers (PROJECT_BOOK §10.2; PLAN T011).
 *
 * Shared by tests/golden (regression) and tests/mutation (mutation
 * runner): loading a fixture claimed map, assembling comparator
 * evidence from the production extractors, and independent
 * (test-side, node:crypto) recomputation of module_id /
 * content_sha256 / snapshot hashes from file bytes — never taken
 * from production output.
 *
 * Nothing here reads the Oracle or the S0 gate: the golden
 * regression compares production output against the hand-written
 * golden.json / expected.json files field-by-field.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { extractPythonRepo } from "../../src/extractors/python/index.js";
import { extractTypeScriptRepo } from "../../src/extractors/typescript/index.js";
import { extractGoRepo } from "../../src/extractors/go/index.js";
import type { ComparatorEvidence } from "../../src/comparator/types.js";
import type { ClaimedMapV1 } from "../../src/contracts/claimed-map.js";

export interface GoldenFinding {
  id: string;
  from?: string;
  to?: string;
}

/** SHA-256 hex of a UTF-8 string (test-side recomputation). */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** SHA-256 hex of raw file bytes (test-side recomputation). */
export function sha256File(absPath: string): string {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

/**
 * Independent module_id: SHA256(language + NUL + normalized path),
 * per the frozen contract (PROJECT_BOOK §4.2). Normalization here
 * is NFC + POSIX slashes + "./" strip, mirroring the contract's
 * normalizeRelativePath without importing its hash function.
 */
export function expectedModuleId(language: string, relativePath: string): string {
  const normalized = relativePath
    .normalize("NFC")
    .replace(/\\/g, "/")
    .split("/")
    .filter((seg) => seg !== "" && seg !== ".")
    .join("/");
  return sha256Hex(`${language}\0${normalized}`);
}

/**
 * Independent snapshot hash: SHA-256 over sorted lines
 * `relativePath + NUL + contentSha256 + "\n"` (frozen T008
 * algorithm, re-implemented here from the words in
 * src/canonical/index.ts — not by calling the production function).
 */
export function expectedSnapshotSha256(
  files: ReadonlyArray<{ relativePath: string; contentSha256: string }>,
): string {
  const lines = [...files]
    .map((f) => ({
      relativePath: f.relativePath.normalize("NFC"),
      contentSha256: f.contentSha256,
    }))
    .sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0))
    .map((f) => `${f.relativePath}\0${f.contentSha256}\n`);
  return sha256Hex(lines.join(""));
}

export function findingKey(f: GoldenFinding): string {
  return `${f.id}\0${f.from ?? ""}\0${f.to ?? ""}`;
}

export const sortStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Sort a list of JSON values by their canonical encoding (keys sorted recursively, so object key order never matters). */
export function sortedJson(arr: unknown[]): string[] {
  return arr.map((v) => JSON.stringify(sortDeep(v))).sort();
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

/** Canonical encoding of one JSON value (keys sorted recursively). */
export function canon(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

/**
 * Load a fixture claimed-map.json, normalizing the known
 * `map_id` / `mapId` spelling inconsistency (same normalization
 * as tests/comparator/golden.test.ts).
 */
export function loadClaimed(dir: string): ClaimedMapV1 {
  const raw = JSON.parse(readFileSync(join(dir, "claimed-map.json"), "utf8"));
  return {
    schema: "repomapverify.claimed-map/v1",
    mapId: raw.mapId ?? raw.map_id,
    repo: raw.repo ?? "",
    ...(raw.agent !== undefined ? { agent: raw.agent } : {}),
    completeness: raw.completeness,
    repoSnapshotSha256: raw.repoSnapshotSha256,
    ...(raw.gitCommit !== undefined ? { gitCommit: raw.gitCommit } : {}),
    modules: (raw.modules ?? []).map((m: { id: string; path: string; kind: string }) => ({
      id: m.id,
      path: m.path,
      kind: m.kind as "module" | "package",
    })),
    entrypoints: raw.entrypoints ?? [],
    edges: (raw.edges ?? []).map((e: { from: string; to: string }) => ({
      from: e.from,
      to: e.to,
    })),
  };
}

/** Load a claimed map from a parsed JSON object (mutation copies). */
export function loadClaimedFromObject(raw: Record<string, unknown>): ClaimedMapV1 {
  return {
    schema: "repomapverify.claimed-map/v1",
    mapId: (raw.mapId ?? raw.map_id) as string,
    repo: (raw.repo ?? "") as string,
    ...(raw.agent !== undefined ? { agent: raw.agent as string } : {}),
    completeness: raw.completeness as "FULL_GRAPH" | "PARTIAL_SUBGRAPH",
    repoSnapshotSha256: raw.repoSnapshotSha256 as string,
    ...(raw.gitCommit !== undefined ? { gitCommit: raw.gitCommit as string } : {}),
    modules: ((raw.modules ?? []) as { id: string; path: string; kind: string }[]).map((m) => ({
      id: m.id,
      path: m.path,
      kind: m.kind as "module" | "package",
    })),
    entrypoints: (raw.entrypoints ?? []) as string[],
    edges: ((raw.edges ?? []) as { from: string; to: string }[]).map((e) => ({
      from: e.from,
      to: e.to,
    })),
  };
}

/** Comparator evidence assembled from a fresh extractor run. */
export async function evidenceFor(
  language: string,
  repoDir: string,
): Promise<ComparatorEvidence> {
  if (language === "python") {
    const r = await extractPythonRepo(repoDir);
    return {
      dynamicUnknowns: r.dynamicUnknown.map((d) => ({
        path: d.path,
        line: d.line,
        statement: d.statement,
        kind: d.kind,
      })),
      unknownImports: r.unknownImports.map((u) => ({
        from: u.from,
        specifier: u.specifier,
        reason: u.reason,
        line: u.line,
        statement: u.statement,
      })),
      generatedEdges: r.generatedExcludedEdges.map((e) => ({ from: e.from, to: e.to })),
    };
  }
  if (language === "typescript") {
    const r = await extractTypeScriptRepo(repoDir);
    return {
      unknownImports: r.unknowns.map((u) => ({
        from: u.from,
        specifier: u.specifier,
        reason: u.reason,
        ...(u.line !== undefined ? { line: u.line } : {}),
      })),
      generatedEdges: r.generatedEdges.map((e) => ({ from: e.from, to: e.to })),
    };
  }
  const r = await extractGoRepo(repoDir);
  return {
    unknownImports: r.unknowns.map((u) => ({
      from: u.from,
      specifier: u.importPath,
      reason: u.reason,
      line: u.line,
    })),
    generatedEdges: r.generatedEdges.map((e) => ({ from: e.from, to: e.to })),
  };
}

export function listS0Fixtures(langDir: string, fixturesRoot: string): string[] {
  return readdirSync(join(fixturesRoot, langDir))
    .filter((n) => /^(py|ts|go)-/.test(n))
    .sort();
}
