/**
 * Ground-truth graph and audit-report contracts (PROJECT_BOOK §6.2–§6.3,
 * IMPLEMENTATION_PLAN §4.2–§4.3).
 */
import type { Finding, AuditStatus } from "./findings.js";
import type { GroundTruthEdge, ModuleV1 } from "./module.js";
import type { Completeness } from "./claimed-map.js";

export const REPORT_SCHEMA = "repomapverify.report/v1" as const;

/** The real, statically computed import graph of a repo. */
export interface GroundTruthGraph {
  /** Modules keyed by module_id. */
  modules: Map<string, ModuleV1>;
  /** Import edges, keyed by `${fromModuleId}\0${toModuleId}`. */
  edges: Map<string, GroundTruthEdge>;
  /** Module ids reachable from the declared entrypoints. */
  reachableFromEntrypoints: Set<string>;
  /** Module ids reachable from no entrypoint (report info, not a FAIL). */
  isolatedModuleIds: Set<string>;
  /** Imports of third-party / stdlib code: counted, not verified. */
  externalImportCount: number;
  /** SHA-256 of the working-tree snapshot this graph was computed from. */
  repoSnapshotSha256: string;
  /** Git commit (HEAD) when the repo is a git checkout. */
  gitCommit?: string;
}

export function edgeKey(fromModuleId: string, toModuleId: string): string {
  return `${fromModuleId}\0${toModuleId}`;
}

export interface Coverage {
  verifiedClaims: number;
  totalClaims: number;
}

export interface AuditReportV1 {
  schema: typeof REPORT_SCHEMA;
  mapId: string;
  status: AuditStatus;
  /** Completeness mode the map declared (drives which findings apply). */
  completeness: Completeness;
  /** Snapshot agreement between the map and the audited repo. */
  snapshotStatus: "MATCH" | "STALE_SNAPSHOT";
  groundTruth: { modules: number; edges: number };
  claimed: { modules: number; edges: number };
  coverage: Coverage;
  findings: Finding[];
}
