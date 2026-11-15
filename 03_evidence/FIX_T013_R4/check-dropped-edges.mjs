// FIX T013 R4: unit-level droppedEdges probe (Rule 8 passthrough).
// A synthetic BuiltGraph with an edge to an unknown moduleId exercises
// production's hasDroppedUnknownEdge -> INCOMPLETE status-only path
// (src/graph/build.ts droppedEdges + src/comparator/compare.ts Rule 9)
// in isolation from the snapshot/extractor layers. The Oracle-side
// equivalent -- audit_claimed_map on a GT with no such edge, no unknown
// import and no other INCOMPLETE condition -- is run via the Oracle
// module to show the Oracle GT schema carries no droppedEdges
// counterpart (it returns PASS on the same clean map).
// Run: node check-dropped-edges.mjs   (from 02_source/)
import { buildGraph } from "../../02_source/dist/graph/build.js";
import { compareMapsDetailed } from "../../02_source/dist/comparator/compare.js";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const mid = (lang, p) => sha(`${lang}\0${p}`);
const csha = (s) => sha(s);

const mainId = mid("typescript", "src/main.ts");
const utilId = mid("typescript", "src/util.ts");
const secretId = mid("typescript", "src/secret.ts"); // never registered

const built = buildGraph({
  modules: [
    { module: { moduleId: mainId, language: "typescript", nodeKind: "module",
        relativePath: "src/main.ts", contentSha256: csha("main"),
        isGenerated: false, isEntrypoint: true, parseStatus: "OK" } },
    { module: { moduleId: utilId, language: "typescript", nodeKind: "module",
        relativePath: "src/util.ts", contentSha256: csha("util"),
        isGenerated: false, isEntrypoint: false, parseStatus: "OK" } },
  ],
  edges: [
    { fromModuleId: mainId, toModuleId: utilId },
    { fromModuleId: utilId, toModuleId: secretId }, // -> unregistered
  ],
  entrypointPaths: ["src/main.ts"],
  repoSnapshotSha256: "aa".repeat(32),
});
console.log("droppedEdges:", JSON.stringify(built.droppedEdges));
console.log("unresolvedEntrypoints:", JSON.stringify(built.unresolvedEntrypoints));

const claimed = {
  schema: "repomapverify.claimed-map/v1",
  mapId: "unit-dropped", repo: "unit", agent: "unit",
  completeness: "FULL_GRAPH", repoSnapshotSha256: "aa".repeat(32),
  modules: [
    { id: "m0", path: "src/main.ts", kind: "module" },
    { id: "m1", path: "src/util.ts", kind: "module" },
  ],
  entrypoints: ["src/main.ts"],
  edges: [{ from: "src/main.ts", to: "src/util.ts" }],
};
const { report } = compareMapsDetailed(built, claimed, {});
console.log("production audit:", report.status,
  "snapshotStatus:", report.snapshotStatus,
  "findings:", JSON.stringify(report.findings));
const prodOk = built.droppedEdges.length === 1 &&
  built.droppedEdges[0].reason === "UNKNOWN_ENDPOINT" &&
  report.status === "INCOMPLETE" && report.findings.length === 0;
console.log(prodOk ? "PASS production: dropped UNKNOWN_ENDPOINT -> INCOMPLETE, 0 findings"
  : "FAIL production expectation");
process.exit(prodOk ? 0 : 1);
