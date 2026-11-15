#!/usr/bin/env node
// FIX T013 R4: direct check of the gate mirror auditFromGT.
// scripts/s0-gate.mjs exports nothing, so this loads the REAL function
// source out of the file (from "function normalizeDeclaredPath" through
// the end of auditFromGT, plus the FAIL_FINDING_IDS set) and executes
// it -- no copy, no retyping. Cases:
// (a) stale + hallucinated edge -> INCOMPLETE, 0 findings (R3);
// (b) stale + DYNAMIC_IMPORT_UNKNOWN in GT -> INCOMPLETE, 0 findings (R3);
// (c) MATCH + hallucinated edge -> FAIL with both blame findings (R3 sanity);
// (d) MATCH clean -> PASS (R3 sanity);
// (e) ghost entrypoint, production GT (entrypoints ["main.py"]) +
//     literals ["main.py", "ghost.py"], map claims both -> INCOMPLETE,
//     0 findings, unresolvedEntrypoints ["ghost.py"] (R4-P1-01; was
//     FAIL / WRONG_ENTRYPOINT before this fix);
// (f) ghost in map only: literals ["main.py"], map claims ghost.py ->
//     FAIL / WRONG_ENTRYPOINT ghost.py (control: blame still works);
// (g) ghost in neither: literals ["main.py"], map claims main.py only
//     -> PASS (control);
// (h) Go ghost: GT entrypoints ["cmd/server"], literals
//     ["cmd/server/main.go", "cmd/ghost/main.go"], map claims both
//     literal spellings -> INCOMPLETE, 0 findings,
//     unresolvedEntrypoints ["cmd/ghost/main.go"];
// (i) Go literal (resolvable): GT ["cmd/server"], literals
//     ["cmd/server/main.go"], map claims the literal spelling ->
//     PASS (R2-P2-03 residual (a) entrypoint half: the mirror now
//     accepts the literal toml spelling, like production Rule 4);
// (j) NOT_CHECKED + hallucinated edge -> FAIL (R3: no short-circuit).
// (k) stale + ghost: literals ["main.py", "ghost.py"], stale snapshot
//     -> INCOMPLETE, 0 findings, unresolvedEntrypoints ["ghost.py"].
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../../02_source/scripts/s0-gate.mjs", import.meta.url), "utf8");
const failSet = src.match(/const FAIL_FINDING_IDS = new Set\([\s\S]*?\]\);/)[0];
const start = src.indexOf("// FIX T013 R4 (R4-P1-01): resolve declared entrypoints");
const end = src.indexOf("\nfunction findingsKey", start + 1);
const fnSrc = src.slice(start, end);
const auditFromGT = new Function(
  `${failSet}\n${fnSrc}\nreturn auditFromGT;`)();

const gt = (over = {}) => ({
  modules: [{ relativePath: "main.py", language: "python", parseStatus: "OK" },
            { relativePath: "billing/api.py", language: "python", parseStatus: "OK" },
            { relativePath: "billing/auth.py", language: "python", parseStatus: "OK" }],
  edges: [{ from: "main.py", to: "billing/api.py" },
          { from: "main.py", to: "billing/auth.py" },
          { from: "billing/api.py", to: "billing/auth.py" }],
  reachableFromEntrypoints: ["main.py", "billing/api.py", "billing/auth.py"],
  entrypoints: ["main.py"],
  repoSnapshotSha256: "aa".repeat(32),
  dynamicUnknown: [],
  unknownImports: [],
  ...over,
});
const claimed = (over = {}) => ({
  completeness: "FULL_GRAPH",
  modules: [{ path: "main.py" }, { path: "billing/api.py" }, { path: "billing/auth.py" }],
  edges: [{ from: "main.py", to: "billing/api.py" },
          { from: "main.py", to: "billing/auth.py" },
          { from: "billing/api.py", to: "billing/auth.py" }],
  entrypoints: ["main.py"],
  repoSnapshotSha256: "aa".repeat(32),
  ...over,
});
const goGt = (over = {}) => ({
  modules: [{ relativePath: "cmd/server", language: "go", parseStatus: "OK" },
            { relativePath: "internal/app", language: "go", parseStatus: "OK" },
            { relativePath: "internal/store", language: "go", parseStatus: "OK" }],
  edges: [{ from: "cmd/server", to: "internal/app" },
          { from: "internal/app", to: "internal/store" }],
  reachableFromEntrypoints: ["cmd/server", "internal/app", "internal/store"],
  entrypoints: ["cmd/server"],
  repoSnapshotSha256: "bb".repeat(32),
  dynamicUnknown: [],
  unknownImports: [],
  ...over,
});
const goClaimed = (over = {}) => ({
  completeness: "FULL_GRAPH",
  modules: [{ path: "cmd/server" }, { path: "internal/app" }, { path: "internal/store" }],
  edges: [{ from: "cmd/server", to: "internal/app" },
          { from: "internal/app", to: "internal/store" }],
  entrypoints: ["cmd/server"],
  repoSnapshotSha256: "bb".repeat(32),
  ...over,
});

let fail = 0;
function check(name, got, wantStatus, wantFindings, wantUnresolved) {
  const ok = got.status === wantStatus &&
    JSON.stringify(got.findings) === JSON.stringify(wantFindings) &&
    JSON.stringify(got.unresolvedEntrypoints ?? null) ===
      JSON.stringify(wantUnresolved ?? null);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: status=${got.status} ` +
    `snapshotStatus=${got.snapshotStatus} findings=${JSON.stringify(got.findings)} ` +
    `unresolvedEntrypoints=${JSON.stringify(got.unresolvedEntrypoints ?? null)}`);
  if (!ok) fail++;
}

check("a stale+halluc",
  auditFromGT(gt(), claimed({ repoSnapshotSha256: "00".repeat(32),
    modules: [{ path: "main.py" }, { path: "billing/api.py" },
              { path: "billing/auth.py" }, { path: "ghost.py" }],
    edges: [{ from: "main.py", to: "billing/api.py" },
            { from: "main.py", to: "ghost.py" }] }),
    ["main.py"]),
  "INCOMPLETE", [], null);
check("b stale+dynamic",
  auditFromGT(gt({ dynamicUnknown: [{ path: "main.py" }] }),
    claimed({ repoSnapshotSha256: "00".repeat(32) }), ["main.py"]),
  "INCOMPLETE", [], null);
check("c match+halluc",
  auditFromGT(gt(), claimed({
    modules: [{ path: "main.py" }, { path: "billing/api.py" },
              { path: "billing/auth.py" }, { path: "ghost.py" }],
    edges: [{ from: "main.py", to: "billing/api.py" },
            { from: "main.py", to: "billing/auth.py" },
            { from: "billing/api.py", to: "billing/auth.py" },
            { from: "main.py", to: "ghost.py" }] }),
    ["main.py"]),
  "FAIL", [
    { id: "HALLUCINATED_EDGE", from: "main.py", to: "ghost.py" },
    { id: "HALLUCINATED_MODULE", from: "ghost.py" },
  ], null);
check("d match clean", auditFromGT(gt(), claimed(), ["main.py"]),
  "PASS", [], null);
check("e ghost-declared",
  auditFromGT(gt(), claimed({ entrypoints: ["main.py", "ghost.py"] }),
    ["main.py", "ghost.py"]),
  "INCOMPLETE", [], ["ghost.py"]);
check("f ghost-in-map-only",
  auditFromGT(gt(), claimed({ entrypoints: ["main.py", "ghost.py"] }),
    ["main.py"]),
  "FAIL", [{ id: "WRONG_ENTRYPOINT", from: "ghost.py" }], null);
check("g ghost-in-neither",
  auditFromGT(gt(), claimed(), ["main.py"]),
  "PASS", [], null);
check("h go-ghost-declared",
  auditFromGT(goGt(), goClaimed({
    entrypoints: ["cmd/server/main.go", "cmd/ghost/main.go"] }),
    ["cmd/server/main.go", "cmd/ghost/main.go"]),
  "INCOMPLETE", [], ["cmd/ghost/main.go"]);
check("i go-literal-resolvable",
  auditFromGT(goGt(), goClaimed({ entrypoints: ["cmd/server/main.go"] }),
    ["cmd/server/main.go"]),
  "PASS", [], null);
check("j not-checked+halluc",
  auditFromGT(gt({ repoSnapshotSha256: null }), claimed({
    modules: [{ path: "main.py" }, { path: "billing/api.py" },
              { path: "billing/auth.py" }, { path: "ghost.py" }],
    edges: [{ from: "main.py", to: "billing/api.py" },
            { from: "main.py", to: "billing/auth.py" },
            { from: "billing/api.py", to: "billing/auth.py" },
            { from: "main.py", to: "ghost.py" }] }),
    ["main.py"]),
  "FAIL", [
    { id: "HALLUCINATED_EDGE", from: "main.py", to: "ghost.py" },
    { id: "HALLUCINATED_MODULE", from: "ghost.py" },
  ], null);
check("k stale+ghost",
  auditFromGT(gt(), claimed({ repoSnapshotSha256: "00".repeat(32),
    entrypoints: ["main.py", "ghost.py"] }), ["main.py", "ghost.py"]),
  "INCOMPLETE", [], ["ghost.py"]);
process.exit(fail ? 1 : 0);
