/**
 * Claimed-map input contract (PROJECT_BOOK §6.1, IMPLEMENTATION_PLAN §4.1).
 *
 * A claimed map is the agent's asserted view of a repo: module list,
 * entrypoints and dependency edges. v1 covers STATIC import graphs only —
 * no data-flow, function-call-path or business-flow claims.
 */

export const CLAIMED_MAP_SCHEMA = "repomapverify.claimed-map/v1" as const;

/**
 * Completeness declaration (P0 fix #1, spec v1.1.0).
 * - FULL_GRAPH: the map claims to be the complete graph. Missing edges,
 *   missing modules and unclaimed reachable modules MAY be reported.
 * - PARTIAL_SUBGRAPH: a context-clipped subgraph (e.g. Aider Repo Map,
 *   token-budget clipped). Only already-declared edges/modules are
 *   verified; absence of an edge/module is NEVER a finding.
 */
export type Completeness = "FULL_GRAPH" | "PARTIAL_SUBGRAPH";

export type ClaimedModuleKind = "module" | "package";

export interface ClaimedModuleRef {
  /** Agent-assigned id inside the map (NOT the ground-truth module_id). */
  id: string;
  /** Relative path as claimed by the agent (Python/TS: file; Go: package dir). */
  path: string;
  kind: ClaimedModuleKind;
  /**
   * OPTIONAL generated-ness assertion (added T008; decision record:
   * 03_evidence/T008/GENERATED_MISMATCH_DECISION.md).
   * - `true`: the agent asserts this module is generated code.
   * - `false`: the agent asserts it is hand-written.
   * - absent: NO assertion — module-level GENERATED_MISMATCH is not
   *   judged for this module (the v1 default; all pre-T008 fixtures
   *   omit it, so existing maps keep validating and the S0 gate is
   *   unaffected). The comparator's edge-level GENERATED_MISMATCH
   *   rule (T006) is unchanged; the module-level rule was implemented
   *   by FIX T013 (P2-01) in src/comparator/compare.ts (Rule 2) and
   *   mirrored in the Oracle audit (oracle/python/oracle.py).
   */
  generated?: boolean;
}

export interface ClaimedEdge {
  /** Claimed source module, by relative path (see ClaimedModuleRef.path). */
  from: string;
  /** Claimed target module, by relative path. */
  to: string;
}

export interface ClaimedMapV1 {
  schema: typeof CLAIMED_MAP_SCHEMA;
  mapId: string;
  repo: string;
  agent?: string;
  /** REQUIRED. Missing / unknown value => usage/input error (exit 3). */
  completeness: Completeness;
  /**
   * REQUIRED. SHA-256 of the full working-tree snapshot the map was built
   * against (P0 fix #2). A git commit alone is NOT sufficient: uncommitted
   * changes are not in HEAD.
   */
  repoSnapshotSha256: string;
  /** Git commit, when the repo is a git checkout. Optional. */
  gitCommit?: string;
  modules: ClaimedModuleRef[];
  /** Claimed entrypoints; MUST agree with .repomapverify.toml when present. */
  entrypoints: string[];
  edges: ClaimedEdge[];
}
