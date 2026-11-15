#!/usr/bin/env node
/**
 * P024 T010 -- demo runner.
 *
 *   npm run demo
 *
 * Runs the bundled demo audit (02_source/demo/repo + demo/claimed-map.json)
 * and prints how long it took. The demo map is intentionally wrong: it
 * claims one edge that does not exist and omits one real edge, so the
 * expected result is FAIL with exit code 1. That exit code is the point
 * of the demo -- a wrong map must fail -- so this script exits with the
 * audit's own exit code instead of masking it as success.
 *
 * Offline: the audit only reads local files and runs the local build.
 * If dist/ is missing (clean checkout), the build runs first.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(PKG_DIR, "dist", "cli.js");
const OUT_DIR = join(PKG_DIR, "demo", "out");

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: PKG_DIR, stdio: "inherit", ...opts });
  if (res.error) {
    console.error(`demo: failed to run ${cmd}: ${res.error.message}`);
    process.exit(3);
  }
  return res.status ?? 3;
}

if (!existsSync(CLI)) {
  console.log("demo: dist/ missing (clean checkout) -- building first...");
  const buildCode = run("npm", ["run", "build"]);
  if (buildCode !== 0) {
    console.error(`demo: build failed (exit ${buildCode})`);
    process.exit(buildCode);
  }
}

mkdirSync(OUT_DIR, { recursive: true });

const started = Date.now();
const code = run("node", [
  CLI,
  "audit",
  "--repo", join(PKG_DIR, "demo", "repo"),
  "--map", join(PKG_DIR, "demo", "claimed-map.json"),
  "--out", OUT_DIR,
]);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log("");
console.log(`demo: audit finished in ${seconds}s, exit code ${code}`);
console.log(`demo: report: ${join(OUT_DIR, "repomapverify-report.json")}`);
console.log(`demo: report: ${join(OUT_DIR, "repomapverify-report.html")}`);
if (code === 1) {
  console.log("demo: expected outcome -- the demo map is intentionally wrong (FAIL).");
  console.log("demo: to see a PASS, remove the auth.py -> pricing.py edge and add");
  console.log("demo: the cart.py -> pricing.py edge in demo/claimed-map.json.");
}
process.exit(code);
