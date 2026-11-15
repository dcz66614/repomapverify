/**
 * T005 — Ground-truth graph types (PROJECT_BOOK §4.1, §6.2; PLAN T005).
 *
 * The graph is built ONLY from extractor output + the declared
 * `.repomapverify.toml` entrypoints. It never infers entrypoints from
 * graph roots: `entrypointCandidates` (in-degree-0 modules) is computed
 * for information only and is never used for reachability.
 */
import type { GroundTruthEdge, ModuleV1 } from "../contracts/module.js";
import type {
  DuplicateContentGroup,
  IdentityConflict,
  IdentityFile,
} from "../identity/registry.js";

/** One module as handed to the builder (extractor output, pre-merge). */
export interface GraphModuleInput {
  module: ModuleV1;
  /** Go package constituent files (sorted internally), if any. */
  files?: IdentityFile[];
  /** Physical path (realpath) of the file / package directory, when known. */
  realPath?: string;
}

/** One core edge, identified by module_ids (the contract edge identity). */
export interface GraphEdgeInput {
  fromModuleId: string;
  toModuleId: string;
  conditional?: boolean;
  typeOnly?: boolean;
}

/** An alias spelling discovered by a repo scan (not by an extractor). */
export interface GraphAliasInput {
  language: GraphModuleInput["module"]["language"];
  aliasRelativePath: string;
  /** Physical path (realpath) of the alias target — must be inside the repo. */
  realPath: string;
}

export interface BuildGraphInput {
  modules: GraphModuleInput[];
  /** Core edges only (generated-code edges are evidence elsewhere, not here). */
  edges: GraphEdgeInput[];
  /**
   * Declared entrypoint paths from `.repomapverify.toml`, repo-relative
   * file paths (Go: a file path inside the package directory). The ONLY
   * authority for entrypoints. Empty / absent = no entrypoints.
   */
  entrypointPaths: string[];
  /**
   * `.repomapverify.toml` exists at the repo root but could not be
   * read: the entrypoint declaration is UNKNOWN, not absent
   * (fail-closed, FIX P024 R1 P1-01 follow-up). The builder records
   * it on the BuiltGraph so the comparator can force INCOMPLETE
   * instead of auditing as if no entrypoints were declared.
   */
  entrypointsDeclarationUnreadable?: boolean;
  /**
   * TypeScript resolution configs that exist at the repo root but
   * could not be read or parsed (FIX P024 R2 P1-01): the config
   * content is UNKNOWN, not absent. The builder records them on the
   * BuiltGraph so the comparator can force INCOMPLETE with a
   * SOURCE_NOT_ENUMERATED finding per file instead of auditing as
   * if the repo had no tsconfig / package.json. Empty / absent =
   * every config present was readable (or no config exists).
   */
  typescriptConfigProblems?: TypeScriptConfigProblem[];
  /** Alias spellings found by a repo scan (symlinks the extractors missed). */
  aliases?: GraphAliasInput[];
  externalImportCount?: number;
  repoSnapshotSha256?: string;
  gitCommit?: string;
}

/** An edge the builder dropped instead of silently keeping. */
export interface DroppedEdge {
  fromModuleId: string;
  toModuleId: string;
  reason: "UNKNOWN_ENDPOINT" | "SELF_EDGE" | "CONFLICT_DROPPED_ENDPOINT";
}

/**
 * FIX P024 R2 P1-01: one repo-root TypeScript resolution config file
 * that exists but could not be read ("UNREADABLE", e.g. EACCES) or
 * parsed ("MALFORMED", e.g. invalid JSON). Its content is UNKNOWN,
 * not absent — alias / self-reference resolution that may depend on
 * it cannot be trusted, so the audit must be INCOMPLETE.
 */
export interface TypeScriptConfigProblem {
  file: "tsconfig.json" | "package.json";
  status: "UNREADABLE" | "MALFORMED";
}

/** The built ground-truth graph plus the T005 bookkeeping around it. */
export interface BuiltGraph {
  /** Contract ground-truth graph (Maps/Sets, module_id-keyed). */
  graph: {
    modules: Map<string, ModuleV1>;
    edges: Map<string, GroundTruthEdge>;
    reachableFromEntrypoints: Set<string>;
    isolatedModuleIds: Set<string>;
    externalImportCount: number;
    repoSnapshotSha256: string;
    gitCommit?: string;
  };
  /** Declared entrypoint module_ids (resolved from entrypointPaths). */
  declaredEntrypoints: string[];
  /** Declared entrypoint paths as written in the toml (normalized). */
  declaredEntrypointPaths: string[];
  /** Declared entrypoint paths that resolve to no module in the graph. */
  unresolvedEntrypoints: string[];
  /**
   * `.repomapverify.toml` exists but could not be read: the
   * entrypoint declaration is UNKNOWN, not absent (fail-closed, FIX
   * P024 R1 P1-01 follow-up). Present ONLY when true — absent/false
   * means the file was readable or does not exist, exactly as
   * before. The comparator forces INCOMPLETE when this is set.
   */
  entrypointsDeclarationUnreadable?: boolean;
  /**
   * TypeScript resolution configs that exist but could not be read
   * or parsed (FIX P024 R2 P1-01): their content is UNKNOWN, not
   * absent. Present ONLY when non-empty — absent means every config
   * present was readable, or no config exists, exactly as before.
   * The comparator forces INCOMPLETE with one
   * SOURCE_NOT_ENUMERATED finding per entry when this is set.
   */
  typescriptConfigProblems?: TypeScriptConfigProblem[];
  /**
   * In-degree-0 module paths (sorted). INFORMATIONAL ONLY: these are
   * candidates, never entrypoints, and never drive reachability.
   */
  entrypointCandidates: string[];
  /** moduleId -> alias spellings (sorted), only for modules that have any. */
  aliases: Map<string, string[]>;
  /** Distinct modules sharing one content hash (DUPLICATE_CONTENT signal). */
  duplicateContent: DuplicateContentGroup[];
  /** Identity-key collisions (adapter folding vs filesystem reality). */
  conflicts: IdentityConflict[];
  /** Edges dropped by the builder, with reasons (never silent). */
  droppedEdges: DroppedEdge[];
  /** Human-readable notes (e.g. snapshot absent, alias merges applied). */
  notes: string[];
}
