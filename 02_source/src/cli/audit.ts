/**
 * T009 — `audit` command (PROJECT_BOOK §6.4, §7; PLAN T009).
 *
 * One command runs end-to-end: validate the claimed map, build the
 * ground-truth graph, collect comparator evidence, compare, and
 * write the JSON and/or static HTML report. Exit codes strictly
 * match the audit status (PASS 0, FAIL 1, INCOMPLETE 2); any usage /
 * input problem is a `UsageError` (exit 3) with a clear message,
 * never a stack trace as the only output.
 *
 * Read-only: the repo and the claimed map are never modified; only
 * the `--out` directory is written.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { EXIT_CODES } from "../contracts/findings.js";
import { parseClaimedMapJson } from "../io/validate-claimed-map.js";
import { buildGroundTruthGraphFromRepo } from "../graph/fromRepo.js";
import { compareMapsDetailed } from "../comparator/compare.js";
import { buildFullReport } from "../report/build-report.js";
import { renderHtmlReport } from "../report/render-html.js";
import { redactText } from "../privacy/redact.js";
import { collectEvidence } from "./evidence.js";
import { UsageError, type AuditOptions } from "./parse.js";

export interface Writers {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export const DEFAULT_WRITERS: Writers = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

export const JSON_REPORT_FILENAME = "repomapverify-report.json";
export const HTML_REPORT_FILENAME = "repomapverify-report.html";

/**
 * Resolve the default report directory (R1-P2-01; PROJECT_BOOK §0.3
 * read-only boundary: a default audit must never write into the repo
 * it audits, or the reports would change the next snapshot).
 *
 * - Current directory outside the repo: the current directory
 *   (unchanged historical behaviour).
 * - Current directory inside the repo (including the repo root
 *   itself): `<repo-name>-repomapverify-reports/` next to the repo,
 *   i.e. a sibling directory outside the audited tree.
 * - Degenerate repo path with no basename (e.g. `/`): the OS temp
 *   directory, which is never inside the repo.
 *
 * An explicit `--out` is always honoured exactly as given; only the
 * *default* is redirected.
 */
export function resolveDefaultOutDir(repoRoot: string, cwd: string = process.cwd()): string {
  const repoAbs = resolve(repoRoot);
  const cwdAbs = resolve(cwd);
  const insideRepo = cwdAbs === repoAbs || cwdAbs.startsWith(repoAbs + sep);
  if (!insideRepo) return cwdAbs;
  const base = basename(repoAbs);
  if (base === "") return join(tmpdir(), "repomapverify-reports");
  return join(dirname(repoAbs), `${base}-repomapverify-reports`);
}

function resolveRepoDir(repo: string): string {
  const abs = resolve(repo);
  let st;
  try {
    st = statSync(abs);
  } catch {
    throw new UsageError(`repo path does not exist: ${JSON.stringify(repo)}`);
  }
  if (!st.isDirectory()) {
    throw new UsageError(`repo path is not a directory: ${JSON.stringify(repo)}`);
  }
  return abs;
}

function readMapFile(mapPath: string): string {
  const abs = resolve(mapPath);
  if (!existsSync(abs)) {
    throw new UsageError(`claimed map file does not exist: ${JSON.stringify(mapPath)}`);
  }
  try {
    return readFileSync(abs, "utf8");
  } catch (e) {
    throw new UsageError(
      `cannot read claimed map file ${JSON.stringify(mapPath)}: ${e instanceof Error ? redactText(e.message) : "read error"}`,
    );
  }
}

function summaryLine(label: string, value: string): string {
  return `${label}: ${value}\n`;
}

/**
 * Run one audit. Returns the process exit code (0 PASS, 1 FAIL,
 * 2 INCOMPLETE). Throws UsageError (exit 3) on usage/input errors.
 */
export async function runAudit(
  options: AuditOptions,
  writers: Writers = DEFAULT_WRITERS,
): Promise<number> {
  const repoRoot = resolveRepoDir(options.repo);
  const mapText = readMapFile(options.mapPath);
  const checked = parseClaimedMapJson(mapText);
  if (!checked.ok) {
    const detail = checked.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    throw new UsageError(`invalid claimed map: ${detail}`);
  }
  const map = checked.map;
  const warnings = checked.warnings.map((w) => `${w.field}: ${w.message}`);

  let built;
  try {
    built = await buildGroundTruthGraphFromRepo(repoRoot);
  } catch (e) {
    throw new UsageError(
      `cannot build ground truth from repo ${JSON.stringify(options.repo)}: ${e instanceof Error ? redactText(e.message) : "build error"}`,
    );
  }
  const { evidence, edgeEvidence } = await collectEvidence(repoRoot);
  const detailed = compareMapsDetailed(built, map, evidence);
  const report = buildFullReport({
    built,
    claimed: map,
    detailed,
    edgeEvidence,
    repoRoot,
    mapWarnings: warnings,
  });

  const outDirArg = options.outDir ?? resolveDefaultOutDir(repoRoot);
  const outDirAbs = resolve(outDirArg);
  mkdirSync(outDirAbs, { recursive: true });
  const written: string[] = [];
  const wantJson = options.format === undefined || options.format === "json";
  const wantHtml = options.format === undefined || options.format === "html";
  if (wantJson) {
    writeFileSync(
      join(outDirAbs, JSON_REPORT_FILENAME),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    written.push(join(outDirArg, JSON_REPORT_FILENAME));
  }
  if (wantHtml) {
    writeFileSync(join(outDirAbs, HTML_REPORT_FILENAME), renderHtmlReport(report), "utf8");
    written.push(join(outDirArg, HTML_REPORT_FILENAME));
  }

  const { status } = report;
  const p1 = report.findings.filter((f) => f.severity === "P1").length;
  const p2 = report.findings.filter((f) => f.severity === "P2").length;
  const out = writers.stdout;
  out(`\nRESULT: ${status}\n`);
  out(summaryLine("Ground truth", `${report.groundTruth.modules} modules, ${report.groundTruth.edges} edges`));
  out(summaryLine("Claimed", `${report.claimed.modules} modules, ${report.claimed.edges} edges`));
  const { verifiedClaims, totalClaims } = report.coverage;
  const pct =
    totalClaims === 0 ? "n/a" : `${((verifiedClaims / totalClaims) * 100).toFixed(1)}%`;
  out(summaryLine("Coverage", `${verifiedClaims} / ${totalClaims} (${pct})`));
  out(
    summaryLine(
      "Findings",
      `${report.findings.length} (P1: ${p1}, P2: ${p2}) + ${report.infoFindings.length} informational`,
    ),
  );
  if (report.snapshotStatus === "STALE_SNAPSHOT") {
    out("Snapshot: STALE_SNAPSHOT — the map describes a different tree; no blame findings reported.\n");
  }
  for (const w of warnings) {
    out(`Warning: ${redactText(w, { repoRoot })}\n`);
  }
  for (const f of report.findings) {
    const edge = f.to !== undefined ? ` -> ${f.to}` : "";
    out(`  ${f.severity} ${f.id}: ${f.from ?? ""}${edge}\n`);
  }
  for (const path of written) {
    out(`Report: ${path}\n`);
  }
  return EXIT_CODES[status];
}
