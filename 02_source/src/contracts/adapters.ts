/**
 * Input-adapter contract (PROJECT_BOOK §6.5, IMPLEMENTATION_PLAN §4.5).
 *
 * v1 accepts four input shapes, all normalized to the internal
 * claimed-map representation (ClaimedMapV1) before comparison:
 *
 * - claimed-map/v1 JSON — the native format.
 * - Graphify graph.json — Graphify's deterministic AST graph output.
 *   Graphify marks edges EXTRACTED vs INFERRED; only EXTRACTED edges
 *   are treated as claims (INFERRED edges are not verifiable static
 *   import claims and must not be passed through as claimed edges).
 * - Understand-Anything .ua graph data — its Tree-sitter + LLM graph.
 *   Only statically extracted edges are claims; LLM-inferred relations
 *   are out of scope for v1 static-import verification.
 * - Aider Repo Map — ALWAYS mapped to PARTIAL_SUBGRAPH, regardless of
 *   what the input says: Aider selects files/symbols by token budget,
 *   so absence of an edge in it is never a missing-edge finding.
 *
 * Adapters are implemented in src/adapters (T002 PoC, T008 complete);
 * this contract freezes only the mapping rules.
 */

export type AdapterKind =
  | "claimed-map-v1"
  | "graphify"
  | "understand-anything"
  | "aider-repo-map";

/**
 * Completeness forced by the adapter, if any. Aider Repo Map forces
 * PARTIAL_SUBGRAPH; all other adapters preserve the input's declaration
 * (which must itself be present and valid).
 */
export function forcedCompleteness(
  kind: AdapterKind,
): "PARTIAL_SUBGRAPH" | undefined {
  return kind === "aider-repo-map" ? "PARTIAL_SUBGRAPH" : undefined;
}
