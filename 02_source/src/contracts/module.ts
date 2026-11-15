/**
 * Module identity contract (PROJECT_BOOK §4.2, IMPLEMENTATION_PLAN §4.2).
 *
 * Identity and version are SEPARATE by design:
 * - module_id  = SHA256(language + normalized_relative_path) — WHERE the
 *   module is. Editing the file's contents does NOT change module_id.
 * - content_sha256 = SHA256(file_content) — WHAT version the module is.
 *   Editing the file's contents changes ONLY content_sha256.
 *
 * A module is NEVER identified by its basename alone: two files with the
 * same name in different paths are two different modules.
 */
import { createHash } from "node:crypto";

export type Language = "python" | "typescript" | "go";

/** Python / TypeScript nodes are `module` (one source file); Go nodes are `package`. */
export type NodeKind = "module" | "package";

export type ParseStatus = "OK" | "UNREADABLE" | "TOO_LARGE" | "PARSE_ERROR";

export interface ModuleV1 {
  /** SHA256(language + normalized_relative_path). See computeModuleId. */
  moduleId: string;
  language: Language;
  nodeKind: NodeKind;
  /** POSIX-style relative path from the repo root; Go: package directory. */
  relativePath: string;
  /**
   * SHA256(file_content) for a single-file module. For a Go package node:
   * the canonical combination hash of its constituent files — see
   * computeGoPackageContentSha256. Never a bare concatenation.
   */
  contentSha256: string;
  isGenerated: boolean;
  isEntrypoint: boolean;
  parseStatus: ParseStatus;
  evidenceLevel: "STATIC_RULE";
}

/** An import edge. Edge identity is the (source module_id, target module_id) pair. */
export interface GroundTruthEdge {
  fromModuleId: string;
  toModuleId: string;
  /** True when the import is conditional (try/except, if TYPE_CHECKING, ...). */
  conditional?: boolean;
  /** True when the import exists only for type checking (erased at runtime). */
  typeOnly?: boolean;
}

/**
 * Normalize a repo-relative path (frozen by T001):
 * 1. Unicode NFC.
 * 2. Backslashes become forward slashes.
 * 3. A leading "./" is stripped; "." segments are collapsed.
 * 4. No trailing slash (except the empty path, which is never a module).
 *
 * Absolute paths and ".." escapes are NOT normalized away — they are
 * rejected by the caller (a module path must stay inside the repo).
 */
export function normalizeRelativePath(p: string): string {
  const nfc = p.normalize("NFC");
  const posix = nfc.replace(/\\/g, "/");
  const parts: string[] = [];
  for (const seg of posix.split("/")) {
    if (seg === "" || seg === ".") continue;
    parts.push(seg);
  }
  return parts.join("/");
}

/** True when the path is absolute or escapes the repo root via "..". */
export function isUnsafeRelativePath(p: string): boolean {
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) return true;
  const normalized = p.normalize("NFC").replace(/\\/g, "/");
  return normalized.split("/").includes("..");
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * module_id = SHA256(language + normalized_relative_path).
 *
 * FROZEN encoding (T001): the two fields are joined with a single NUL
 * byte (U+0000) before hashing, so no (language, path) pair can collide
 * with a different pair by concatenation ambiguity, e.g. ("go", "x") vs
 * ("gox", ""). The literal spec formula "SHA256(language +
 * normalized_relative_path)" is implemented as
 * SHA256(language + "\0" + normalizedRelativePath).
 */
export function computeModuleId(language: Language, normalizedRelativePath: string): string {
  return sha256Hex(`${language}\0${normalizedRelativePath}`);
}

/** content_sha256 = SHA256(file_content) for a single-file module. */
export function computeContentSha256(content: string | Buffer): string {
  return sha256Hex(content);
}

/**
 * Go package content hash (PROJECT_BOOK §4.2): the constituent source
 * files are sorted by normalized relative path, and each contributes one
 * line `relativePath + NUL + contentSha256 + "\n"`; the package hash is
 * SHA256 of the concatenation of those lines. Deterministic, order
 * independent of discovery order, and sensitive to both file set and
 * file contents.
 */
export function computeGoPackageContentSha256(
  files: ReadonlyArray<{ relativePath: string; contentSha256: string }>,
): string {
  const sorted = [...files].sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
  );
  const body = sorted.map((f) => `${f.relativePath}\0${f.contentSha256}\n`).join("");
  return sha256Hex(body);
}
