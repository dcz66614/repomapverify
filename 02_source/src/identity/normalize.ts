/**
 * T005 — Path normalization and platform case adapters
 * (PROJECT_BOOK §4.2 rules 5–6; IMPLEMENTATION_PLAN T005).
 *
 * Normalization order is frozen:
 *   1. Unicode NFC first.
 *   2. Backslashes become forward slashes; "." segments collapse;
 *      a leading "./" is stripped (contracts.normalizeRelativePath).
 *   3. Sort order is by the NFC-normalized string (see
 *      compareNormalizedPaths) — never by a locale collation, never by
 *      raw (possibly NFD) bytes.
 *   4. Case handling comes ONLY from an explicit platform adapter
 *      (below). It is never guessed from a path string: on a
 *      case-insensitive filesystem "Foo/Bar.py" and "foo/bar.py" are the
 *      same identity key; on a case-sensitive one they are two modules;
 *      when the filesystem semantics are unknown the adapter reports
 *      "unknown" and does NOT fold — the two spellings stay separate
 *      modules and the ambiguity is reported, not silently merged.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeRelativePath } from "../contracts/module.js";

/** What a filesystem does with path case. */
export type CaseSensitivity = "sensitive" | "insensitive" | "unknown";

/**
 * A platform case adapter. `fold` maps a normalized relative path to
 * its identity key component: the identity function on case-sensitive
 * filesystems, NFC + lowercase on case-insensitive ones. The "unknown"
 * adapter never folds.
 */
export interface PlatformCaseAdapter {
  readonly caseSensitivity: CaseSensitivity;
  readonly name: string;
  fold(normalizedRelativePath: string): string;
}

/** POSIX / Linux default: case-sensitive, no folding. */
export function posixCaseAdapter(): PlatformCaseAdapter {
  return {
    caseSensitivity: "sensitive",
    name: "posix",
    fold: (p: string): string => p,
  };
}

/** Windows (NTFS default): case-insensitive — fold to lowercase. */
export function windowsCaseAdapter(): PlatformCaseAdapter {
  return {
    caseSensitivity: "insensitive",
    name: "windows",
    fold: (p: string): string => p.normalize("NFC").toLowerCase(),
  };
}

/** macOS (APFS default): case-insensitive — fold to lowercase. */
export function macosCaseAdapter(): PlatformCaseAdapter {
  return {
    caseSensitivity: "insensitive",
    name: "macos",
    fold: (p: string): string => p.normalize("NFC").toLowerCase(),
  };
}

/**
 * Unknown filesystem semantics: never fold, never guess. Two paths
 * differing only by case stay two modules; callers that need to warn
 * about a possible collision can use `caseOnlyDiffers`.
 */
export function unknownCaseAdapter(): PlatformCaseAdapter {
  return {
    caseSensitivity: "unknown",
    name: "unknown",
    fold: (p: string): string => p,
  };
}

/** Adapter for the platform this process runs on. */
export function detectPlatformAdapter(
  platform: NodeJS.Platform = process.platform,
): PlatformCaseAdapter {
  if (platform === "win32") return windowsCaseAdapter();
  if (platform === "darwin") return macosCaseAdapter();
  if (platform === "linux") return posixCaseAdapter();
  return unknownCaseAdapter();
}

/**
 * Probe a directory's real case semantics instead of trusting the OS
 * name: create a probe file "CaseProbe-<rand>" and check whether the
 * lowercase spelling resolves to the same file. The probe lives in a
 * fresh mkdtemp directory under `baseDir` (never inside the repo under
 * audit) and is removed afterwards. Returns "insensitive" only when the
 * lowercase spelling is observed to resolve; anything else (including
 * any error) is "sensitive" — the conservative reading for a probe
 * that could not prove insensitivity is NOT "unknown": the probe ran
 * on this exact filesystem, so a negative result is evidence.
 */
export function probeCaseSensitivity(baseDir: string = tmpdir()): CaseSensitivity {
  const dir = mkdtempSync(join(baseDir, "repomapverify-case-probe-"));
  try {
    const probeName = `CaseProbe-${process.pid}`;
    writeFileSync(join(dir, probeName), "probe");
    return existsSync(join(dir, probeName.toLowerCase()))
      ? "insensitive"
      : "sensitive";
  } catch {
    return "sensitive";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Full identity normalization for one repo-relative path: contract
 * normalization (NFC, slashes, "." collapse) followed by the adapter's
 * case fold. The result is the identity-key component fed to
 * computeModuleId — NOT a display path (display keeps the canonical
 * spelling; see IdentityRegistry).
 */
export function normalizeIdentityPath(
  p: string,
  adapter: PlatformCaseAdapter = posixCaseAdapter(),
): string {
  return adapter.fold(normalizeRelativePath(p));
}

/**
 * Deterministic sort comparator for normalized paths: NFC first, then
 * plain code-unit order. Two spellings of the same path (NFD vs NFC)
 * compare equal here because both sides are NFC-normalized first.
 */
export function compareNormalizedPaths(a: string, b: string): number {
  const na = a.normalize("NFC");
  const nb = b.normalize("NFC");
  return na < nb ? -1 : na > nb ? 1 : 0;
}

/** True when the two paths differ ONLY by case (after NFC + slash normalization). */
export function caseOnlyDiffers(a: string, b: string): boolean {
  const na = normalizeRelativePath(a);
  const nb = normalizeRelativePath(b);
  return na !== nb && na.toLowerCase() === nb.toLowerCase();
}
