/**
 * Python extractor result types (T002; PROJECT_BOOK §4.3, §6.2).
 *
 * The extractor produces the ground-truth import graph of a Python repo
 * from static analysis only. It never executes repo code.
 *
 * Edge evidence is the source file, 1-based line number and the exact
 * import statement text — the Golden Expected Graphs compare these
 * field-by-field.
 */
import type { ModuleV1 } from "../../contracts/module.js";

/** One statically verified import edge, with its source evidence. */
export interface PythonEdge {
  /** Importing module, repo-relative POSIX path. */
  from: string;
  /** Imported module, repo-relative POSIX path. */
  to: string;
  /** True when the import sits inside try/except or an if TYPE_CHECKING block. */
  conditional: boolean;
  /** True when the import exists only for type checking (TYPE_CHECKING block). */
  typeOnly: boolean;
  /** Source evidence: 1-based line + exact statement text. */
  evidence: { line: number; statement: string };
}

/** An import the extractor could not resolve to a repo module. */
export interface UnknownImport {
  /** Importing module, repo-relative POSIX path. */
  from: string;
  /** Dotted name as resolved (absolute form), e.g. "billing.refunds". */
  specifier: string;
  reason:
    | "UNRESOLVABLE_REPO_LOCAL"
    | "RELATIVE_ESCAPE"
    | "RELATIVE_NO_PACKAGE"
    // FIX P024 R1 P1-01: a directory that could not be listed (or a
    // path that could not be enumerated at all). The `from` is the
    // directory path, `specifier` is "" and `statement` names the
    // directory; the Oracle emits the identical entry.
    | "UNREADABLE";
  /** Source evidence: 1-based line + exact statement text. */
  line: number;
  statement: string;
}

/** A module whose dynamic imports cannot be statically determined. */
export interface DynamicUnknown {
  /** Module containing the dynamic import, repo-relative POSIX path. */
  path: string;
  /** 1-based line of the dynamic call. */
  line: number;
  /** Exact source text of the dynamic call statement. */
  statement: string;
  /** What was found: variable importlib target, __import__ variable, exec/eval. */
  kind: "IMPORTLIB_VARIABLE" | "DUNDER_IMPORT_VARIABLE" | "EXEC_EVAL_IMPORT";
}

/** An import counted as external (stdlib / third-party), not a repo edge. */
export interface ExternalImport {
  /** Importing module, repo-relative POSIX path. */
  from: string;
  /** Dotted name as written, e.g. "numpy" or "os.path". */
  specifier: string;
  /** 1-based line. */
  line: number;
  /** True when inside try/except or a TYPE_CHECKING block. */
  conditional: boolean;
}

/** Full result of extracting one Python repo. */
export interface PythonExtractionResult {
  /** One entry per .py file found (sorted by relativePath). */
  modules: ModuleV1[];
  /** Verified static import edges (sorted by from, then to). */
  edges: PythonEdge[];
  /** Imports that could not be resolved to a repo module. */
  unknownImports: UnknownImport[];
  /** Modules with unresolvable dynamic imports (=> INCOMPLETE downstream). */
  dynamicUnknown: DynamicUnknown[];
  /** External imports (stdlib / third-party): counted, not verified. */
  externalImports: ExternalImport[];
  /** Edges dropped because an endpoint is GENERATED code (kept as evidence). */
  generatedExcludedEdges: PythonEdge[];
  /** Declared entrypoints from .repomapverify.toml (repo-relative paths). */
  entrypoints: string[];
  /** Repo-relative paths reachable from the entrypoints (incl. package-init closure). */
  reachableFromEntrypoints: string[];
  /** Repo-relative paths reachable from no entrypoint. */
  isolatedModules: string[];
  /**
   * Canonical working-tree snapshot hash (PoC algorithm, T002):
   * SHA-256 over the sorted lines `relativePath + NUL + contentSha256 + "\n"`
   * for every file under the repo root (excluding .git / node_modules /
   * __pycache__ / .venv / venv). The canonical snapshot algorithm is frozen by T005/T008;
   * this PoC form is documented here and used only by the T002 PoC audit.
   */
  repoSnapshotSha256: string;
}

/** Maximum file size parsed by the PoC extractor (1 MiB); larger => TOO_LARGE. */
export const PYTHON_MAX_FILE_BYTES = 1024 * 1024;
