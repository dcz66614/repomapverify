/**
 * T003 — Go extractor (PROJECT_BOOK §4.5; IMPLEMENTATION_PLAN T003).
 *
 * Statically extracts the package-level import graph of a Go repo:
 * - graph nodes are PACKAGES (all in-scope .go files in one directory
 *   aggregate to one node; files are composition evidence, not nodes;
 *   intra-package references produce no edge)
 * - import blocks + go.mod module-path parsing (incl. replace directives)
 * - frozen default build tags GOOS=linux / GOARCH=amd64, no custom tags
 * - generated files (*.pb.go, *.mock.go, "Code generated" headers) are
 *   marked GENERATED and excluded from core edges
 * - cgo files (import "C") are marked CGO; edges are not expanded to
 *   the C side
 * - stdlib and external module imports are counted (EXTERNAL_IMPORTS),
 *   not verified; vendor/ packages resolve to vendor content
 * - *_test.go files are excluded from package composition (test-only
 *   imports are not part of the build graph)
 *
 * Read-only: never writes to the repo, never executes repo code, never
 * runs `go list` / `go build` (pure static parsing).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import {
  computeContentSha256,
  computeGoPackageContentSha256,
  computeModuleId,
  normalizeRelativePath,
  parseEntrypointsTomlOptional,
  type ModuleV1,
} from "../../contracts/index.js";
import { GENERATED_MARKERS } from "../../contracts/index.js";
import { GO_FROZEN_SCOPE } from "../../contracts/index.js";
import { childOfType, goStringValue, nodeLine, nodeText, parseGoFile } from "./parser.js";
import type { SyntaxNode } from "./parser.js";
import { loadGoMod, type GoMod } from "./gomod.js";
import {
  DEFAULT_BUILD,
  UndecidableBuildConstraint,
  extractConstraints,
  fileInBuild,
} from "./buildtags.js";

export interface GoPackageFile {
  relativePath: string;
  contentSha256: string;
  isGenerated: boolean;
  isCgo: boolean;
}

export interface GoExcludedFile {
  relativePath: string;
  reason: "TEST_FILE" | "BUILD_EXCLUDED" | "UNDECIDABLE_BUILD_CONSTRAINT" | "PARSE_ERROR";
  detail: string;
}

export interface GoPackageDetail {
  module: ModuleV1;
  /** Constituent in-scope files (sorted by path). */
  files: GoPackageFile[];
  /** Package name from the package clause. */
  packageName: string;
  /** True when any constituent file imports "C". */
  hasCgo: boolean;
}

export interface GoExtractedEdge {
  from: string;
  to: string;
  fromModuleId: string;
  toModuleId: string;
  evidence: { file: string; line: number; importPath: string };
}

export interface GoUnknownImport {
  from: string;
  importPath: string;
  line: number;
  reason:
    | "TARGET_PACKAGE_NOT_FOUND"
    | "TARGET_PACKAGE_EMPTY"
    | "NO_GO_MOD"
    | "UNDECIDABLE_BUILD_CONSTRAINT"
    | "PARSE_ERROR"
    | "UNREADABLE";
  detail: string;
}

export interface GoExtraction {
  language: "go";
  packages: GoPackageDetail[];
  /** Core edges (generated files' edges are in generatedEdges). */
  edges: GoExtractedEdge[];
  /** Edges whose source file is generated code — excluded from core. */
  generatedEdges: GoExtractedEdge[];
  /** Stdlib + external module imports: counted, not verified. */
  externalImportCount: number;
  unknowns: GoUnknownImport[];
  excludedFiles: GoExcludedFile[];
  declaredEntrypoints: string[];
  /** Module path from go.mod, when present. */
  modulePath?: string | undefined;
}

/**
 * Directories never scanned. FIX T013 R2 (R2-P1-01 audit): "node_modules",
 * "__pycache__", ".venv" and "venv" added -- the Oracle already skipped
 * them, so a .go file under node_modules/ (or venv/, __pycache__/) was a
 * production-only package (Oracle HALLUCINATED_MODULE on a map claiming
 * it). Production was the wrong side: PROJECT_BOOK §0.3 never scans
 * .git / node_modules / build artifacts, and DEFAULT_EXCLUDED_DIRS
 * (frozen-scope.ts) lists node_modules as never scanned. "testdata" and
 * the _test.go exclusion are unchanged and already agree with the Oracle.
 */
const SKIP_DIRS = new Set([
  ".git",
  "testdata",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
]);

function isGeneratedFile(relativePath: string, source: string): boolean {
  if (GO_FROZEN_SCOPE.generatedSuffixes.some((s) => relativePath.endsWith(s))) {
    return true;
  }
  const head = source.split("\n").slice(0, 5).join("\n");
  return GENERATED_MARKERS.some((m) => head.includes(m));
}

/** Result of listing Go files: the files plus the directories that
 * could not be listed at all. */
export interface GoFileList {
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
 * Recursively list .go files (POSIX relative paths), skipping .git /
 * testdata / node_modules / __pycache__ / .venv / venv. Directories
 * that cannot be listed are reported in `unreadableDirs` instead of
 * silently vanishing (FIX P024 R1 P1-01).
 */
export function listGoFiles(repoRoot: string): GoFileList {
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
      } else if (entry.isFile() && entry.name.endsWith(".go")) {
        out.push(dirRel === "" ? entry.name : `${dirRel}/${entry.name}`);
      }
    }
  };
  walk(repoRoot, "");
  return { files: out.sort(), unreadableDirs: unreadableDirs.sort() };
}

/** Import path is stdlib when its first segment contains no dot. */
function isStdlibImport(importPath: string): boolean {
  const first = importPath.split("/")[0] as string;
  return !first.includes(".");
}

/** Does a directory hold at least one in-scope .go file? */
function dirHasPackage(
  repoRoot: string,
  dirRel: string,
  includedByDir: Map<string, GoPackageFile[]>,
): boolean {
  const files = includedByDir.get(dirRel);
  return files !== undefined && files.length > 0;
}

interface RawGoImport {
  importPath: string;
  line: number;
  file: string;
}

/** Collect import specs from one parsed Go file. */
function collectRawImports(source: string, root: SyntaxNode): RawGoImport[] {
  const out: RawGoImport[] = [];
  const visit = (node: SyntaxNode): void => {
    if (node.type === "import_spec") {
      const pathNode = node.childForFieldName("path");
      if (pathNode !== null) {
        const value = goStringValue(source, pathNode);
        if (value !== undefined) {
          out.push({ importPath: value, line: nodeLine(node), file: "" });
        }
      }
      return;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return out;
}

/** Extract the Go ground-truth graph of a repo. */
export async function extractGoRepo(repoRoot: string): Promise<GoExtraction> {
  const { files, unreadableDirs } = listGoFiles(repoRoot);
  const goMod: GoMod | undefined = loadGoMod(repoRoot);
  const modulePath = goMod?.modulePath;

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

  // ---- Pass 1: classify files, group into packages. ----
  const includedByDir = new Map<string, GoPackageFile[]>();
  const packageNameByDir = new Map<string, string>();
  const excludedFiles: GoExcludedFile[] = [];
  const unknowns: GoUnknownImport[] = [];
  const importsByFile = new Map<string, RawGoImport[]>();
  const parseErrorDirs = new Set<string>();
  // FIX P024 R1 P1-01: package directories holding at least one
  // unreadable constituent file. The package node survives (from its
  // readable files) but its composition is incomplete, so its
  // parseStatus becomes UNREADABLE (worst-status rule: PARSE_ERROR >
  // UNREADABLE > OK) and the file itself gets a file-level UNREADABLE
  // unknown below, so the comparator can name it.
  const unreadableFileDirs = new Set<string>();
  // FIX P024 R1 P1-01: directories that could not be listed hold
  // UNKNOWN content (possibly .go files). Each becomes an UNREADABLE
  // unknown: the comparator turns it into a SOURCE_NOT_ENUMERATED
  // finding and forces INCOMPLETE (spec §5.1).
  for (const dir of unreadableDirs) {
    unknowns.push({
      from: dir,
      importPath: "",
      line: 1,
      reason: "UNREADABLE",
      detail: `directory ${dir} could not be listed; its contents are unknown`,
    });
  }

  for (const rel of files) {
    const abs = join(repoRoot, rel);
    const dirRel = posix.dirname(rel);
    const dirKey = dirRel === "." ? "." : dirRel;
    // FIX P024 R1 P1-01: the _test.go exclusion is decided by NAME,
    // before any read — an unreadable test file is still a test file
    // (never part of the build graph), so it is excluded without a
    // finding instead of crashing or vanishing silently. The Oracle
    // mirrors this order.
    if (rel.endsWith("_test.go")) {
      excludedFiles.push({
        relativePath: rel,
        reason: "TEST_FILE",
        detail: "test files are excluded from the build graph",
      });
      continue;
    }
    let source: string;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      // FIX P024 R1 P1-01: a listed-but-unreadable file is UNKNOWN
      // content, not a missing file. It contributes no content hash
      // and no imports (never guessed), but its package is marked
      // UNREADABLE and the file itself is recorded here so the
      // comparator emits a file-level SOURCE_NOT_ENUMERATED finding
      // for it (a package-level finding alone could not name it —
      // and when it is the package's ONLY file, this entry is the
      // only trace of it at all).
      unreadableFileDirs.add(dirKey);
      unknowns.push({
        from: rel,
        importPath: "",
        line: 1,
        reason: "UNREADABLE",
        detail: `file ${rel} could not be read; its imports are unknown`,
      });
      continue;
    }
    let inBuild = true;
    try {
      inBuild = fileInBuild(extractConstraints(source), DEFAULT_BUILD);
    } catch (err) {
      if (err instanceof UndecidableBuildConstraint) {
        excludedFiles.push({
          relativePath: rel,
          reason: "UNDECIDABLE_BUILD_CONSTRAINT",
          detail: err.message,
        });
        unknowns.push({
          from: dirKey,
          importPath: "",
          line: 1,
          reason: "UNDECIDABLE_BUILD_CONSTRAINT",
          detail: `file ${rel}: ${err.message}`,
        });
        continue;
      }
      throw err;
    }
    if (!inBuild) {
      excludedFiles.push({
        relativePath: rel,
        reason: "BUILD_EXCLUDED",
        detail: "excluded by build constraints under GOOS=linux/GOARCH=amd64",
      });
      continue;
    }
    const parsed = await parseGoFile(source);
    const pkgClause = childOfType(parsed.root, "package_clause");
    const pkgIdent = pkgClause !== null ? childOfType(pkgClause, "package_identifier") : null;
    const pkgName = pkgIdent !== null ? nodeText(source, pkgIdent) : "";
    const prev = packageNameByDir.get(dirKey);
    if (prev !== undefined && prev !== pkgName && pkgName !== "") {
      unknowns.push({
        from: dirKey,
        importPath: "",
        line: 1,
        reason: "PARSE_ERROR",
        detail: `directory ${dirKey} declares two package names (${prev} vs ${pkgName})`,
      });
    } else if (pkgName !== "") {
      packageNameByDir.set(dirKey, pkgName);
    }
    let rawImports: RawGoImport[] = [];
    let isCgo = false;
    if (parsed.hasError) {
      // A file with a syntax error stays composition evidence of its
      // package (its content is real), but its imports are NOT
      // enumerated — recorded as PARSE_ERROR, never guessed.
      parseErrorDirs.add(dirKey);
      unknowns.push({
        from: dirKey,
        importPath: "",
        line: 1,
        reason: "PARSE_ERROR",
        detail: `file ${rel} has a syntax error; its imports were not enumerated`,
      });
    } else {
      rawImports = collectRawImports(source, parsed.root).map((r) => ({
        ...r,
        file: rel,
      }));
      isCgo = rawImports.some((r) => r.importPath === "C");
    }
    importsByFile.set(rel, rawImports);
    const fileRec: GoPackageFile = {
      relativePath: rel,
      contentSha256: computeContentSha256(source),
      isGenerated: isGeneratedFile(rel, source),
      isCgo,
    };
    const list = includedByDir.get(dirKey) ?? [];
    list.push(fileRec);
    includedByDir.set(dirKey, list);
  }

  // ---- Pass 2: build package nodes. ----
  const packages: GoPackageDetail[] = [];
  const moduleByDir = new Map<string, ModuleV1>();
  const packageDetailByDir = new Map<string, GoPackageDetail>();
  for (const dirKey of [...includedByDir.keys()].sort()) {
    const fileList = [...(includedByDir.get(dirKey) ?? [])].sort((a, b) =>
      a.relativePath < b.relativePath ? -1 : 1,
    );
    const contentSha256 = computeGoPackageContentSha256(
      fileList.map((f) => ({ relativePath: f.relativePath, contentSha256: f.contentSha256 })),
    );
    const normalizedDir = dirKey === "." ? "." : normalizeRelativePath(dirKey);
    const moduleIdInput = dirKey === "." ? "" : normalizedDir;
    const isGenerated = fileList.length > 0 && fileList.every((f) => f.isGenerated);
    const entryFileHit = declaredEntrypoints.some(
      (ep) => posix.dirname(ep) === dirKey,
    );
    const module: ModuleV1 = {
      moduleId: computeModuleId("go", moduleIdInput),
      language: "go",
      nodeKind: "package",
      relativePath: normalizedDir,
      contentSha256,
      isGenerated,
      isEntrypoint: entryFileHit,
      parseStatus: parseErrorDirs.has(dirKey)
        ? "PARSE_ERROR"
        : unreadableFileDirs.has(dirKey)
          ? "UNREADABLE"
          : "OK",
      evidenceLevel: "STATIC_RULE",
    };
    const detail: GoPackageDetail = {
      module,
      files: fileList,
      packageName: packageNameByDir.get(dirKey) ?? "",
      hasCgo: fileList.some((f) => f.isCgo),
    };
    packages.push(detail);
    moduleByDir.set(dirKey, module);
    packageDetailByDir.set(dirKey, detail);
  }

  // ---- Pass 3: resolve imports to package edges. ----
  const edges: GoExtractedEdge[] = [];
  const generatedEdges: GoExtractedEdge[] = [];
  let externalImportCount = 0;
  // Core and generated edges dedup SEPARATELY (T007 fix): one package
  // pair can legitimately occur in both — a hand-written file and a
  // generated file in the same package importing the same target.
  // A single shared set silently dropped whichever came second
  // (alphabetically-first generated file ate the core edge, and vice
  // versa), losing a real hand-written edge from the ground truth.
  const seenCoreEdge = new Set<string>();
  const seenGeneratedEdge = new Set<string>();

  const resolveImport = (
    importPath: string,
  ):
    | { kind: "package"; dirKey: string }
    | { kind: "external" }
    | { kind: "unknown"; reason: GoUnknownImport["reason"]; detail: string } => {
    if (importPath === "C") return { kind: "external" }; // cgo: no edge
    if (isStdlibImport(importPath)) return { kind: "external" };
    let path = importPath;
    // Apply replace directives (longest old-prefix wins).
    if (goMod !== undefined) {
      let best: { oldPath: string; newPath: string; newIsLocal: boolean } | undefined;
      for (const r of goMod.replaces) {
        if (path === r.oldPath || path.startsWith(`${r.oldPath}/`)) {
          if (best === undefined || r.oldPath.length > best.oldPath.length) best = r;
        }
      }
      if (best !== undefined) {
        const remainder = path.slice(best.oldPath.length).replace(/^\//, "");
        if (best.newIsLocal) {
          if (best.newPath.startsWith("/")) {
            // Absolute local replace target: outside this repo.
            return { kind: "external" };
          }
          const localDir = posix.normalize(
            posix.join(".", best.newPath, remainder),
          );
          if (localDir === ".." || localDir.startsWith("../")) {
            // Local replace target escapes the repo (e.g. ../sibling):
            // outside the scanned tree, so an external dependency,
            // not a resolvable in-repo package and not UNKNOWN (T007:
            // consistent with the absolute-path case above).
            return { kind: "external" };
          }
          const dirKey = localDir === "." ? "." : localDir;
          if (dirHasPackage(repoRoot, dirKey, includedByDir)) {
            return { kind: "package", dirKey };
          }
          if (existsSync(join(repoRoot, dirKey))) {
            return {
              kind: "unknown",
              reason: "TARGET_PACKAGE_EMPTY",
              detail: `replace target ${dirKey} has no in-scope Go files`,
            };
          }
          return {
            kind: "unknown",
            reason: "TARGET_PACKAGE_NOT_FOUND",
            detail: `replace target directory ${dirKey} does not exist`,
          };
        }
        path = remainder === "" ? best.newPath : `${best.newPath}/${remainder}`;
      }
    }
    // Vendor: vendor/<importpath> resolves to vendored content.
    const vendorDir = `vendor/${path}`;
    if (dirHasPackage(repoRoot, vendorDir, includedByDir)) {
      return { kind: "package", dirKey: vendorDir };
    }
    // In-module package.
    if (modulePath !== undefined) {
      if (path === modulePath || path.startsWith(`${modulePath}/`)) {
        const rest = path.slice(modulePath.length).replace(/^\//, "");
        const dirKey = rest === "" ? "." : rest;
        if (dirHasPackage(repoRoot, dirKey, includedByDir)) {
          return { kind: "package", dirKey };
        }
        if (existsSync(join(repoRoot, dirKey))) {
          return {
            kind: "unknown",
            reason: "TARGET_PACKAGE_EMPTY",
            detail: `package directory ${dirKey} has no in-scope Go files`,
          };
        }
        return {
          kind: "unknown",
          reason: "TARGET_PACKAGE_NOT_FOUND",
          detail: `package directory ${dirKey} does not exist in the repo`,
        };
      }
    } else {
      return {
        kind: "unknown",
        reason: "NO_GO_MOD",
        detail: `no go.mod: non-stdlib import ${importPath} cannot be resolved`,
      };
    }
    // Any other module path is an external dependency.
    return { kind: "external" };
  };

  for (const detail of packages) {
    for (const file of detail.files) {
      const fromDir = detail.module.relativePath === "." ? "." : detail.module.relativePath;
      const rawImports = importsByFile.get(file.relativePath) ?? [];
      for (const raw of rawImports) {
        if (raw.importPath === "C") continue; // cgo marker only
        const resolved = resolveImport(raw.importPath);
        if (resolved.kind === "external") {
          externalImportCount++;
          continue;
        }
        if (resolved.kind === "unknown") {
          unknowns.push({
            from: fromDir,
            importPath: raw.importPath,
            line: raw.line,
            reason: resolved.reason,
            detail: resolved.detail,
          });
          continue;
        }
        const target = moduleByDir.get(resolved.dirKey);
        if (target === undefined) continue;
        if (target.moduleId === detail.module.moduleId) continue; // intra-package: no edge
        const edge: GoExtractedEdge = {
          from: fromDir,
          to: resolved.dirKey === "." ? "." : resolved.dirKey,
          fromModuleId: detail.module.moduleId,
          toModuleId: target.moduleId,
          evidence: { file: file.relativePath, line: raw.line, importPath: raw.importPath },
        };
        const key = `${edge.fromModuleId}\0${edge.toModuleId}`;
        if (file.isGenerated) {
          if (seenGeneratedEdge.has(key)) continue;
          seenGeneratedEdge.add(key);
          generatedEdges.push(edge);
        } else {
          if (seenCoreEdge.has(key)) continue;
          seenCoreEdge.add(key);
          edges.push(edge);
        }
      }
    }
  }

  const sortEdges = (a: GoExtractedEdge, b: GoExtractedEdge): number =>
    a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
  edges.sort(sortEdges);
  generatedEdges.sort(sortEdges);
  unknowns.sort((a, b) =>
    a.from < b.from ? -1 : a.from > b.from ? 1 : a.line - b.line,
  );
  excludedFiles.sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1));
  packages.sort((a, b) =>
    a.module.relativePath < b.module.relativePath ? -1 : 1,
  );

  return {
    language: "go",
    packages,
    edges,
    generatedEdges,
    externalImportCount,
    unknowns,
    excludedFiles,
    declaredEntrypoints,
    modulePath,
  };
}
