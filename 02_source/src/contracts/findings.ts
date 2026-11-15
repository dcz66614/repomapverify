/**
 * Finding taxonomy and audit outcome contract (PROJECT_BOOK §5.1–§5.2,
 * IMPLEMENTATION_PLAN T006).
 *
 * 12 finding types. Severities are the spec defaults; the comparator
 * (T006) applies them. INCOMPLETE is never folded into PASS, and a
 * report may list confirmed FAIL findings alongside unresolved UNKNOWNs.
 */

/** Overall audit outcome. INCOMPLETE is a third state, not a pass. */
export type AuditStatus = "PASS" | "FAIL" | "INCOMPLETE";

export const EXIT_CODES = {
  PASS: 0,
  FAIL: 1,
  INCOMPLETE: 2,
  USAGE_ERROR: 3,
} as const;

export type FindingId =
  | "HALLUCINATED_EDGE"
  | "HALLUCINATED_MODULE"
  | "WRONG_ENTRYPOINT"
  | "MISSING_EDGE"
  | "UNCLAIMED_REACHABLE_MODULE"
  | "ISOLATED_MODULE"
  | "ENTRYPOINT_CANDIDATE"
  | "NAME_COLLISION_CONFUSION"
  | "DYNAMIC_IMPORT_UNKNOWN"
  | "SOURCE_NOT_ENUMERATED"
  | "DUPLICATE_CONTENT"
  | "GENERATED_MISMATCH";

export type FindingSeverity = "P1" | "P2" | "INFO";

/** Spec-default severity per finding type (PROJECT_BOOK §5.2). */
export const FINDING_DEFAULT_SEVERITY: Record<FindingId, FindingSeverity> = {
  HALLUCINATED_EDGE: "P1",
  HALLUCINATED_MODULE: "P1",
  WRONG_ENTRYPOINT: "P1",
  MISSING_EDGE: "P2",
  UNCLAIMED_REACHABLE_MODULE: "P2",
  ISOLATED_MODULE: "P2", // information only; does NOT by itself trigger FAIL
  ENTRYPOINT_CANDIDATE: "INFO", // hint only; never WRONG_ENTRYPOINT
  NAME_COLLISION_CONFUSION: "P1",
  DYNAMIC_IMPORT_UNKNOWN: "P1", // also forces INCOMPLETE
  SOURCE_NOT_ENUMERATED: "P1", // also forces INCOMPLETE
  DUPLICATE_CONTENT: "P2",
  GENERATED_MISMATCH: "P2",
};

/**
 * Findings that only apply under FULL_GRAPH completeness. Under
 * PARTIAL_SUBGRAPH the comparator MUST NOT emit them: absence of an
 * edge/module in a clipped map is not an error.
 */
export const FULL_GRAPH_ONLY_FINDINGS: ReadonlySet<FindingId> = new Set([
  "MISSING_EDGE",
  "UNCLAIMED_REACHABLE_MODULE",
]);

/**
 * Findings that force the audit outcome to INCOMPLETE (unless a
 * confirmed FAIL finding is also present, in which case the report
 * carries both). Unknown is never a pass.
 */
export const INCOMPLETE_FORCING_FINDINGS: ReadonlySet<FindingId> = new Set([
  "DYNAMIC_IMPORT_UNKNOWN",
  "SOURCE_NOT_ENUMERATED",
]);

export interface Finding {
  id: FindingId;
  severity: FindingSeverity;
  /** Repo-relative source path (or package dir for Go), when applicable. */
  from?: string;
  /** Repo-relative target path (or package dir for Go), when applicable. */
  to?: string;
  /** Human-readable evidence, with source file + line where available. */
  detail: string;
  /** JSON path into the claimed map, when the finding concerns a claim. */
  claimedJsonPath?: string;
}
