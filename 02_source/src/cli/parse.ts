/**
 * T009 — CLI argument parsing (PROJECT_BOOK §6.4; PLAN §4.3).
 *
 * Commands:
 *   repomapverify audit --repo <path> --map <claimed-map.json>
 *       [--out <dir>] [--format json|html]
 *   repomapverify ground-truth --repo <path> [--lang python|typescript|go]
 *   repomapverify --help
 *
 * Any usage / input problem is a `UsageError`: the caller prints its
 * message and exits 3 (CLI contract §6.4). A usage error is never a
 * stack trace as the only output.
 */
import type { Language } from "../contracts/module.js";

export const USAGE = [
  "repomapverify — verify an agent's claimed repo map against the real static import graph",
  "",
  "Usage:",
  "  repomapverify audit --repo <path> --map <claimed-map.json> [--out <dir>] [--format json|html]",
  "  repomapverify ground-truth --repo <path> [--lang python|typescript|go]",
  "  repomapverify --help",
  "",
  "audit: one command runs end-to-end (validate map, build ground truth, compare, write report).",
  "  --repo <path>     repo to audit (must exist and be a directory)",
  "  --map <file>      claimed map JSON (repomapverify.claimed-map/v1)",
  "  --out <dir>       report directory (default: current directory; if it is inside the repo, <repo>-repomapverify-reports next to the repo)",
  "  --format <fmt>    json | html (default: both files are written)",
  "  Exit codes: PASS 0, FAIL 1, INCOMPLETE 2, usage/input error 3.",
  "",
  "ground-truth: print only the ground-truth JSON (debugging / Oracle comparison).",
  "  --repo <path>     repo to scan",
  "  --lang <lang>     python | typescript | go (default: all languages)",
  "  Exit code: 0 on success, 3 on usage/input error.",
].join("\n");

/** A usage / input error: exit 3 with this message, never a stack trace. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface AuditOptions {
  repo: string;
  mapPath: string;
  outDir?: string;
  format?: "json" | "html";
}

export interface GroundTruthOptions {
  repo: string;
  lang?: Language;
}

export type CliCommand =
  | { kind: "help" }
  | { kind: "audit"; options: AuditOptions }
  | { kind: "ground-truth"; options: GroundTruthOptions };

function takeValue(
  args: string[],
  i: number,
  flag: string,
): { value: string; next: number } {
  const arg = args[i] as string;
  const eq = arg.indexOf("=");
  if (eq !== -1) {
    const value = arg.slice(eq + 1);
    if (value === "") throw new UsageError(`${flag} needs a value (got empty --flag=)`);
    return { value, next: i + 1 };
  }
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError(`${flag} needs a value`);
  }
  return { value, next: i + 2 };
}

function parseFlags(
  args: string[],
  allowed: ReadonlySet<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < args.length) {
    const arg = args[i] as string;
    if (!arg.startsWith("--")) {
      throw new UsageError(`unexpected argument ${JSON.stringify(arg)} — flags must start with --`);
    }
    const name = arg.slice(2).split("=")[0] as string;
    if (!allowed.has(name)) {
      throw new UsageError(`unknown flag --${name}`);
    }
    if (out.has(name)) {
      throw new UsageError(`flag --${name} given twice`);
    }
    const { value, next } = takeValue(args, i, `--${name}`);
    out.set(name, value);
    i = next;
  }
  return out;
}

export function parseArgs(argv: string[]): CliCommand {
  // --help anywhere is help, never an error; no args is help too.
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { kind: "help" };
  }
  const [command, ...rest] = argv as [string, ...string[]];
  if (command === "help") return { kind: "help" };
  if (command === "audit") {
    const flags = parseFlags(rest, new Set(["repo", "map", "out", "format"]));
    const repo = flags.get("repo");
    if (repo === undefined) throw new UsageError("audit needs --repo <path>");
    const mapPath = flags.get("map");
    if (mapPath === undefined) throw new UsageError("audit needs --map <claimed-map.json>");
    const format = flags.get("format");
    if (format !== undefined && format !== "json" && format !== "html") {
      throw new UsageError(`--format must be json or html, got ${JSON.stringify(format)}`);
    }
    const options: AuditOptions = { repo, mapPath };
    const outDir = flags.get("out");
    if (outDir !== undefined) options.outDir = outDir;
    if (format === "json" || format === "html") options.format = format;
    return { kind: "audit", options };
  }
  if (command === "ground-truth") {
    const flags = parseFlags(rest, new Set(["repo", "lang"]));
    const repo = flags.get("repo");
    if (repo === undefined) throw new UsageError("ground-truth needs --repo <path>");
    const lang = flags.get("lang");
    if (
      lang !== undefined &&
      lang !== "python" &&
      lang !== "typescript" &&
      lang !== "go"
    ) {
      throw new UsageError(`--lang must be python, typescript or go, got ${JSON.stringify(lang)}`);
    }
    const options: GroundTruthOptions = { repo };
    if (lang === "python" || lang === "typescript" || lang === "go") {
      options.lang = lang;
    }
    return { kind: "ground-truth", options };
  }
  throw new UsageError(
    `unknown command ${JSON.stringify(command)} (expected audit, ground-truth, or --help)`,
  );
}
