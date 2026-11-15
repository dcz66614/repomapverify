/**
 * T003 — TypeScript extractor (PROJECT_BOOK §4.4; IMPLEMENTATION_PLAN T003).
 *
 * Statically extracts the import graph of a TypeScript repo:
 * - import / export ... from / require() / import() / import = require()
 * - tsconfig paths aliases, baseUrl, package.json exports, relative
 *   extension completion (.ts/.tsx/.js/.jsx, index files)
 * - `import type` / .d.ts produce TYPE_ONLY edges
 * - dynamic import() / require() with a non-literal argument produce
 *   DYNAMIC_IMPORT_UNKNOWN (never a guessed edge, never silent)
 * - out-of-scope resolution produces UNKNOWN, never a guessed edge
 *
 * Read-only: never writes to the repo, never executes repo code.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  computeContentSha256,
  computeModuleId,
  normalizeRelativePath,
  parseEntrypointsTomlOptional,
  type ModuleV1,
} from "../../contracts/index.js";
import { GENERATED_MARKERS } from "../../contracts/index.js";
import {
  loadPackageJson,
  loadTsConfig,
  resolveSpecifier,
  type ConfigLoadStatus,
  type Resolution,
  type UnknownReason,
} from "./resolve.js";
import {
  nodeLine,
  nodeText,
  parseTypeScriptFile,
  stringLiteralValue,
} from "./parser.js";
import type { Node as SyntaxNode } from "web-tree-sitter";

export type TsImportKind =
  | "import"
  | "export-from"
  | "require"
  | "dynamic-import"
  | "import-equals";

export interface TsExtractedEdge {
  from: string;
  to: string;
  fromModuleId: string;
  toModuleId: string;
  /** True when the import exists only for type checking (erased). */
  typeOnly: boolean;
  kind: TsImportKind;
  evidence: { file: string; line: number; specifier: string };
}

export interface TsUnknownImport {
  from: string;
  specifier: string;
  line: number;
  reason: UnknownReason | "DYNAMIC_IMPORT_UNKNOWN" | "PARSE_ERROR" | "UNREADABLE";
  detail: string;
}

export interface TsModuleDetail {
  module: ModuleV1;
  /** True for .d.ts declaration files (all edges from them are TYPE_ONLY). */
  isDeclarationFile: boolean;
}

export interface TypeScriptExtraction {
  language: "typescript";
  modules: TsModuleDetail[];
  /** Core edges (generated files' edges are in generatedEdges). */
  edges: TsExtractedEdge[];
  /** Edges whose source file is generated code — excluded from core. */
  generatedEdges: TsExtractedEdge[];
  /** Third-party / builtin imports: counted, not verified. */
  externalImportCount: number;
  unknowns: TsUnknownImport[];
  /** Declared entrypoints (from .repomapverify.toml, repo-relative). */
  declaredEntrypoints: string[];
  /**
   * FIX P024 R2 P1-01: discriminated load status of the repo-root
   * resolution configs (absent / ok / unreadable / malformed). The
   * graph builder derives `typescriptConfigProblems` from these, so
   * an unreadable / malformed config reaches the comparator as a
   * structured state instead of only a snapshot hash marker.
   */
  tsconfigStatus: ConfigLoadStatus;
  packageJsonStatus: ConfigLoadStatus;
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"];
/**
 * Directories never scanned. FIX T013 R2 (R2-P1-01 audit): "__pycache__",
 * ".venv" and "venv" added -- the Oracle already skipped them, so a .ts
 * file under venv/ or __pycache__/ was a production-only module (Oracle
 * HALLUCINATED_MODULE / snapshot mismatch). Production was the wrong side:
 * PROJECT_BOOK §0.3 never scans build artifacts. Matches the Oracle's
 * SKIP_DIRS and the Python extractor exactly.
 */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
]);

function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function isDeclarationFile(relativePath: string): boolean {
  return relativePath.endsWith(".d.ts");
}

function isGeneratedContent(source: string): boolean {
  const head = source.split("\n").slice(0, 5).join("\n");
  return GENERATED_MARKERS.some((m) => head.includes(m));
}

/** Result of listing TypeScript files: the files plus the directories
 * that could not be listed at all. */
export interface TypeScriptFileList {
  files: string[];
  /**
   * Repo-relative paths of directories whose listing failed (e.g.
   * unreadable, EACCES), sorted. Their contents are UNKNOWN and must
   * be reported, never treated as "no files here" (PROJECT_BOOK
   * §5.1 "跳过项转 finding"; FIX P024 R1 P1-01).
   */
  unreadableDirs: string[];
}

/**
 * Recursively list repo files (POSIX relative paths), skipping .git /
 * node_modules / __pycache__ / .venv / venv. Directories that cannot
 * be listed are reported in `unreadableDirs` instead of silently
 * vanishing (FIX P024 R1 P1-01).
 */
export function listTypeScriptFiles(repoRoot: string): TypeScriptFileList {
  const out: string[] = [];
  const unreadableDirs: string[] = [];
  const walk = (dirAbs: string, dirRel: string): void => {
    let entries;
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      // FIX P024 R1 P1-01: an unlistable directory is UNKNOWN content,
      // not an empty directory. Record it ("" is the repo root).
      unreadableDirs.push(dirRel === "" ? "." : dirRel);
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dirAbs, entry.name), dirRel === "" ? entry.name : `${dirRel}/${entry.name}`);
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        out.push(dirRel === "" ? entry.name : `${dirRel}/${entry.name}`);
      }
    }
  };
  walk(repoRoot, "");
  return { files: out.sort(), unreadableDirs: unreadableDirs.sort() };
}

/** Is every import specifier in this clause a `type` specifier? */
function clauseIsAllType(source: string, clause: SyntaxNode | null): boolean {
  if (clause === null) return false;
  if (clause.type === "import_clause") {
    let sawNamed = false;
    for (const child of clause.namedChildren) {
      if (child.type === "identifier" || child.type === "namespace_import") {
        return false; // default / namespace import is a value import
      }
      if (child.type === "named_imports") {
        sawNamed = true;
        for (const spec of child.namedChildren) {
          if (spec.type !== "import_specifier") continue;
          if (!nodeText(source, spec).trim().startsWith("type ")) return false;
        }
      }
    }
    return sawNamed;
  }
  if (clause.type === "export_clause") {
    const specs = clause.namedChildren.filter((c) => c.type === "export_specifier");
    if (specs.length === 0) return false;
    return specs.every((s) => nodeText(source, s).trim().startsWith("type "));
  }
  return false;
}

/** First named child of a given type, or null. */
function childOfType(node: SyntaxNode, type: string): SyntaxNode | null {
  for (const child of node.namedChildren) {
    if (child.type === type) return child;
  }
  return null;
}

interface RawImport {
  specifier: string;
  line: number;
  kind: TsImportKind;
  typeOnly: boolean;
}

/** Collect raw (unresolved) imports from one parsed file. */
function collectRawImports(
  source: string,
  root: SyntaxNode,
  isDeclaration: boolean,
): { imports: RawImport[]; dynamicUnknowns: TsUnknownImport[] } {
  const imports: RawImport[] = [];
  const dynamicUnknowns: TsUnknownImport[] = [];
  // The caller fills `from` on dynamic unknowns; keep line + specifier here.
  const visit = (node: SyntaxNode): void => {
    if (node.type === "import_statement") {
      const text = nodeText(source, node);
      // The `source` field lives on the statement for plain imports, but
      // on the import_require_clause for `import foo = require("./x")`.
      let srcNode = node.childForFieldName("source");
      if (srcNode === null) {
        const reqClause = childOfType(node, "import_require_clause");
        srcNode = reqClause?.childForFieldName("source") ?? null;
      }
      const clause = childOfType(node, "import_clause") ??
        childOfType(node, "import_require_clause");
      // import foo = require("./x")
      const isImportEquals = clause !== null && clause.type === "import_require_clause";
      if (srcNode !== null) {
        const spec = stringLiteralValue(source, srcNode);
        if (spec !== undefined) {
          const typeOnly =
            isDeclaration ||
            /^import\s+type\b/.test(text) ||
            (!isImportEquals && clauseIsAllType(source, clause));
          imports.push({
            specifier: spec,
            line: nodeLine(node),
            kind: isImportEquals ? "import-equals" : "import",
            typeOnly,
          });
        }
      }
    } else if (node.type === "export_statement") {
      const srcNode = node.childForFieldName("source");
      if (srcNode !== null) {
        const spec = stringLiteralValue(source, srcNode);
        if (spec !== undefined) {
          const text = nodeText(source, node);
          const clause = childOfType(node, "export_clause");
          const typeOnly =
            isDeclaration ||
            /^export\s+type\b/.test(text) ||
            clauseIsAllType(source, clause);
          imports.push({
            specifier: spec,
            line: nodeLine(node),
            kind: "export-from",
            typeOnly,
          });
        }
      }
    } else if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      if (fn !== null) {
        const fnText = nodeText(source, fn);
        const args = node.childForFieldName("arguments");
        const firstArg = args?.namedChildren[0];
        if (fn.type === "import" || fnText === "import") {
          // import("./x") / import(variable)
          if (firstArg !== undefined) {
            const spec = stringLiteralValue(source, firstArg);
            if (spec !== undefined) {
              imports.push({
                specifier: spec,
                line: nodeLine(node),
                kind: "dynamic-import",
                typeOnly: isDeclaration,
              });
            } else {
              dynamicUnknowns.push({
                from: "",
                specifier: nodeText(source, firstArg),
                line: nodeLine(node),
                reason: "DYNAMIC_IMPORT_UNKNOWN",
                detail: "dynamic import() with a non-literal argument cannot be resolved statically",
              });
            }
          }
        } else if (fnText === "require") {
          if (firstArg !== undefined) {
            const spec = stringLiteralValue(source, firstArg);
            if (spec !== undefined) {
              imports.push({
                specifier: spec,
                line: nodeLine(node),
                kind: "require",
                typeOnly: isDeclaration,
              });
            } else {
              dynamicUnknowns.push({
                from: "",
                specifier: nodeText(source, firstArg),
                line: nodeLine(node),
                reason: "DYNAMIC_IMPORT_UNKNOWN",
                detail: "require() with a non-literal argument cannot be resolved statically",
              });
            }
          }
        }
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return { imports, dynamicUnknowns };
}

/** Extract the TypeScript ground-truth graph of a repo. */
export async function extractTypeScriptRepo(
  repoRoot: string,
): Promise<TypeScriptExtraction> {
  const { files, unreadableDirs } = listTypeScriptFiles(repoRoot);
  // FIX P024 R2 P1-01: the loaders return a discriminated status —
  // "absent" is not the same as "exists but unreadable / malformed".
  // Only an "ok" load yields a usable config; a bad load leaves the
  // config undefined AND records its status for the fail-closed
  // paths below (config unknown + extraction statuses).
  const tsconfigLoad = loadTsConfig(repoRoot);
  const packageJsonLoad = loadPackageJson(repoRoot);
  const tsconfig =
    tsconfigLoad.status === "ok" ? tsconfigLoad.config : undefined;
  const packageJson =
    packageJsonLoad.status === "ok" ? packageJsonLoad.packageJson : undefined;

  // Declared entrypoints (.repomapverify.toml at the repo root).
  let declaredEntrypoints: string[] = [];
  const tomlPath = join(repoRoot, ".repomapverify.toml");
  if (existsSync(tomlPath)) {
    try {
      declaredEntrypoints = parseEntrypointsTomlOptional(
        readFileSync(tomlPath, "utf8"),
      ).paths.map((p) => normalizeRelativePath(p));
    } catch {
      declaredEntrypoints = [];
    }
  }

  const modules: TsModuleDetail[] = [];
  const moduleByPath = new Map<string, ModuleV1>();
  const generatedByPath = new Map<string, boolean>();
  const declarationByPath = new Map<string, boolean>();

  for (const rel of files) {
    const abs = join(repoRoot, rel);
    const normalized = normalizeRelativePath(rel);
    const isDecl = isDeclarationFile(normalized);
    let content: string;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      // FIX P024 R1 P1-01: a listed-but-unreadable file is a module
      // whose imports are UNKNOWN, not a file that does not exist.
      // It stays in the graph with parseStatus UNREADABLE (empty
      // content hash: the content is unknown, never guessed) so the
      // comparator emits SOURCE_NOT_ENUMERATED for it (spec §5.1)
      // instead of the audit quietly PASSing over a hole. Its
      // outgoing edges are unknown; edges INTO it from readable
      // files are still recorded (see moduleByPath below).
      const module: ModuleV1 = {
        moduleId: computeModuleId("typescript", normalized),
        language: "typescript",
        nodeKind: "module",
        relativePath: normalized,
        contentSha256: "",
        isGenerated: false,
        isEntrypoint: declaredEntrypoints.includes(normalized),
        parseStatus: "UNREADABLE",
        evidenceLevel: "STATIC_RULE",
      };
      modules.push({ module, isDeclarationFile: isDecl });
      moduleByPath.set(normalized, module);
      generatedByPath.set(normalized, false);
      declarationByPath.set(normalized, isDecl);
      continue;
    }
    const generated = isGeneratedContent(content);
    const module: ModuleV1 = {
      moduleId: computeModuleId("typescript", normalized),
      language: "typescript",
      nodeKind: "module",
      relativePath: normalized,
      contentSha256: computeContentSha256(content),
      isGenerated: generated,
      isEntrypoint: declaredEntrypoints.includes(normalized),
      parseStatus: "OK",
      evidenceLevel: "STATIC_RULE",
    };
    modules.push({ module, isDeclarationFile: isDecl });
    moduleByPath.set(normalized, module);
    generatedByPath.set(normalized, generated);
    declarationByPath.set(normalized, isDecl);
  }

  const edges: TsExtractedEdge[] = [];
  const generatedEdges: TsExtractedEdge[] = [];
  const unknowns: TsUnknownImport[] = [];
  // FIX P024 R1 P1-01: directories that could not be listed hold
  // UNKNOWN content (possibly source files). Each becomes an
  // UNREADABLE unknown: the comparator turns it into a
  // SOURCE_NOT_ENUMERATED finding and forces INCOMPLETE (spec §5.1),
  // and the Oracle mirrors the same entry, so the two verdicts agree.
  for (const dir of unreadableDirs) {
    unknowns.push({
      from: dir,
      specifier: "",
      line: 1,
      reason: "UNREADABLE",
      detail: `directory ${dir} could not be listed; its contents are unknown`,
    });
  }
  // FIX P024 R2 P1-01: a resolution config that exists but could not
  // be read or parsed is UNKNOWN content in its own right — one
  // unknown per bad file, emitted whether or not any import in the
  // repo uses that config (fail-closed: the config is a promised
  // resolution input, and "unknown content" is not "no config").
  // The comparator turns the BuiltGraph's typescriptConfigProblems
  // (derived from the statuses below) into the SOURCE_NOT_ENUMERATED
  // finding; this unknown additionally forces INCOMPLETE through the
  // evidence's unknownImportsPresent, so the verdict cannot PASS
  // even if the graph-level flag were ever dropped.
  for (const load of [
    { file: "tsconfig.json", status: tsconfigLoad.status },
    { file: "package.json", status: packageJsonLoad.status },
  ] as const) {
    if (load.status !== "unreadable" && load.status !== "malformed") continue;
    unknowns.push({
      from: load.file,
      specifier: "",
      line: 1,
      reason: "CONFIG_UNREADABLE",
      detail:
        `${load.file} exists but could not be ` +
        `${load.status === "unreadable" ? "read" : "parsed"}; ` +
        `its resolution rules are unknown, so imports that may depend on it cannot be resolved`,
    });
  }
  let externalImportCount = 0;
  const seenEdge = new Set<string>();

  for (const { module } of modules) {
    const rel = module.relativePath;
    // FIX P024 R1 P1-01: an UNREADABLE module has no readable source
    // to parse — skip it here (its imports are unknown, recorded via
    // parseStatus, never guessed) instead of crashing on a second
    // read that is guaranteed to fail.
    if (module.parseStatus !== "OK") continue;
    const abs = join(repoRoot, rel);
    const source = readFileSync(abs, "utf8");
    const parsed = await parseTypeScriptFile(source, rel);
    if (parsed.hasError) {
      module.parseStatus = "PARSE_ERROR";
      unknowns.push({
        from: rel,
        specifier: "",
        line: 1,
        reason: "PARSE_ERROR",
        detail: "source file has a syntax error; its imports were not enumerated",
      });
      continue;
    }
    const { imports, dynamicUnknowns } = collectRawImports(
      parsed.source,
      parsed.root,
      declarationByPath.get(rel) ?? false,
    );
    for (const du of dynamicUnknowns) {
      unknowns.push({ ...du, from: rel });
    }
    const fromDirAbs = dirname(abs);
    for (const raw of imports) {
      const resolution: Resolution = resolveSpecifier(
        {
          repoRoot,
          tsconfig,
          packageJson,
          tsconfigStatus: tsconfigLoad.status,
          packageJsonStatus: packageJsonLoad.status,
        },
        fromDirAbs,
        raw.specifier,
        { typeOnly: raw.typeOnly },
      );
      if (resolution.kind === "external") {
        externalImportCount++;
        continue;
      }
      if (resolution.kind === "unknown") {
        unknowns.push({
          from: rel,
          specifier: raw.specifier,
          line: raw.line,
          reason: resolution.reason,
          detail: `specifier ${JSON.stringify(raw.specifier)} could not be resolved within the frozen scope`,
        });
        continue;
      }
      const target = moduleByPath.get(resolution.relativePath);
      if (target === undefined) {
        // Resolved to a file that is not a scanned module (e.g. a .json
        // or an excluded file): not a module edge, not a guess.
        unknowns.push({
          from: rel,
          specifier: raw.specifier,
          line: raw.line,
          reason: "TARGET_NOT_FOUND",
          detail: `resolved to ${resolution.relativePath}, which is not a scanned TypeScript module`,
        });
        continue;
      }
      // An import of a .d.ts target is type-only even for value imports.
      const typeOnly = raw.typeOnly || (declarationByPath.get(target.relativePath) ?? false);
      const edge: TsExtractedEdge = {
        from: rel,
        to: target.relativePath,
        fromModuleId: module.moduleId,
        toModuleId: target.moduleId,
        typeOnly,
        kind: raw.kind,
        evidence: { file: rel, line: raw.line, specifier: raw.specifier },
      };
      const key = `${edge.fromModuleId}\0${edge.toModuleId}\0${typeOnly ? "t" : "r"}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      if (generatedByPath.get(rel) === true) generatedEdges.push(edge);
      else edges.push(edge);
    }
  }

  const sortEdges = (a: TsExtractedEdge, b: TsExtractedEdge): number =>
    a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
  edges.sort(sortEdges);
  generatedEdges.sort(sortEdges);
  unknowns.sort((a, b) =>
    a.from < b.from ? -1 : a.from > b.from ? 1 : a.line - b.line,
  );
  modules.sort((a, b) =>
    a.module.relativePath < b.module.relativePath ? -1 : 1,
  );

  return {
    language: "typescript",
    modules,
    edges,
    generatedEdges,
    externalImportCount,
    unknowns,
    declaredEntrypoints,
    tsconfigStatus: tsconfigLoad.status,
    packageJsonStatus: packageJsonLoad.status,
  };
}
