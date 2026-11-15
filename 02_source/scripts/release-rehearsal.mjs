/**
 * T012 release rehearsal (PLAN T012 item 4; the shape T014 will use).
 *
 * Builds the release the way T014 will — `npm run build`, then a
 * source.zip + dist.zip + SHA256SUMS.txt rehearsal — in a scratch
 * directory under .tmp/ (NOT 05_release/, which is T014's), then
 * VERIFIES the rehearsal package independently:
 *
 *   1. unzip source.zip to a fresh dir, `npm ci` from the packaged
 *      lockfile, rebuild, run the demo audit + one control fixture
 *      (py-c01) + one planted fixture (py-p01), and confirm identical
 *      exit codes AND identical canonicalSemanticHash values to the
 *      baseline runs from this worktree.
 *   2. unzip dist.zip to a fresh dir, `npm ci` from the packaged
 *      lockfile (installs the declared runtime deps only), run the
 *      demo audit with the packaged dist directly (no rebuild), and
 *      confirm the same exit code + hash.
 *
 * source.zip contains the full buildable source tree (package.json,
 * package-lock.json, tsconfigs, src/, oracle/, tests/, demo/, docs/,
 * README, LICENSE, .github workflow). dist.zip contains the built
 * dist/ plus package.json + package-lock.json (needed to install the
 * runtime deps) + README + LICENSE.
 *
 * Usage: node scripts/release-rehearsal.mjs
 *   (run with TMPDIR pointed at the repo .tmp dir)
 * Writes 03_evidence/T012/REHEARSAL.json and prints a full log.
 * Exits 0 only when every comparison matches.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(SCRIPT_DIR, "..");
const REPO_ROOT = join(SRC_DIR, "..");
const TMPDIR = process.env.TMPDIR || join(REPO_ROOT, ".tmp");
const WORK = join(TMPDIR, "rehearsal");
const EVIDENCE = join(REPO_ROOT, "03_evidence", "T012");
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
function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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
    stdout: r.stdout ?? "",
  };
}

log("== T012 release rehearsal ==");
log(`work dir: ${WORK}`);
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(EVIDENCE, { recursive: true });

// 1. Build the way T014 will.
const build = run("npm", ["run", "build"]);
if (build.status !== 0) fail("npm run build failed");

// 2. Stage the source tree.
const stageSrc = join(WORK, "stage-src");
mkdirSync(stageSrc, { recursive: true });
for (const f of ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "README.md"]) {
  cpSync(join(SRC_DIR, f), join(stageSrc, f));
}
cpSync(join(REPO_ROOT, "LICENSE"), join(stageSrc, "LICENSE"));
for (const d of ["src", "oracle", "tests", "demo", "docs", "scripts"]) {
  cpSync(join(SRC_DIR, d), join(stageSrc, d), { recursive: true });
}
if (existsSync(join(SRC_DIR, ".github"))) {
  cpSync(join(SRC_DIR, ".github"), join(stageSrc, ".github"), { recursive: true });
}
rmSync(join(stageSrc, "demo", "out"), { recursive: true, force: true });
log(`staged source tree: ${readdirSync(stageSrc).join(", ")}`);

// 3. Stage the dist tree.
const stageDist = join(WORK, "stage-dist");
mkdirSync(stageDist, { recursive: true });
cpSync(join(SRC_DIR, "dist"), join(stageDist, "dist"), { recursive: true });
for (const f of ["package.json", "package-lock.json", "README.md"]) {
  cpSync(join(SRC_DIR, f), join(stageDist, f));
}
cpSync(join(REPO_ROOT, "LICENSE"), join(stageDist, "LICENSE"));
log(`staged dist tree: ${readdirSync(stageDist).join(", ")}`);

// 4. Zip + SHA256SUMS.txt (rehearsal only; NOT 05_release/).
const zipSrc = run("zip", ["-qr", "-X", join(WORK, "source.zip"), "."], { cwd: stageSrc });
if (zipSrc.status !== 0) fail("zip source.zip failed");
const zipDist = run("zip", ["-qr", "-X", join(WORK, "dist.zip"), "."], { cwd: stageDist });
if (zipDist.status !== 0) fail("zip dist.zip failed");
const sums = run("sha256sum", ["source.zip", "dist.zip"], { cwd: WORK });
if (sums.status !== 0) fail("sha256sum failed");
writeFileSync(join(WORK, "SHA256SUMS.txt"), sums.stdout);
const sourceZipSha = sha256File(join(WORK, "source.zip"));
const distZipSha = sha256File(join(WORK, "dist.zip"));
log(`source.zip sha256: ${sourceZipSha}`);
log(`dist.zip sha256:   ${distZipSha}`);
log("SHA256SUMS.txt:");
log(readFileSync(join(WORK, "SHA256SUMS.txt"), "utf8").trimEnd());

// 5. Baseline audits from this worktree's built CLI.
const baseline = {};
for (const c of CASES) {
  const r = auditWith(CLI, c, join(WORK, `baseline-${c.name.replace(/[^a-z0-9]+/g, "-")}`));
  log(`baseline ${c.name}: exit ${r.exitCode} status ${r.status} findings ${r.findings} hash ${(r.canonicalSemanticHash ?? "").slice(0, 16)}...`);
  if (r.exitCode !== c.expectedExit) {
    fail(`baseline ${c.name}: exit ${r.exitCode}, expected ${c.expectedExit}`);
  }
  baseline[c.name] = r;
}

// 6. Verify source.zip: unzip fresh, npm ci from packaged lockfile,
//    rebuild, re-run all three cases, compare exit codes + hashes.
const verifySrc = join(WORK, "verify-src");
mkdirSync(verifySrc, { recursive: true });
const unzipSrc = run("unzip", ["-q", join(WORK, "source.zip"), "-d", verifySrc]);
if (unzipSrc.status !== 0) fail("unzip source.zip failed");
const ciSrc = run("npm", ["ci"], { cwd: verifySrc });
if (ciSrc.status !== 0) fail("npm ci (source.zip) failed");
const buildSrc = run("npm", ["run", "build"], { cwd: verifySrc });
if (buildSrc.status !== 0) fail("npm run build (source.zip) failed");
const packagedCli = join(verifySrc, "dist", "cli.js");
if (!existsSync(packagedCli)) fail("packaged dist/cli.js missing after rebuild");
const verifySourceResults = {};
for (const c of CASES) {
  const r = auditWith(packagedCli, c, join(WORK, `verify-src-${c.name.replace(/[^a-z0-9]+/g, "-")}`));
  log(`verify-src ${c.name}: exit ${r.exitCode} status ${r.status} findings ${r.findings} hash ${(r.canonicalSemanticHash ?? "").slice(0, 16)}...`);
  if (r.exitCode !== baseline[c.name].exitCode) {
    fail(`verify-src ${c.name}: exit ${r.exitCode}, baseline ${baseline[c.name].exitCode}`);
  }
  if (r.canonicalSemanticHash !== baseline[c.name].canonicalSemanticHash) {
    fail(`verify-src ${c.name}: hash differs from baseline`);
  }
  verifySourceResults[c.name] = r;
}

// 7. Verify dist.zip: unzip fresh, npm ci (runtime deps only), run the
//    demo audit with the packaged dist directly (no rebuild).
const verifyDist = join(WORK, "verify-dist");
mkdirSync(verifyDist, { recursive: true });
const unzipDist = run("unzip", ["-q", join(WORK, "dist.zip"), "-d", verifyDist]);
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

// 8. Record the rehearsal.
const rehearsal = {
  workDir: WORK,
  packages: {
    sourceZip: { file: "source.zip", sha256: sourceZipSha },
    distZip: { file: "dist.zip", sha256: distZipSha },
    sumsFile: "SHA256SUMS.txt",
  },
  baseline: Object.fromEntries(
    Object.entries(baseline).map(([k, v]) => [
      k,
      { exitCode: v.exitCode, status: v.status, findings: v.findings, canonicalSemanticHash: v.canonicalSemanticHash },
    ]),
  ),
  verifySourceZip: Object.fromEntries(
    Object.entries(verifySourceResults).map(([k, v]) => [
      k,
      { exitCode: v.exitCode, status: v.status, findings: v.findings, canonicalSemanticHash: v.canonicalSemanticHash },
    ]),
  ),
  verifyDistZip: {
    demo: {
      exitCode: distResult.exitCode,
      status: distResult.status,
      findings: distResult.findings,
      canonicalSemanticHash: distResult.canonicalSemanticHash,
    },
  },
  identicalExitCodesAndHashes: failures.length === 0,
  failures,
};
writeFileSync(join(EVIDENCE, "REHEARSAL.json"), JSON.stringify(rehearsal, null, 2) + "\n");
log(`wrote ${join(EVIDENCE, "REHEARSAL.json")}`);
if (failures.length > 0) {
  log(`REHEARSAL FAILED (${failures.length} failure(s))`);
  process.exit(1);
}
log("REHEARSAL PASS: exit codes and canonicalSemanticHash values identical in all verifications.");
