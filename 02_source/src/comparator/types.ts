/**
 * T006 — Comparator input evidence types
 * (PROJECT_BOOK §5.1–§5.2; IMPLEMENTATION_PLAN T006).
 *
 * The comparator's primary inputs are a `BuiltGraph` (T005: modules,
 * edges, reachability, aliases, duplicateContent, conflicts,
 * droppedEdges, unresolvedEntrypoints, entrypointCandidates) and a
 * `ClaimedMapV1`. The built graph alone does not carry everything the
 * finding rules need: dynamic-import sites, unresolvable imports and
 * generated-code edges live in the extractor results, not in the core
 * graph (generated edges are deliberately excluded from the core).
 * Those are passed in here, as `ComparatorEvidence`, so the comparator
 * stays a pure function over explicit inputs. Every field is optional
 * and defaults to empty — a caller that has no extractor evidence
 * gets an audit over the graph alone (dynamic/unknown/generated rules
 * simply have nothing to fire on), never a silent guess.
 *
 * All paths in the evidence are repo-relative POSIX paths (Go:
 * package directories, e.g. "internal/app", "." for the root package),
 * in the same spelling the extractors use.
 */
export interface DynamicUnknownRef {
  /** Module containing the dynamic import, repo-relative path. */
  path: string;
  /** 1-based line of the dynamic call, when known. */
  line?: number;
  /** Exact source text of the dynamic call, when known. */
  statement?: string;
  /** What was found, e.g. IMPORTLIB_VARIABLE, DUNDER_IMPORT_VARIABLE. */
  kind?: string;
}

export interface UnknownImportRef {
  /** Importing module, repo-relative path. */
  from: string;
  /** Specifier / import path as written or as resolved. */
  specifier: string;
  /**
   * Extractor reason string, e.g. UNRESOLVABLE_REPO_LOCAL,
   * RELATIVE_ESCAPE, ALIAS_NOT_RESOLVED, TARGET_NOT_FOUND,
   * DYNAMIC_IMPORT_UNKNOWN, PARSE_ERROR, NO_GO_MOD,
   * UNDECIDABLE_BUILD_CONSTRAINT. The single reason value
   * "DYNAMIC_IMPORT_UNKNOWN" marks a dynamic import whose target
   * cannot be determined statically (TypeScript path); it yields a
   * DYNAMIC_IMPORT_UNKNOWN finding, like a DynamicUnknownRef entry.
   */
  reason: string;
  /** 1-based line, when known. */
  line?: number;
  /** Exact source text, when known. */
  statement?: string;
}

/** One edge that exists only in generated code (excluded from core). */
export interface GeneratedEdgeRef {
  from: string;
  to: string;
}

export interface ComparatorEvidence {
  /** Modules with unresolvable dynamic imports (=> INCOMPLETE). */
  dynamicUnknowns?: DynamicUnknownRef[];
  /**
   * Imports that could not be resolved to a repo module. Any entry
   * forces INCOMPLETE (never PASS); an entry with reason
   * "DYNAMIC_IMPORT_UNKNOWN" additionally yields a
   * DYNAMIC_IMPORT_UNKNOWN finding. There is no dedicated finding
   * type for a plain unresolvable import — the Oracle and the S0
   * gate agree on this: the audit status carries the unknown, and
   * no finding is invented for it.
   */
  unknownImports?: UnknownImportRef[];
  /**
   * Edges whose endpoint is generated code (kept as evidence by the
   * extractors, excluded from the core graph). A claimed edge that
   * matches one of these is GENERATED_MISMATCH, not
   * HALLUCINATED_EDGE: the edge exists, but only in generated code
   * (spec §4.3/§4.4/§4.5: "声称地图引用它时仍须核验存在性").
   */
  generatedEdges?: GeneratedEdgeRef[];
}
