#!/usr/bin/env node
/**
 * T002 PoC audit runner (S0, Python only).
 *
 * Runs the production build and the T002 vitest suites, which write the
 * evidence files:
 *   03_evidence/T002/POC_RUN.json  — per-fixture results (machine-readable)
 *   03_evidence/T002/POC_RUN.log   — per-fixture results (human-readable)
 *
 * This script is a thin entry point for the handoff's acceptance
 * commands. The real S0 gate (all 48 fixtures, Oracle parity, repeat
 * hash) is T004's scripts/s0-gate.mjs — this PoC runner is superseded
 * by it and must not be extended into a gate.
 *
 * Usage: TMPDIR=<persistent tmp> node scripts/t002-poc-audit.mjs
 * Exit code: vitest's exit code (0 = 16/16 fixtures + adapters green).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(label, cmd, args) {
  console.log(`\n== ${label}: ${cmd} ${args.join(" ")} ==`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`FAILED (${label}): exit ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

run("build", "npm", ["run", "build"]);
run(
  "T002 vitest",
  "npx",
  ["vitest", "run", "tests/fixtures/s0/python/"],
);

console.log("\n== T002 PoC audit complete ==");
console.log("Evidence: 03_evidence/T002/POC_RUN.json, 03_evidence/T002/POC_RUN.log");
