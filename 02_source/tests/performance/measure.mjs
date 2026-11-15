/**
 * T012 measurement helper.
 *
 * Runs a command and records wall time + peak RSS. This VM has no
 * /usr/bin/time, so peak RSS is measured by polling /proc/<pid>/status
 * (VmRSS) every 25 ms while the child runs and taking the max; VmHWM
 * (the kernel's own high-water mark) is captured on the last poll
 * before exit when available. The CLI under test is a single Node
 * process (tree-sitter WASM runs in-process), so sampling the direct
 * child covers the whole audit.
 *
 * Usage (library):
 *   import { measure } from "./measure.mjs";
 *   const r = await measure("node", ["dist/cli.js", "audit", ...], { cwd });
 *   // r = { exitCode, wallMs, wallSec, peakRssKb, peakRssMb, peakRssSource,
 *   //       stdout, stderr }
 *
 * Usage (CLI):
 *   node measure.mjs <cmd...> [--json-out <path>]
 * Prints one JSON line with the same fields (stdout/stderr captured
 * separately inside the JSON, not echoed).
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

export function readVmRssKb(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/status`, "utf8");
    const rss = text.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    const hwm = text.match(/^VmHWM:\s+(\d+)\s+kB$/m);
    return {
      rssKb: rss ? Number(rss[1]) : null,
      hwmKb: hwm ? Number(hwm[1]) : null,
    };
  } catch {
    return { rssKb: null, hwmKb: null };
  }
}

export function measure(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    let peakRssKb = 0;
    let peakSource = "VmRSS-poll-25ms";
    let lastHwmKb = null;
    const timer = setInterval(() => {
      const { rssKb, hwmKb } = readVmRssKb(child.pid);
      if (rssKb !== null && rssKb > peakRssKb) peakRssKb = rssKb;
      if (hwmKb !== null) {
        lastHwmKb = hwmKb;
        if (hwmKb > peakRssKb) {
          peakRssKb = hwmKb;
          peakSource = "VmHWM";
        }
      }
    }, 25);
    child.on("error", (err) => {
      clearInterval(timer);
      reject(err);
    });
    child.on("close", (exitCode) => {
      clearInterval(timer);
      // One final sample attempt (process may already be gone).
      const { rssKb, hwmKb } = readVmRssKb(child.pid);
      if (rssKb !== null && rssKb > peakRssKb) peakRssKb = rssKb;
      if (hwmKb !== null && hwmKb > peakRssKb) {
        peakRssKb = hwmKb;
        peakSource = "VmHWM";
      }
      const wallMs = performance.now() - start;
      resolve({
        cmd: [cmd, ...args].join(" "),
        exitCode,
        wallMs: Math.round(wallMs),
        wallSec: +(wallMs / 1000).toFixed(3),
        peakRssKb,
        peakRssMb: +(peakRssKb / 1024).toFixed(1),
        peakRssSource: lastHwmKb !== null ? peakSource : "VmRSS-poll-25ms",
        stdout,
        stderr,
      });
    });
  });
}

import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const jsonOutIdx = argv.indexOf("--json-out");
  let jsonOut = null;
  let cmdArgs = argv;
  if (jsonOutIdx !== -1) {
    jsonOut = argv[jsonOutIdx + 1];
    cmdArgs = [...argv.slice(0, jsonOutIdx), ...argv.slice(jsonOutIdx + 2)];
  }
  const [cmd, ...args] = cmdArgs;
  if (!cmd) {
    console.error("usage: node measure.mjs <cmd...> [--json-out <path>]");
    process.exit(3);
  }
  const result = await measure(cmd, args);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
  process.exit(result.exitCode ?? 1);
}
