/**
 * R1-P2-01 regression tests (PROJECT_BOOK §0.3 read-only boundary).
 *
 * Before the fix, `audit` without `--out` wrote both reports into the
 * current directory — so auditing a repo from inside the repo wrote
 * into the audited tree and changed the next snapshot. Now the
 * default output is redirected to `<repo>-repomapverify-reports/`
 * next to the repo whenever the current directory is inside it.
 *
 * End-to-end through the real built entry (`node dist/cli.js`) with
 * the process cwd set per run (no `process.chdir`, so parallel
 * workers are unaffected), plus unit checks of the pure resolver.
 * Fixture: a copy of the py-c01 control repo (copying preserves the
 * file contents, so the bundled claimed map stays snapshot-bound).
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { resolveDefaultOutDir } from "../../src/cli/audit.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "..", "..");
const FIXTURES = join(SRC_DIR, "tests", "fixtures", "s0");
const CLI = join(SRC_DIR, "dist", "cli.js");
const JSON_REPORT = "repomapverify-report.json";
const HTML_REPORT = "repomapverify-report.html";

function tmpBase(): string {
  return mkdtempSync(join(tmpdir(), "repomapverify-r1-p2-01-"));
}

/** Copy of the py-c01 control repo + its snapshot-bound claimed map. */
function controlRepo(base: string, repoName = "billing-service"): {
  repo: string;
  mapPath: string;
} {
  const repo = join(base, repoName);
  cpSync(join(FIXTURES, "python", "py-c01-basic-imports", "repo"), repo, {
    recursive: true,
  });
  return {
    repo,
    mapPath: join(FIXTURES, "python", "py-c01-basic-imports", "claimed-map.json"),
  };
}

function runCli(args: string[], cwd: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function groundTruthSnapshot(repo: string): string {
  const r = runCli(["ground-truth", "--repo", repo, "--lang", "python"], repo);
  expect(r.status).toBe(0);
  return (JSON.parse(r.stdout) as { repoSnapshotSha256: string }).repoSnapshotSha256;
}

beforeAll(() => {
  // The S0 gate builds before running tests; rebuild only when dist
  // is missing so a test run never races a concurrent rebuild.
  if (!existsSync(CLI)) {
    execFileSync("npm", ["run", "build"], { cwd: SRC_DIR, stdio: "pipe" });
  }
}, 300_000);

describe("resolveDefaultOutDir (unit)", () => {
  test("cwd outside the repo: current directory, unchanged", () => {
    expect(resolveDefaultOutDir("/work/billing-service", "/work")).toBe("/work");
    expect(resolveDefaultOutDir("/work/billing-service", "/tmp/other")).toBe("/tmp/other");
  });

  test("cwd is the repo root: sibling <repo>-repomapverify-reports", () => {
    expect(resolveDefaultOutDir("/work/billing-service", "/work/billing-service")).toBe(
      "/work/billing-service-repomapverify-reports",
    );
  });

  test("cwd is a subdirectory of the repo: same sibling directory", () => {
    expect(
      resolveDefaultOutDir("/work/billing-service", "/work/billing-service/billing"),
    ).toBe("/work/billing-service-repomapverify-reports");
  });

  test("a similarly-named sibling is not treated as inside the repo", () => {
    expect(
      resolveDefaultOutDir("/work/billing-service", "/work/billing-service-old"),
    ).toBe("/work/billing-service-old");
  });
});

describe("audit without --out (end-to-end)", () => {
  test("cwd is the repo root: no file written into the repo; reports go next to it", () => {
    const base = tmpBase();
    const { repo, mapPath } = controlRepo(base);
    const snapBefore = groundTruthSnapshot(repo);

    const r = runCli(["audit", "--repo", repo, "--map", mapPath], repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RESULT: PASS");

    // Nothing written into the audited tree.
    const repoFiles = readdirSync(repo);
    expect(repoFiles).not.toContain(JSON_REPORT);
    expect(repoFiles).not.toContain(HTML_REPORT);
    // The snapshot is unchanged: the next audit sees the same tree.
    expect(groundTruthSnapshot(repo)).toBe(snapBefore);

    // Reports land in the sibling directory, and stdout says so.
    const sibling = join(base, "billing-service-repomapverify-reports");
    expect(existsSync(join(sibling, JSON_REPORT))).toBe(true);
    expect(existsSync(join(sibling, HTML_REPORT))).toBe(true);
    expect(JSON.parse(readFileSync(join(sibling, JSON_REPORT), "utf8")).status).toBe("PASS");
    expect(r.stdout).toContain(`Report: ${join(sibling, JSON_REPORT)}`);
    expect(r.stdout).toContain(`Report: ${join(sibling, HTML_REPORT)}`);
  });

  test("cwd is a subdirectory of the repo: same sibling directory", () => {
    const base = tmpBase();
    const { repo, mapPath } = controlRepo(base);
    const subdir = join(repo, "billing");
    expect(existsSync(subdir)).toBe(true);

    const r = runCli(["audit", "--repo", repo, "--map", mapPath], subdir);
    expect(r.status).toBe(0);
    expect(readdirSync(repo)).not.toContain(JSON_REPORT);
    const sibling = join(base, "billing-service-repomapverify-reports");
    expect(existsSync(join(sibling, JSON_REPORT))).toBe(true);
    expect(existsSync(join(sibling, HTML_REPORT))).toBe(true);
  });

  test("cwd outside the repo: reports still go to the current directory", () => {
    const base = tmpBase();
    const { repo, mapPath } = controlRepo(base);
    const elsewhere = join(base, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });

    const r = runCli(["audit", "--repo", repo, "--map", mapPath], elsewhere);
    expect(r.status).toBe(0);
    expect(existsSync(join(elsewhere, JSON_REPORT))).toBe(true);
    expect(existsSync(join(elsewhere, HTML_REPORT))).toBe(true);
    // And no sibling directory was created for this case.
    expect(existsSync(join(base, "billing-service-repomapverify-reports"))).toBe(false);
  });

  test("explicit --out inside the repo is still honoured exactly as given", () => {
    const base = tmpBase();
    const { repo, mapPath } = controlRepo(base);
    const explicit = join(repo, "my-reports");

    const r = runCli(
      ["audit", "--repo", repo, "--map", mapPath, "--out", explicit],
      repo,
    );
    expect(r.status).toBe(0);
    expect(existsSync(join(explicit, JSON_REPORT))).toBe(true);
    expect(existsSync(join(explicit, HTML_REPORT))).toBe(true);
    expect(existsSync(join(base, "billing-service-repomapverify-reports"))).toBe(false);
  });
});
