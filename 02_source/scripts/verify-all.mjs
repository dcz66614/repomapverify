#!/usr/bin/env node
/**
 * P024 FIX T013 (P2-11) -- full verification.
 *
 *   npm run verify:all
 *
 * The frozen package.json script `verify:all` had no file behind it.
 * This script runs the three checks that together mean "the tree is
 * good", in order, stopping at the first failure:
 *
 *   1. `npm run build` (clean TypeScript build)
 *   2. `npx vitest run` (full test suite)
 *   3. `node scripts/s0-gate.mjs --replays 100` (S0 gate: 48/48
 *      parity, 24/24 planted, 0/24 false alarms, 100 replays 1 hash)
 *
 * Each step streams its own output; this script only adds the
 * step banners and the final verdict. Exits 0 only when all three
 * steps pass, otherwise exits with the failing step's code.
 *
 * Note: like any vitest / S0-gate run, steps 2-3 rewrite timestamps
 * inside committed evidence files (03_evidence/S0/S0_GATE.json,
 * T011/MUTATION_RESULTS.json, T012/PERF_RESULTS.json); restore those
 * with `git checkout -- <path>` afterwards if the tree must stay
 * clean (see P2-13).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(SCRIPT_DIR, "..");
const REPO_ROOT = join(SRC_DIR, "..");
const TMPDIR = process.env.TMPDIR || join(REPO_ROOT, ".tmp");

const STEPS = [
  { name: "build", cmd: "npm", args: ["run", "build"] },
  { name: "vitest", cmd: "npx", args: ["vitest", "run"] },
  { name: "s0:gate", cmd: "node", args: [join(SCRIPT_DIR, "s0-gate.mjs"), "--replays", "100"] },
];

console.log("== verify:all ==");
for (const step of STEPS) {
  console.log(`-- step: ${step.name} ($ ${step.cmd} ${step.args.join(" ")}) --`);
  const r = spawnSync(step.cmd, step.args, {
    cwd: SRC_DIR,
    stdio: "inherit",
    env: { ...process.env, TMPDIR },
  });
  const code = r.status ?? 3;
  if (code !== 0) {
    console.error(`VERIFY:ALL FAILED at step '${step.name}' (exit ${code})`);
    process.exit(code);
  }
  console.log(`-- step '${step.name}' passed --`);
}
console.log("VERIFY:ALL PASS: build + full suite + S0 gate all green.");
