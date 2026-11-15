/**
 * T008 — Privacy redaction (PROJECT_BOOK §4.2 rule 5, §9; PLAN §7.3).
 *
 * Guarantee: absolute filesystem paths and usernames NEVER appear in
 * report / JSON output. Redaction is applied at the I/O boundary —
 * validator error messages, adapter notes and anything handed to the
 * report layer (T009) go through here first.
 *
 * Rules (frozen by T008):
 * 1. A path under `repoRoot` becomes the repo-relative path
 *    (e.g. `/home/alice/work/repo/billing/api.py` with
 *    repoRoot `/home/alice/work/repo` -> `billing/api.py`).
 * 2. A path under the user's home dir (but outside the repo) becomes
 *    `~/...` — the `~` placeholder keeps the shape without the name.
 * 3. Any other absolute path (POSIX or Windows `C:\...` / `C:/...`)
 *    becomes the stated placeholder `<redacted-absolute-path>`.
 * 4. The username itself is redacted to `<user>` wherever it occurs
 *    as a whole word (path segment or standalone token). Bare
 *    usernames inside ordinary prose words are NOT touched
 *    (`\b<username>\b` only, so `sample` never matches user `sam`).
 * 5. `file://` URLs that embed an absolute path are redacted the
 *    same way; `http(s)://` URLs are left untouched (they are not
 *    filesystem paths).
 *
 * The username / home dir default to the current process user
 * (`os.homedir()` / `os.userInfo()`); callers auditing someone
 * else's paths pass them explicitly. Redaction is pure string
 * work — it never reads the filesystem.
 */
import { homedir, userInfo } from "node:os";

export const ABSOLUTE_PATH_PLACEHOLDER = "<redacted-absolute-path>" as const;
export const USER_PLACEHOLDER = "<user>" as const;

export interface RedactionOptions {
  /** Absolute path of the repo root; paths under it become relative. */
  repoRoot?: string;
  /** User's home directory; defaults to os.homedir(). */
  homeDir?: string;
  /** Username to redact; defaults to the home-dir basename. */
  username?: string;
  /** Placeholder for absolute paths outside repo/home. */
  absolutePlaceholder?: string;
  /** Placeholder for the username. */
  userPlaceholder?: string;
}

interface ResolvedOptions {
  repoRoot?: string;
  homeDir?: string;
  username?: string;
  absolutePlaceholder: string;
  userPlaceholder: string;
}

function resolveOptions(opts?: RedactionOptions): ResolvedOptions {
  let homeDir = opts?.homeDir;
  if (homeDir === undefined) {
    try {
      homeDir = homedir();
    } catch {
      homeDir = undefined;
    }
  }
  let username = opts?.username;
  if (username === undefined) {
    if (homeDir !== undefined) {
      const base = homeDir.replace(/\\/g, "/").split("/").filter(Boolean).pop();
      if (base !== undefined && base !== "" && base !== "home" && base !== "Users") {
        username = base;
      }
    }
    if (username === undefined) {
      try {
        username = userInfo().username;
      } catch {
        username = undefined;
      }
    }
  }
  return {
    ...(opts?.repoRoot !== undefined ? { repoRoot: opts.repoRoot } : {}),
    ...(homeDir !== undefined ? { homeDir } : {}),
    ...(username !== undefined && username !== "" ? { username } : {}),
    absolutePlaceholder: opts?.absolutePlaceholder ?? ABSOLUTE_PATH_PLACEHOLDER,
    userPlaceholder: opts?.userPlaceholder ?? USER_PLACEHOLDER,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Normalize a path to POSIX separators for prefix comparison. */
function posix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Replace occurrences of `root` as a path prefix (root followed by a
 * separator) or as a standalone path (root at end of string).
 * `slashReplacement` is used when a separator follows ("" for a repo
 * root -> relative path; "~/" for a home dir), `endReplacement` when
 * the root is the whole remainder ("." / "~").
 */
function replaceRootPrefix(
  out: string,
  root: string,
  slashReplacement: string,
  endReplacement: string,
): string {
  const re = new RegExp(`${escapeRegExp(root)}([\\\\/]|$)`, "g");
  return out.replace(re, (_m, sep: string) =>
    sep === "" ? endReplacement : slashReplacement,
  );
}

/**
 * Redact absolute paths and the username in one string. Relative
 * paths pass through unchanged.
 */
export function redactText(text: string, opts?: RedactionOptions): string {
  const o = resolveOptions(opts);
  let out = text;

  // 1. Repo-root prefix -> relative path (both separator spellings).
  if (o.repoRoot !== undefined && o.repoRoot !== "") {
    for (const root of [o.repoRoot, posix(o.repoRoot)]) {
      out = replaceRootPrefix(out, root, "", ".");
    }
  }

  // 2. Home-dir prefix -> ~/... (both separator spellings).
  if (o.homeDir !== undefined && o.homeDir !== "") {
    for (const home of [o.homeDir, posix(o.homeDir)]) {
      out = replaceRootPrefix(out, home, "~/", "~");
    }
  }

  // 3. Remaining Windows absolute paths: C:\... or C:/...
  out = out.replace(
    /[A-Za-z]:(?:\\[^\\/:*?"<>|\r\n]*)+(?:\\[^\\/:*?"<>|\r\n]*)?/g,
    o.absolutePlaceholder,
  );
  out = out.replace(
    /[A-Za-z]:\/(?:[^/\s"'\\]+)(?:\/[^/\s"'\\]*)*/g,
    o.absolutePlaceholder,
  );

  // 4. Remaining POSIX absolute paths. The lookbehind keeps
  // HTTP(S) URLs and already-redacted `~/...` paths untouched:
  // a leading `/` is only a filesystem path when it is NOT preceded
  // by a word char, `:`, another `/`, `-` or `~`.
  out = out.replace(
    /(?<![A-Za-z0-9_:/~-])\/(?:[A-Za-z0-9._~%+-]+\/)*[A-Za-z0-9._~%+-]+/g,
    o.absolutePlaceholder,
  );

  // 5. The username as a whole word (path segment or token).
  if (o.username !== undefined && o.username.length >= 3) {
    out = out.replace(
      new RegExp(`\\b${escapeRegExp(o.username)}\\b`, "g"),
      o.userPlaceholder,
    );
  }
  return out;
}

/**
 * Deep redaction of any JSON-shaped value (objects, arrays, strings).
 * Keys are redacted too — a path must not leak as a key either.
 * Returns a new value; the input is never mutated.
 */
export function redactValue(value: unknown, opts?: RedactionOptions): unknown {
  if (typeof value === "string") return redactText(value, opts);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, opts));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[redactText(k, opts)] = redactValue(v, opts);
    }
    return out;
  }
  return value;
}

/** Alias: the single entry point for anything handed to report output. */
export function redactForOutput(
  value: unknown,
  opts?: RedactionOptions,
): unknown {
  return redactValue(value, opts);
}

/** One leak found by `findLeaks`. `location` is a JSON path, e.g. `$.modules[0].path`. */
export interface LeakFinding {
  kind: "absolute-path" | "home-dir" | "username";
  location: string;
}

const POSIX_ABS_RE =
  /(?<![A-Za-z0-9_:/~-])\/(?:[A-Za-z0-9._~%+-]+\/)*[A-Za-z0-9._~%+-]+/;
const WIN_ABS_RE = /[A-Za-z]:(?:\\|\/)/;

/**
 * Scan a JSON-shaped value for leaks WITHOUT returning the sensitive
 * text itself: findings carry only the kind and the JSON path, so
 * this helper is safe to log. Test/diagnostic use only — it never
 * writes to a report.
 */
export function findLeaks(
  value: unknown,
  opts?: RedactionOptions,
): LeakFinding[] {
  const o = resolveOptions(opts);
  const findings: LeakFinding[] = [];
  const visit = (v: unknown, location: string): void => {
    if (typeof v === "string") {
      if (o.homeDir !== undefined && o.homeDir !== "" && v.includes(o.homeDir)) {
        findings.push({ kind: "home-dir", location });
      } else if (POSIX_ABS_RE.test(v) || WIN_ABS_RE.test(v)) {
        findings.push({ kind: "absolute-path", location });
      }
      if (
        o.username !== undefined &&
        o.username.length >= 3 &&
        new RegExp(`\\b${escapeRegExp(o.username)}\\b`).test(v)
      ) {
        // A username inside an already-flagged absolute path is the
        // same leak, not a second one — but a bare username elsewhere
        // is its own finding.
        if (!findings.some((f) => f.location === location)) {
          findings.push({ kind: "username", location });
        }
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => visit(item, `${location}[${i}]`));
      return;
    }
    if (v !== null && typeof v === "object") {
      for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
        visit(item, `${location}.${k}`);
      }
    }
  };
  visit(value, "$");
  return findings;
}
