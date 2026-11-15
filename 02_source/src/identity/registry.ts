/**
 * T005 — Module identity registry (PROJECT_BOOK §4.2; PLAN T005).
 *
 * One registry per repo (all three languages). It enforces the frozen
 * identity rules:
 *
 * 1. module_id = SHA256(language + NUL + normalized_relative_path) and
 *    content_sha256 = SHA256(file content) are STRICTLY SEPARATED.
 *    Re-registering the same path with new content changes ONLY
 *    content_sha256; module_id never moves. (See `register` /
 *    `updateContent`.)
 * 2. Identity is never the basename: same-name different-path modules
 *    get distinct module_ids (the path is part of the hash input).
 * 3. Same physical file reached via multiple in-repo paths merges to
 *    ONE module: the canonical path is the smallest normalized path
 *    among the merged spellings (deterministic, independent of
 *    registration order), the other spellings are retained as `aliases`,
 *    and module_id is computed over the canonical path. The merge key
 *    is the filesystem physical identity (realpath); symlinks pointing
 *    OUTSIDE the repo never produce a realPath inside the repo, so they
 *    can never merge and never become modules (see symlinks.ts).
 * 4. Two files with identical content but different paths are still
 *    two modules; `findDuplicateContent` exposes the grouping so the
 *    comparator can emit DUPLICATE_CONTENT (spec §5.2, P2).
 * 5. Case folding comes only from the injected platform adapter (see
 *    normalize.ts). The module_id input is the adapter-folded identity
 *    path; on a case-sensitive adapter the fold is the identity, so the
 *    result equals the frozen contract function computeModuleId
 *    exactly. On a case-insensitive adapter "Foo/Bar.py" and
 *    "foo/bar.py" fold to one key and one module_id.
 * 6. Go root package: relativePath "." has identity path "" (the
 *    contract strips "."), so its module_id is computed over "" —
 *    exactly as the Go extractor and the Oracle do.
 */
import { createHash } from "node:crypto";
import {
  computeGoPackageContentSha256,
  normalizeRelativePath,
  type Language,
  type NodeKind,
  type ParseStatus,
} from "../contracts/module.js";
import {
  compareNormalizedPaths,
  posixCaseAdapter,
  type PlatformCaseAdapter,
} from "./normalize.js";

export interface IdentityFile {
  relativePath: string;
  contentSha256: string;
}

/** One registered module identity (a graph node, pre-edge). */
export interface ModuleIdentity {
  moduleId: string;
  language: Language;
  nodeKind: NodeKind;
  /** Canonical display path (smallest normalized spelling; "." for a Go root package). */
  relativePath: string;
  /** Normalized path the module_id was computed over ("" for a Go root package). */
  identityPath: string;
  /** Other in-repo spellings of the same physical file, sorted. */
  aliases: string[];
  contentSha256: string;
  /** Go package constituent files (sorted by path), if any. */
  files?: IdentityFile[];
  /** Physical identity (realpath) when known; undefined = unknown. */
  realPath?: string;
  /** True when the module is generated code (OR over merged spellings). */
  isGenerated?: boolean;
  /**
   * Parse status; merging takes the worst (PARSE_ERROR > UNREADABLE >
   * TOO_LARGE > OK) so a problem in any spelling survives the merge.
   */
  parseStatus?: ParseStatus;
}

export interface RegisterInput {
  language: Language;
  /** Repo-relative path as discovered ("." for a Go root package). */
  relativePath: string;
  /** Precomputed content hash (single file) or Go package combination hash. */
  contentSha256: string;
  nodeKind?: NodeKind;
  /** Go package constituent files (sorted internally). */
  files?: IdentityFile[];
  /** Physical path (realpath) of the file / package directory, when known. */
  realPath?: string;
  isGenerated?: boolean;
  parseStatus?: ParseStatus;
}

/** Two registrations that claim one identity key but are different physical files. */
export interface IdentityConflict {
  moduleId: string;
  language: Language;
  identityPath: string;
  realPaths: string[];
  detail: string;
}

/** A content hash shared by two or more distinct modules. */
export interface DuplicateContentGroup {
  contentSha256: string;
  moduleIds: string[];
  relativePaths: string[];
}

/** Worst parse status wins a merge (PARSE_ERROR > UNREADABLE > TOO_LARGE > OK). */
const PARSE_SEVERITY: Record<ParseStatus, number> = {
  OK: 0,
  TOO_LARGE: 1,
  UNREADABLE: 2,
  PARSE_ERROR: 3,
};

export function worstParseStatus(
  a: ParseStatus | undefined,
  b: ParseStatus,
): ParseStatus {
  if (a === undefined) return b;
  return PARSE_SEVERITY[a] >= PARSE_SEVERITY[b] ? a : b;
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export class IdentityRegistry {
  private readonly adapter: PlatformCaseAdapter;
  /** moduleId -> record. */
  private readonly byId = new Map<string, ModuleIdentity>();
  /** language + NUL + folded identity path -> moduleId. */
  private readonly byKey = new Map<string, string>();
  /** language + NUL + realPath -> moduleId (physical merge key). */
  private readonly byReal = new Map<string, string>();
  private readonly conflictList: IdentityConflict[] = [];

  constructor(adapter: PlatformCaseAdapter = posixCaseAdapter()) {
    this.adapter = adapter;
  }

  get caseAdapter(): PlatformCaseAdapter {
    return this.adapter;
  }

  /** module_id input for a (language, identity path) pair under this adapter. */
  moduleIdFor(language: Language, identityPath: string): string {
    return sha256Hex(`${language}\0${this.adapter.fold(identityPath)}`);
  }

  /**
   * Register one module. Returns the (possibly merged) record.
   * Re-registering the same identity with different content updates
   * ONLY content_sha256. Registering a second spelling of the same
   * physical file merges it into the existing record as an alias and
   * re-canonicalizes (smallest path wins) — registration order does not
   * affect the final module_id.
   */
  register(input: RegisterInput): ModuleIdentity {
    const identityPath = normalizeRelativePath(input.relativePath);
    const nodeKind: NodeKind = input.nodeKind ?? "module";
    const key = `${input.language}\0${this.adapter.fold(identityPath)}`;
    const realKey =
      input.realPath !== undefined ? `${input.language}\0${input.realPath}` : undefined;

    // Physical merge first: same real file under another spelling.
    if (realKey !== undefined) {
      const existingId = this.byReal.get(realKey);
      if (existingId !== undefined) {
        const rec = this.byId.get(existingId) as ModuleIdentity;
        return this.mergeSpelling(rec, identityPath, input);
      }
    }
    const existingId = this.byKey.get(key);
    if (existingId !== undefined) {
      const rec = this.byId.get(existingId) as ModuleIdentity;
      if (realKey !== undefined && rec.realPath !== undefined && rec.realPath !== input.realPath) {
        // Same identity key, different physical files: the adapter's
        // folding disagrees with this filesystem. Keep both spellings
        // visible via the conflict list; do NOT merge.
        this.recordConflict(rec, input);
        return rec;
      }
      return this.mergeSpelling(rec, identityPath, input);
    }

    const moduleId = this.moduleIdFor(input.language, identityPath);
    // Display path is the NFC-normalized spelling ("." stays "." for
    // the Go root package, whose identity path is "").
    const displayPath = identityPath === "" ? "." : identityPath;
    const rec: ModuleIdentity = {
      moduleId,
      language: input.language,
      nodeKind,
      relativePath: displayPath,
      identityPath,
      aliases: [],
      contentSha256: input.contentSha256,
      ...(input.files !== undefined
        ? { files: [...input.files].sort((a, b) => compareNormalizedPaths(a.relativePath, b.relativePath)) }
        : {}),
      ...(input.realPath !== undefined ? { realPath: input.realPath } : {}),
      ...(input.isGenerated !== undefined ? { isGenerated: input.isGenerated } : {}),
      ...(input.parseStatus !== undefined ? { parseStatus: input.parseStatus } : {}),
    };
    this.byId.set(moduleId, rec);
    this.byKey.set(key, moduleId);
    if (realKey !== undefined) this.byReal.set(realKey, moduleId);
    return rec;
  }

  /**
   * Attach an alias spelling to the module for a physical file. Used
   * when a repo scan finds a symlinked path whose target is already a
   * registered module (e.g. a TS/Go extractor never lists symlinks).
   * Returns the merged record, or undefined when the physical file is
   * not a registered module (nothing to alias to — the caller ignores
   * it; outside-repo targets never reach here).
   */
  registerAlias(
    language: Language,
    aliasRelativePath: string,
    realPath: string,
  ): ModuleIdentity | undefined {
    const existingId = this.byReal.get(`${language}\0${realPath}`);
    if (existingId === undefined) return undefined;
    const rec = this.byId.get(existingId) as ModuleIdentity;
    return this.mergeSpelling(rec, normalizeRelativePath(aliasRelativePath), {
      language,
      relativePath: aliasRelativePath,
      contentSha256: rec.contentSha256,
    });
  }

  /**
   * Change a module's content hash without moving its identity.
   * Returns the updated record, or undefined for an unknown moduleId.
   */
  updateContent(moduleId: string, newContentSha256: string): ModuleIdentity | undefined {
    const rec = this.byId.get(moduleId);
    if (rec === undefined) return undefined;
    rec.contentSha256 = newContentSha256;
    return rec;
  }

  /** Recompute a Go package combination hash from its constituent files. */
  static goPackageContentSha256(files: ReadonlyArray<IdentityFile>): string {
    return computeGoPackageContentSha256(files);
  }

  getByModuleId(moduleId: string): ModuleIdentity | undefined {
    return this.byId.get(moduleId);
  }

  getByPath(language: Language, relativePath: string): ModuleIdentity | undefined {
    const identityPath = normalizeRelativePath(relativePath);
    const id = this.byKey.get(`${language}\0${this.adapter.fold(identityPath)}`);
    return id === undefined ? undefined : this.byId.get(id);
  }

  /** All records, sorted by (identityPath, moduleId) — NFC-first order. */
  all(): ModuleIdentity[] {
    return [...this.byId.values()].sort(
      (a, b) =>
        compareNormalizedPaths(a.identityPath, b.identityPath) ||
        (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0),
    );
  }

  /** Aliases of one module (sorted), or [] for an unknown moduleId. */
  aliasesFor(moduleId: string): string[] {
    return [...(this.byId.get(moduleId)?.aliases ?? [])];
  }

  conflicts(): IdentityConflict[] {
    return [...this.conflictList];
  }

  /**
   * Groups of distinct modules sharing one content hash, sorted by
   * (contentSha256, first relativePath). Single-module hashes are not
   * groups. This is the DUPLICATE_CONTENT signal (spec §5.2, P2):
   * same content does NOT imply same module or same semantics.
   */
  findDuplicateContent(): DuplicateContentGroup[] {
    const byContent = new Map<string, ModuleIdentity[]>();
    for (const rec of this.byId.values()) {
      const list = byContent.get(rec.contentSha256) ?? [];
      list.push(rec);
      byContent.set(rec.contentSha256, list);
    }
    const groups: DuplicateContentGroup[] = [];
    for (const [contentSha256, recs] of [...byContent.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : 1,
    )) {
      if (recs.length < 2) continue;
      const sorted = [...recs].sort((a, b) => compareNormalizedPaths(a.identityPath, b.identityPath));
      groups.push({
        contentSha256,
        moduleIds: sorted.map((r) => r.moduleId),
        relativePaths: sorted.map((r) => r.relativePath),
      });
    }
    return groups;
  }

  private mergeSpelling(
    rec: ModuleIdentity,
    identityPath: string,
    input: RegisterInput,
  ): ModuleIdentity {
    // Canonical spelling = smallest normalized path; module_id follows it.
    const candidates = new Set<string>([rec.relativePath, ...rec.aliases]);
    // identityPath is the normalized form of the new spelling; the
    // display spelling is its normalized form ("." for a Go root).
    candidates.add(identityPath === "" ? "." : identityPath);
    const sorted = [...candidates].sort(compareNormalizedPaths);
    const canonical = sorted[0] as string;
    const oldId = rec.moduleId;
    const newIdentityPath = normalizeRelativePath(canonical);
    const newId = this.moduleIdFor(rec.language, newIdentityPath);
    if (newId !== oldId) {
      // Re-key: the merged module keeps ONE id, computed over the
      // canonical path, regardless of registration order.
      this.byId.delete(oldId);
      this.byKey.delete(`${rec.language}\0${this.adapter.fold(rec.identityPath)}`);
      rec.moduleId = newId;
      this.byId.set(newId, rec);
      this.byKey.set(`${rec.language}\0${this.adapter.fold(newIdentityPath)}`, newId);
      if (rec.realPath !== undefined) {
        this.byReal.set(`${rec.language}\0${rec.realPath}`, newId);
      }
    }
    rec.relativePath = canonical;
    rec.identityPath = newIdentityPath;
    rec.aliases = sorted.slice(1);
    // Content: a re-registration with new content updates ONLY the hash.
    if (input.contentSha256 !== rec.contentSha256) {
      rec.contentSha256 = input.contentSha256;
    }
    if (input.realPath !== undefined && rec.realPath === undefined) {
      rec.realPath = input.realPath;
      this.byReal.set(`${rec.language}\0${input.realPath}`, rec.moduleId);
    }
    if (input.files !== undefined) {
      rec.files = [...input.files].sort((a, b) =>
        compareNormalizedPaths(a.relativePath, b.relativePath),
      );
    }
    if (input.isGenerated === true) rec.isGenerated = true;
    if (input.parseStatus !== undefined) {
      rec.parseStatus = worstParseStatus(rec.parseStatus, input.parseStatus);
    }
    return rec;
  }

  private recordConflict(rec: ModuleIdentity, input: RegisterInput): void {
    const realPaths = [rec.realPath, input.realPath].filter(
      (p): p is string => p !== undefined,
    ).sort();
    const detail =
      `identity key ${rec.language} + ${JSON.stringify(rec.identityPath)} ` +
      `claimed by distinct physical files ${realPaths.join(" vs ")}; ` +
      `dropped spelling ${JSON.stringify(input.relativePath)} is NOT merged ` +
      `and NOT separately registered — it stays visible only here; ` +
      `case adapter "${this.adapter.name}" (${this.adapter.caseSensitivity}) ` +
      `folds them together but the filesystem does not — kept separate`;
    if (
      !this.conflictList.some(
        (c) => c.moduleId === rec.moduleId && c.detail === detail,
      )
    ) {
      this.conflictList.push({
        moduleId: rec.moduleId,
        language: rec.language,
        identityPath: rec.identityPath,
        realPaths,
        detail,
      });
    }
  }
}
