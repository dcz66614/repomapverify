#!/usr/bin/env node
/**
 * P024 FIX T013 (P2-11) -- release verify.
 *
 *   npm run release:verify
 *
 * The frozen package.json script `release:verify` had no file behind
 * it. This script verifies the packages `npm run release:build`
 * produces (running the build first when the packages are absent),
 * independently of the build worktree -- the same checks T012's
 * release rehearsal (scripts/release-rehearsal.mjs) performs:
 *
 *   1. Baseline audits from this worktree's built CLI: the demo
 *      (expected exit 1, FAIL by design), control py-c01 (exit 0,
 *      PASS) and planted py-p01 (exit 1, FAIL). Exit codes AND
 *      canonicalSemanticHash values are recorded.
 *   2. Unzip source.zip to a fresh dir, install from the packaged
 *      lockfile, rebuild, re-run all three cases, and require
 *      identical exit codes and hashes to the baseline.
 *   3. Unzip dist.zip to a fresh dir, install from the packaged
 *      lockfile (runtime deps only), run the demo audit with the
 *      packaged dist directly (no rebuild), and require the same
 *      exit code and hash as the baseline.
 *
 * All work happens under TMPDIR (default <repo>/.tmp/release-verify).
 * Exits 0 only when every comparison matches.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(SCRIPT_DIR, "..");
const REPO_ROOT = join(SRC_DIR, "..");
const TMPDIR = process.env.TMPDIR || join(REPO_ROOT, ".tmp");
const BUILD_OUT = join(TMPDIR, "release-build");
const WORK = join(TMPDIR, "release-verify");
const CLI = join(SRC_DIR, "dist", "cli.js");

const FIX = join(SRC_DIR, "tests", "fixtures", "s0");
const CASES = [
  {
    name: "demo",
    repo: join(SRC_DIR, "demo", "repo"),
    map: join(SRC_DIR, "demo", "claimed-map.json"),
    expectedExit: 1,
  },
  {
    name: "control py-c01",
    repo: join(FIX, "python", "py-c01-basic-imports", "repo"),
    map: join(FIX, "python", "py-c01-basic-imports", "claimed-map.json"),
    expectedExit: 0,
  },
  {
    name: "planted py-p01",
    repo: join(FIX, "python", "py-p01-hallucinated-edge", "repo"),
    map: join(FIX, "python", "py-p01-hallucinated-edge", "claimed-map.json"),
    expectedExit: 1,
  },
];

const failures = [];
function log(msg) {
  console.log(msg);
}
function fail(msg) {
  failures.push(msg);
  log(`FAIL: ${msg}`);
}
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? SRC_DIR,
    encoding: "utf8",
    env: { ...process.env, TMPDIR },
  });
  log(`$ ${cmd} ${args.join(" ")}  (cwd: ${opts.cwd ?? SRC_DIR})`);
  if (r.stdout?.trim()) log(r.stdout.trimEnd());
  if (r.stderr?.trim()) log(`stderr: ${r.stderr.trimEnd()}`);
  log(`exit code: ${r.status}`);
  return r;
}
function auditWith(cli, c, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    process.execPath,
    [cli, "audit", "--repo", c.repo, "--map", c.map, "--out", outDir],
    { encoding: "utf8", env: { ...process.env, TMPDIR } },
  );
  const reportPath = join(outDir, "repomapverify-report.json");
  const report = existsSync(reportPath)
    ? JSON.parse(readFileSync(reportPath, "utf8"))
    : null;
  return {
    name: c.name,
    exitCode: r.status,
    status: report?.status ?? null,
    findings: report?.findings?.length ?? null,
    canonicalSemanticHash: report?.canonicalSemanticHash ?? null,
  };
}

log("== release:verify ==");
log(`packages dir: ${BUILD_OUT}`);
log(`work dir: ${WORK}`);
if (!existsSync(join(BUILD_OUT, "source.zip")) ||
    !existsSync(join(BUILD_OUT, "dist.zip"))) {
  log("packages missing -- running release:build first...");
  const b = run("node", [join(SCRIPT_DIR, "release-build.mjs")]);
  if (b.status !== 0) fail("release:build failed");
}
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

// 1. Baseline audits from this worktree's built CLI.
const baseline = {};
for (const c of CASES) {
  const r = auditWith(CLI, c, join(WORK, `baseline-${c.name.replace(/[^a-z0-9]+/g, "-")}`));
  log(`baseline ${c.name}: exit ${r.exitCode} status ${r.status} findings ${r.findings} hash ${(r.canonicalSemanticHash ?? "").slice(0, 16)}...`);
  if (r.exitCode !== c.expectedExit) {
    fail(`baseline ${c.name}: exit ${r.exitCode}, expected ${c.expectedExit}`);
  }
  baseline[c.name] = r;
}

// 2. Verify source.zip: unzip fresh, install, rebuild, re-run, compare.
const verifySrc = join(WORK, "verify-src");
mkdirSync(verifySrc, { recursive: true });
const unzipSrc = run("unzip", ["-q", join(BUILD_OUT, "source.zip"), "-d", verifySrc]);
if (unzipSrc.status !== 0) fail("unzip source.zip failed");
const ciSrc = run("npm", ["ci"], { cwd: verifySrc });
if (ciSrc.status !== 0) fail("npm ci (source.zip) failed");
const buildSrc = run("npm", ["run", "build"], { cwd: verifySrc });
if (buildSrc.status !== 0) fail("npm run build (source.zip) failed");
const packagedCli = join(verifySrc, "dist", "cli.js");
if (!existsSync(packagedCli)) fail("packaged dist/cli.js missing after rebuild");
for (const c of CASES) {
  const r = auditWith(packagedCli, c, join(WORK, `verify-src-${c.name.replace(/[^a-z0-9]+/g, "-")}`));
  log(`verify-src ${c.name}: exit ${r.exitCode} status ${r.status} findings ${r.findings} hash ${(r.canonicalSemanticHash ?? "").slice(0, 16)}...`);
  if (r.exitCode !== baseline[c.name].exitCode) {
    fail(`verify-src ${c.name}: exit ${r.exitCode}, baseline ${baseline[c.name].exitCode}`);
  }
  if (r.canonicalSemanticHash !== baseline[c.name].canonicalSemanticHash) {
    fail(`verify-src ${c.name}: hash differs from baseline`);
  }
}

// 3. Verify dist.zip: unzip fresh, install, demo audit with packaged dist.
const verifyDist = join(WORK, "verify-dist");
mkdirSync(verifyDist, { recursive: true });
const unzipDist = run("unzip", ["-q", join(BUILD_OUT, "dist.zip"), "-d", verifyDist]);
if (unzipDist.status !== 0) fail("unzip dist.zip failed");
const ciDist = run("npm", ["ci"], { cwd: verifyDist });
if (ciDist.status !== 0) fail("npm ci (dist.zip) failed");
const distCli = join(verifyDist, "dist", "cli.js");
const demo = CASES[0];
const distResult = auditWith(distCli, demo, join(WORK, "verify-dist-demo"));
log(`verify-dist demo: exit ${distResult.exitCode} status ${distResult.status} findings ${distResult.findings} hash ${(distResult.canonicalSemanticHash ?? "").slice(0, 16)}...`);
if (distResult.exitCode !== baseline.demo.exitCode) {
  fail(`verify-dist demo: exit ${distResult.exitCode}, baseline ${baseline.demo.exitCode}`);
}
if (distResult.canonicalSemanticHash !== baseline.demo.canonicalSemanticHash) {
  fail("verify-dist demo: hash differs from baseline");
}

if (failures.length > 0) {
  log(`RELEASE:VERIFY FAILED (${failures.length} failure(s))`);
  process.exit(1);
}
log("RELEASE:VERIFY PASS: exit codes and canonicalSemanticHash values identical in all verifications.");
