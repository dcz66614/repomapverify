/**
 * T009 — Full audit report model (PROJECT_BOOK §6.3, §7; PLAN T009).
 *
 * `buildFullReport` turns the comparator's result into the report
 * object the CLI writes as JSON and renders as static HTML. The
 * shape keeps the frozen §6.3 core (schema `repomapverify.report/v1`,
 * mapId, status, groundTruth / claimed counts, coverage
 * verified/total, findings with id/severity/from/to) and adds the
 * fields T009 owns:
 *
 * - `infoFindings`: the comparator's separate informational list
 *   (ISOLATED_MODULE / ENTRYPOINT_CANDIDATE / DUPLICATE_CONTENT).
 *   They are NEVER merged into `findings` and NEVER dropped: the
 *   JSON report carries them in their own list and the HTML report
 *   renders them in their own sections (spec §7.1).
 * - `canonicalSemanticHash`: T008's `canonicalSemanticHash` over
 *   the already-normalized, already-redacted semantic core
 *   (volatile fields stripped by construction — no timestamps,
 *   durations, absolute paths or run ids ever enter the report).
 * - `evidenceSha256`: the SHA-256 evidence list — the repo snapshot
 *   hash plus one content SHA-256 per ground-truth module.
 * - `sections`: the §7.1 own-section lists (wrong entrypoints,
 *   unclaimed reachable modules, isolated modules, entrypoint
 *   candidates, duplicate content) derived from findings +
 *   infoFindings, never mixed into the edge list.
 * - `modules` / `edges`: aligned claimed-vs-real detail rows the
 *   HTML report renders side by side (same module / edge aligned,
 *   claimed left, ground truth right).
 * - snake_case aliases (`map_id`, `ground_truth`, `verified_claims`,
 *   `total_claims`): PROJECT_BOOK §6.3 spells the report fields
 *   snake_case while the frozen contract (AuditReportV1) spells
 *   them camelCase — the same tension T008 documented for the
 *   claimed-map input. The report carries BOTH spellings with
 *   identical values so a §6.3 reader and a contract reader agree.
 *
 * Privacy: every string passes through `redactForOutput` with the
 * repo root before hashing and before the report leaves this module,
 * so absolute paths and usernames never appear in either output.
 * The canonical hash is computed AFTER redaction, so it is
 * reproducible from the emitted report itself.
 */
import { canonicalSemanticHash } from "../canonical/index.js";
import type { ClaimedMapV1 } from "../contracts/claimed-map.js";
import type { Finding } from "../contracts/findings.js";
import type { AuditReportV1 } from "../contracts/report.js";
import { normalizeRelativePath } from "../contracts/module.js";
import { compareNormalizedPaths } from "../identity/normalize.js";
import { redactForOutput } from "../privacy/redact.js";
import type { ComparatorResult } from "../comparator/compare.js";
import type { BuiltGraph } from "../graph/types.js";
import type { EdgeEvidence } from "../cli/evidence.js";

export interface ReportModuleDetail {
  /** Normalized repo-relative path (Go: package directory). */
  path: string;
  moduleId: string | null;
  language: string | null;
  nodeKind: string | null;
  contentSha256: string | null;
  isGenerated: boolean | null;
  isEntrypoint: boolean;
  parseStatus: string | null;
  aliases: string[];
  claimed: boolean;
  inGroundTruth: boolean;
  reachable: boolean;
  isolated: boolean;
  inEdgesReal: string[];
  outEdgesReal: string[];
  inEdgesClaimed: string[];
  outEdgesClaimed: string[];
}

export type ReportEdgeStatus =
  | "verified"
  | "hallucinated"
  | "missing"
  | "generated-mismatch";

export interface ReportEdgeDetail {
  from: string;
  to: string;
  claimed: boolean;
  real: boolean;
  status: ReportEdgeStatus;
  /** Source evidence for real edges (file, line, import statement). */
  evidence?: EdgeEvidence;
  claimedJsonPath?: string;
}

export interface ReportDuplicateContentGroup {
  paths: string[];
  contentSha256: string;
}

export interface ReportSections {
  wrongEntrypoints: string[];
  unclaimedReachableModules: string[];
  isolatedModules: string[];
  entrypointCandidates: string[];
  duplicateContent: ReportDuplicateContentGroup[];
}

/** The full JSON report object (also the HTML renderer's input). */
export interface FullReport {
  schema: "repomapverify.report/v1";
  mapId: string;
  /** snake_case alias of mapId (§6.3 spelling). */
  map_id: string;
  status: AuditReportV1["status"];
  completeness: ClaimedMapV1["completeness"];
  snapshotStatus: AuditReportV1["snapshotStatus"];
  groundTruth: { modules: number; edges: number };
  /** snake_case alias of groundTruth (§6.3 spelling). */
  ground_truth: { modules: number; edges: number };
  claimed: { modules: number; edges: number };
  coverage: {
    verifiedClaims: number;
    totalClaims: number;
    verified_claims: number;
    total_claims: number;
  };
  findings: Finding[];
  infoFindings: Finding[];
  canonicalSemanticHash: string;
  evidenceSha256: {
    repoSnapshotSha256: string;
    modules: { path: string; moduleId: string; contentSha256: string }[];
  };
  sections: ReportSections;
  modules: ReportModuleDetail[];
  edges: ReportEdgeDetail[];
  /** Validator warnings for the claimed map (e.g. snake_case aliases). */
  mapWarnings: string[];
}

/** Same spelling the comparator uses: empty normalized path = Go root ".". */
function normalizeClaimPath(p: string): string {
  return normalizeRelativePath(p) || ".";
}

const EMPTY_CONTENT_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface BuildFullReportInput {
  built: BuiltGraph;
  claimed: ClaimedMapV1;
  detailed: ComparatorResult;
  /** Edge source evidence keyed by `${from}\0${to}` (real path pairs). */
  edgeEvidence: ReadonlyMap<string, EdgeEvidence>;
  /** Absolute repo root, for privacy redaction. */
  repoRoot: string;
  /** Validator warnings for the claimed map (may be empty). */
  mapWarnings?: string[];
}

export function buildFullReport(input: BuildFullReportInput): FullReport {
  const { built, claimed, detailed } = input;
  const report = detailed.report;
  const graph = built.graph;

  // Spelling map: canonical path + every alias spelling -> canonical path.
  const spellingToCanonical = new Map<string, string>();
  for (const m of graph.modules.values()) {
    spellingToCanonical.set(m.relativePath, m.relativePath);
    for (const alias of built.aliases.get(m.moduleId) ?? []) {
      spellingToCanonical.set(alias, m.relativePath);
    }
  }
  const resolveClaimed = (p: string): string | undefined => {
    const n = normalizeClaimPath(p);
    return spellingToCanonical.get(n);
  };

  // Claimed modules / edges, normalized + deduplicated (same rule as
  // the comparator: first JSON index wins; claimedJsonPath kept).
  const claimedModulePaths = new Map<string, number>();
  claimed.modules.forEach((m, i) => {
    const p = normalizeClaimPath(m.path);
    if (!claimedModulePaths.has(p)) claimedModulePaths.set(p, i);
  });
  const claimedEdgePairs = new Map<string, { from: string; to: string; jsonIndex: number }>();
  claimed.edges.forEach((e, i) => {
    const from = normalizeClaimPath(e.from);
    const to = normalizeClaimPath(e.to);
    const key = `${from}\0${to}`;
    if (!claimedEdgePairs.has(key)) claimedEdgePairs.set(key, { from, to, jsonIndex: i });
  });

  const claimedCanonicalModules = new Set<string>();
  for (const p of claimedModulePaths.keys()) {
    const hit = resolveClaimed(p);
    if (hit !== undefined) claimedCanonicalModules.add(hit);
  }

  // Real edges as path pairs.
  const realEdgePairs = new Map<string, { from: string; to: string }>();
  for (const e of graph.edges.values()) {
    const from = graph.modules.get(e.fromModuleId)?.relativePath;
    const to = graph.modules.get(e.toModuleId)?.relativePath;
    if (from === undefined || to === undefined) continue;
    realEdgePairs.set(`${from}\0${to}`, { from, to });
  }

  // Claimed edges resolved to canonical paths where possible, so a
  // claim written with an alias spelling aligns with the real edge.
  const claimedCanonicalPairs = new Map<string, { from: string; to: string; jsonIndex: number }>();
  for (const [key, e] of claimedEdgePairs) {
    const fromHit = resolveClaimed(e.from);
    const toHit = resolveClaimed(e.to);
    const canonicalKey =
      fromHit !== undefined && toHit !== undefined
        ? `${fromHit}\0${toHit}`
        : key;
    if (!claimedCanonicalPairs.has(canonicalKey)) {
      claimedCanonicalPairs.set(canonicalKey, {
        from: fromHit ?? e.from,
        to: toHit ?? e.to,
        jsonIndex: e.jsonIndex,
      });
    }
  }

  const generatedMismatchPairs = new Set(
    report.findings
      .filter((f) => f.id === "GENERATED_MISMATCH")
      .map((f) => `${f.from ?? ""}\0${f.to ?? ""}`),
  );

  // ---- modules detail (union of real + hallucinated claimed) ----
  const pathOf = (id: string): string | undefined =>
    graph.modules.get(id)?.relativePath;
  const reachablePaths = new Set(
    [...graph.reachableFromEntrypoints]
      .map(pathOf)
      .filter((p): p is string => p !== undefined),
  );
  const isolatedPaths = new Set(
    [...graph.isolatedModuleIds]
      .map(pathOf)
      .filter((p): p is string => p !== undefined),
  );

  const inReal = new Map<string, string[]>();
  const outReal = new Map<string, string[]>();
  for (const { from, to } of realEdgePairs.values()) {
    outReal.set(from, [...(outReal.get(from) ?? []), to]);
    inReal.set(to, [...(inReal.get(to) ?? []), from]);
  }
  const inClaimed = new Map<string, string[]>();
  const outClaimed = new Map<string, string[]>();
  for (const { from, to } of claimedCanonicalPairs.values()) {
    outClaimed.set(from, [...(outClaimed.get(from) ?? []), to]);
    inClaimed.set(to, [...(inClaimed.get(to) ?? []), from]);
  }
  const sortPaths = (xs: string[]): string[] => [...xs].sort(compareNormalizedPaths);

  const modules: ReportModuleDetail[] = [];
  for (const m of [...graph.modules.values()].sort((a, b) =>
    compareNormalizedPaths(a.relativePath, b.relativePath),
  )) {
    modules.push({
      path: m.relativePath,
      moduleId: m.moduleId,
      language: m.language,
      nodeKind: m.nodeKind,
      contentSha256: m.contentSha256,
      isGenerated: m.isGenerated,
      isEntrypoint: m.isEntrypoint,
      parseStatus: m.parseStatus,
      aliases: sortPaths([...(built.aliases.get(m.moduleId) ?? [])]),
      claimed: claimedCanonicalModules.has(m.relativePath),
      inGroundTruth: true,
      reachable: reachablePaths.has(m.relativePath),
      isolated: isolatedPaths.has(m.relativePath),
      inEdgesReal: sortPaths(inReal.get(m.relativePath) ?? []),
      outEdgesReal: sortPaths(outReal.get(m.relativePath) ?? []),
      inEdgesClaimed: sortPaths(inClaimed.get(m.relativePath) ?? []),
      outEdgesClaimed: sortPaths(outClaimed.get(m.relativePath) ?? []),
    });
  }
  // Hallucinated claimed modules: claimed, not real — shown with no
  // ground-truth detail so the two panes stay aligned.
  const hallucinatedPaths = [...claimedModulePaths.keys()]
    .filter((p) => resolveClaimed(p) === undefined)
    .sort(compareNormalizedPaths);
  for (const p of hallucinatedPaths) {
    modules.push({
      path: p,
      moduleId: null,
      language: null,
      nodeKind: null,
      contentSha256: null,
      isGenerated: null,
      isEntrypoint: false,
      parseStatus: null,
      aliases: [],
      claimed: true,
      inGroundTruth: false,
      reachable: false,
      isolated: false,
      inEdgesReal: [],
      outEdgesReal: [],
      inEdgesClaimed: sortPaths(inClaimed.get(p) ?? []),
      outEdgesClaimed: sortPaths(outClaimed.get(p) ?? []),
    });
  }
  modules.sort((a, b) => compareNormalizedPaths(a.path, b.path));

  // ---- edges detail (union of real + claimed) ----
  const edgeKeys = new Set([...realEdgePairs.keys(), ...claimedCanonicalPairs.keys()]);
  const edges: ReportEdgeDetail[] = [];
  for (const key of [...edgeKeys].sort()) {
    const real = realEdgePairs.get(key);
    const claimedEdge = claimedCanonicalPairs.get(key);
    const from = real?.from ?? claimedEdge?.from ?? key.split("\0")[0] ?? "";
    const to = real?.to ?? claimedEdge?.to ?? key.split("\0")[1] ?? "";
    let status: ReportEdgeStatus;
    if (real !== undefined && claimedEdge !== undefined) status = "verified";
    else if (claimedEdge !== undefined) {
      status = generatedMismatchPairs.has(`${claimedEdge.from}\0${claimedEdge.to}`)
        ? "generated-mismatch"
        : "hallucinated";
    } else status = "missing";
    const detail: ReportEdgeDetail = {
      from,
      to,
      claimed: claimedEdge !== undefined,
      real: real !== undefined,
      status,
    };
    const evidence = input.edgeEvidence.get(key);
    if (evidence !== undefined) detail.evidence = evidence;
    if (claimedEdge !== undefined) {
      detail.claimedJsonPath = `edges[${claimedEdge.jsonIndex}]`;
    }
    edges.push(detail);
  }

  // ---- §7.1 own sections (never mixed into the edge list) ----
  const fromList = (id: string): string[] =>
    report.findings
      .filter((f) => f.id === id)
      .map((f) => f.from ?? "")
      .filter((p) => p !== "")
      .sort(compareNormalizedPaths);
  const infoFromList = (id: string): string[] =>
    detailed.infoFindings
      .filter((f) => f.id === id)
      .map((f) => f.from ?? "")
      .filter((p) => p !== "")
      .sort(compareNormalizedPaths);
  const sections: ReportSections = {
    wrongEntrypoints: fromList("WRONG_ENTRYPOINT"),
    unclaimedReachableModules: fromList("UNCLAIMED_REACHABLE_MODULE"),
    isolatedModules: infoFromList("ISOLATED_MODULE"),
    entrypointCandidates: infoFromList("ENTRYPOINT_CANDIDATE"),
    duplicateContent: built.duplicateContent
      .filter((g) => g.contentSha256 !== EMPTY_CONTENT_SHA256)
      .map((g) => ({
        paths: sortPaths([...g.relativePaths]),
        contentSha256: g.contentSha256,
      }))
      .sort((a, b) => (a.contentSha256 < b.contentSha256 ? -1 : 1)),
  };

  const evidenceModules = [...graph.modules.values()]
    .map((m) => ({
      path: m.relativePath,
      moduleId: m.moduleId,
      contentSha256: m.contentSha256,
    }))
    .sort((a, b) => compareNormalizedPaths(a.path, b.path));

  // ---- core (semantic, redacted first, then hashed) ----
  const core = {
    schema: "repomapverify.report/v1" as const,
    mapId: claimed.mapId,
    map_id: claimed.mapId,
    status: report.status,
    completeness: claimed.completeness,
    snapshotStatus: report.snapshotStatus,
    groundTruth: report.groundTruth,
    ground_truth: report.groundTruth,
    claimed: report.claimed,
    coverage: {
      verifiedClaims: report.coverage.verifiedClaims,
      totalClaims: report.coverage.totalClaims,
      verified_claims: report.coverage.verifiedClaims,
      total_claims: report.coverage.totalClaims,
    },
    findings: report.findings,
    infoFindings: detailed.infoFindings,
    evidenceSha256: {
      repoSnapshotSha256: graph.repoSnapshotSha256,
      modules: evidenceModules,
    },
    sections,
    modules,
    edges,
    mapWarnings: (input.mapWarnings ?? []).map((w) => w),
  };
  const redactedCore = redactForOutput(core, {
    repoRoot: input.repoRoot,
  }) as typeof core;
  const hash = canonicalSemanticHash(redactedCore, { repoRoot: input.repoRoot });

  return { ...redactedCore, canonicalSemanticHash: hash } as FullReport;
}
