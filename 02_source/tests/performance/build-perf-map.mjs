/**
 * T012 performance-map builder (PROJECT_BOOK §6.1, PLAN T012).
 *
 * Builds a claimed-map/v1 JSON from a ground-truth JSON document
 * (the output of `node dist/cli.js ground-truth --repo <repo>`):
 * every ground-truth module and edge is claimed, entrypoints are
 * taken from the ground truth, and the snapshot hash is bound from
 * the ground truth. The resulting map is therefore a PERFECT map of
 * the repo, so the audit is expected to PASS with 0 findings — the
 * point of the performance run is timing, not detection.
 *
 * This is a test-only construction (the map is derived from the
 * tool's own ground truth, never shipped as a real agent map).
 *
 * Usage:
 *   node tests/performance/build-perf-map.mjs <ground-truth.json> <out-map.json>
 * Prints the map summary as JSON on stdout.
 */
import { readFileSync, writeFileSync } from "node:fs";

export function buildPerfMap(groundTruth) {
  return {
    schema: "repomapverify.claimed-map/v1",
    mapId: "perf-1000-agent-run-001",
    repo: "perf-repo-1000",
    agent: "synthetic-perf-agent-0.1",
    completeness: "FULL_GRAPH",
    repoSnapshotSha256: groundTruth.repoSnapshotSha256,
    modules: groundTruth.modules.map((m, i) => ({
      id: `m${i}`,
      path: m.relativePath,
      kind: m.nodeKind,
    })),
    entrypoints: groundTruth.entrypoints,
    edges: groundTruth.edges.map((e) => ({ from: e.from, to: e.to })),
  };
}

import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [gtPath, outPath] = process.argv.slice(2);
  if (!gtPath || !outPath) {
    console.error(
      "usage: node build-perf-map.mjs <ground-truth.json> <out-map.json>",
    );
    process.exit(3);
  }
  const gt = JSON.parse(readFileSync(gtPath, "utf8"));
  const map = buildPerfMap(gt);
  writeFileSync(outPath, JSON.stringify(map, null, 2) + "\n");
  console.log(
    JSON.stringify({
      outPath,
      modules: map.modules.length,
      edges: map.edges.length,
      entrypoints: map.entrypoints,
    }),
  );
}
