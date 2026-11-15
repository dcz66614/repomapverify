#!/usr/bin/env node
// FIX T013 R3: direct check of the gate mirror auditFromGT.
// scripts/s0-gate.mjs exports nothing, so this loads the REAL function
// source out of the file (from "function auditFromGT" to the next
// top-level "function ") and executes it -- no copy, no retyping.
// Cases: (a) stale + hallucinated edge -> INCOMPLETE, 0 findings;
// (b) stale + DYNAMIC_IMPORT_UNKNOWN in GT -> INCOMPLETE, 0 findings;
// (c) MATCH + hallucinated edge -> FAIL (sanity: blame still works
// when the snapshot matches); (d) MATCH clean -> PASS.
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../../02_source/scripts/s0-gate.mjs", import.meta.url), "utf8");
const failSet = src.match(/const FAIL_FINDING_IDS = new Set\(\[[\s\S]*?\]\);/)[0];
const start = src.indexOf("function auditFromGT");
const end = src.indexOf("\nfunction ", start + 1);
const fnSrc = src.slice(start, end);
const auditFromGT = new Function(
  `${failSet}\n${fnSrc}\nreturn auditFromGT;`)();

const gt = (over = {}) => ({
  modules: [{ relativePath: "a.py", parseStatus: "OK" },
            { relativePath: "b.py", parseStatus: "OK" }],
  edges: [{ from: "a.py", to: "b.py" }],
  reachableFromEntrypoints: ["a.py", "b.py"],
  entrypoints: [],
  repoSnapshotSha256: "aa".repeat(32),
  dynamicUnknown: [],
  unknownImports: [],
  ...over,
});
const claimed = (over = {}) => ({
  completeness: "FULL_GRAPH",
  modules: [{ path: "a.py" }, { path: "b.py" }],
  edges: [{ from: "a.py", to: "b.py" }],
  entrypoints: [],
  repoSnapshotSha256: "aa".repeat(32),
  ...over,
});

let fail = 0;
function check(name, got, wantStatus, wantFindings) {
  const ok = got.status === wantStatus &&
    JSON.stringify(got.findings) === JSON.stringify(wantFindings);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: status=${got.status} ` +
    `snapshotStatus=${got.snapshotStatus} findings=${JSON.stringify(got.findings)} ` +
    `unknownImportsPresent=${got.unknownImportsPresent}`);
  if (!ok) fail++;
}

check("a stale+halluc",
  auditFromGT(gt(), claimed({ repoSnapshotSha256: "00".repeat(32),
    modules: [{ path: "a.py" }, { path: "b.py" }, { path: "c.py" }],
    edges: [{ from: "a.py", to: "b.py" }, { from: "a.py", to: "c.py" }] })),
  "INCOMPLETE", []);
check("b stale+dynamic",
  auditFromGT(gt({ dynamicUnknown: [{ path: "a.py" }] }),
    claimed({ repoSnapshotSha256: "00".repeat(32) })),
  "INCOMPLETE", []);
check("c match+halluc",
  auditFromGT(gt(), claimed({
    modules: [{ path: "a.py" }, { path: "b.py" }, { path: "c.py" }],
    edges: [{ from: "a.py", to: "b.py" }, { from: "a.py", to: "c.py" }] })),
  "FAIL", [
    { id: "HALLUCINATED_EDGE", from: "a.py", to: "c.py" },
    { id: "HALLUCINATED_MODULE", from: "c.py" },
  ]);
check("d match clean", auditFromGT(gt(), claimed()), "PASS", []);
process.exit(fail ? 1 : 0);
