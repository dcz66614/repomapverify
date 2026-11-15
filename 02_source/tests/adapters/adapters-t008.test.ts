/**
 * T008 — input-adapter completion tests (PROJECT_BOOK §6.5; PLAN §4.5).
 *
 * The T002 PoC tests (tests/fixtures/s0/python/poc-audit.test.ts)
 * still cover the happy-path mappings; these tests cover what T008
 * added: strict validation of every consumed upstream field (a
 * malformed field is a REJECTION naming the field, never a silent
 * drop or guess), post-mapping validation through the SAME
 * claimed-map/v1 validator as native input, `generated` passthrough,
 * `mapInput("claimed-map-v1")` dispatch, and redacted adapter notes
 * (an absolute path / username in upstream input never leaks into a
 * note or an error message).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { mapGraphify } from "../../src/adapters/graphify.js";
import { mapUnderstandAnything } from "../../src/adapters/understand-anything.js";
import { mapAiderRepoMap } from "../../src/adapters/aider.js";
import { mapInput } from "../../src/adapters/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ADAPTER_DIR = join(HERE, "..", "fixtures", "s0", "python", "adapters");

const SNAP = "0".repeat(64);

function graphifyBase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    completeness: "FULL_GRAPH",
    repo_snapshot_sha256: SNAP,
    nodes: [
      { id: "n1", path: "billing/api.py", kind: "module" },
      { id: "n2", path: "billing/auth.py", kind: "module" },
    ],
    edges: [{ from: "n1", to: "n2", type: "EXTRACTED" }],
    ...overrides,
  };
}

function uaBase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    completeness: "FULL_GRAPH",
    repo_snapshot_sha256: SNAP,
    nodes: [
      { id: "n1", path: "billing/api.py" },
      { id: "n2", path: "billing/auth.py" },
    ],
    edges: [{ from: "n1", to: "n2", origin: "static" }],
    ...overrides,
  };
}

describe("mapInput dispatch (claimed-map-v1)", () => {
  test("native claimed-map/v1 is validated, not rejected as 'needs no mapping'", () => {
    const valid = {
      schema: "repomapverify.claimed-map/v1",
      mapId: "agent-run-1",
      repo: "billing-service",
      completeness: "FULL_GRAPH",
      repoSnapshotSha256: SNAP,
      modules: [{ id: "m1", path: "a.py", kind: "module" }],
      entrypoints: [],
      edges: [],
    };
    const r = mapInput("claimed-map-v1", valid);
    expect(r.ok).toBe(true);
    expect(r.map?.mapId).toBe("agent-run-1");
    const bad = mapInput("claimed-map-v1", { ...valid, completeness: "COMPLETE" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/completeness/);
  });
});

describe("graphify adapter (T008 strictness)", () => {
  test("PoC sample still maps (regression guard)", () => {
    const input = JSON.parse(
      readFileSync(join(ADAPTER_DIR, "graphify-sample.json"), "utf8"),
    ) as unknown;
    const r = mapGraphify(input);
    expect(r.ok).toBe(true);
    expect(r.map?.edges).toEqual([
      { from: "billing/api.py", to: "billing/auth.py" },
      { from: "billing/auth.py", to: "billing/refunds.py" },
    ]);
    expect(r.droppedEdges).toBe(1);
  });

  test("node without a string path is rejected naming nodes[i].path", () => {
    const r = mapGraphify(
      graphifyBase({ nodes: [{ id: "n1" }, { id: "n2", path: "b.py" }] }),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nodes\[0\]\.path/);
  });

  test("node kind outside module|package is rejected naming nodes[i].kind", () => {
    const r = mapGraphify(
      graphifyBase({ nodes: [{ id: "n1", path: "a.py", kind: "file" }] }),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nodes\[0\]\.kind/);
  });

  test("non-boolean generated is rejected naming nodes[i].generated; boolean passes through", () => {
    const bad = mapGraphify(
      graphifyBase({ nodes: [{ id: "n1", path: "a.py", generated: "yes" }] }),
    );
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/nodes\[0\]\.generated/);
    const good = mapGraphify(
      graphifyBase({
        nodes: [
          { id: "n1", path: "gen/pb.py", generated: true },
          { id: "n2", path: "hand.py", generated: false },
        ],
        edges: [{ from: "n1", to: "n2", type: "EXTRACTED" }],
      }),
    );
    expect(good.ok).toBe(true);
    expect(good.map?.modules.find((m) => m.path === "gen/pb.py")?.generated).toBe(true);
    expect(good.map?.modules.find((m) => m.path === "hand.py")?.generated).toBe(false);
  });

  test("duplicate module path / node id are rejected naming the field", () => {
    const dupPath = mapGraphify(
      graphifyBase({
        nodes: [
          { id: "n1", path: "a.py" },
          { id: "n2", path: "a.py" },
        ],
      }),
    );
    expect(dupPath.ok).toBe(false);
    expect(dupPath.error).toMatch(/nodes\[1\]\.path/);
    const dupId = mapGraphify(
      graphifyBase({
        nodes: [
          { id: "n1", path: "a.py" },
          { id: "n1", path: "b.py" },
        ],
      }),
    );
    expect(dupId.ok).toBe(false);
    expect(dupId.error).toMatch(/nodes\[1\]\.id/);
  });

  test("EXTRACTED edge with a missing endpoint is rejected naming edges[i].from", () => {
    const r = mapGraphify(graphifyBase({ edges: [{ to: "n2", type: "EXTRACTED" }] }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/edges\[0\]\.from/);
  });

  test("conflicting from/source spellings are rejected naming the field", () => {
    const r = mapGraphify(
      graphifyBase({
        edges: [{ from: "n1", source: "n2", to: "n2", type: "EXTRACTED" }],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/edges\[0\]\.from/);
  });

  test("absolute edge endpoint is rejected, never normalized into the repo", () => {
    const r = mapGraphify(
      graphifyBase({
        edges: [{ from: "/home/alice/a.py", to: "n2", type: "EXTRACTED" }],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/edges\[0\]\.from/);
    expect(r.error).not.toContain("/home/alice");
    expect(r.error).not.toContain("alice");
  });

  test("non-string entrypoint / repo / agent are rejected naming the field", () => {
    expect(mapGraphify(graphifyBase({ entrypoints: [42] })).error).toMatch(
      /entrypoints\[0\]/,
    );
    expect(mapGraphify(graphifyBase({ repo: 7 })).error).toMatch(/repo/);
    expect(mapGraphify(graphifyBase({ agent: {} })).error).toMatch(/agent/);
  });

  test("post-mapping validation rejects a malformed snapshot (same validator as native input)", () => {
    const r = mapGraphify(graphifyBase({ repo_snapshot_sha256: "not-a-sha256" }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/repoSnapshotSha256/);
  });

  test("dropped INFERRED-edge notes never leak an absolute path or username", () => {
    const r = mapGraphify(
      graphifyBase({
        edges: [
          { from: "/home/alice/billing/api.py", to: "/home/alice/billing/auth.py", type: "INFERRED" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.droppedEdges).toBe(1);
    expect(JSON.stringify(r.notes)).not.toContain("/home/alice");
    expect(JSON.stringify(r.notes)).not.toContain("alice");
  });

  test("conflicting mapId / map_id spellings are rejected", () => {
    const r = mapGraphify(graphifyBase({ mapId: "one", map_id: "two" }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/mapId/);
  });
});

describe("understand-anything adapter (T008 strictness)", () => {
  test("PoC sample still maps (regression guard)", () => {
    const input = JSON.parse(
      readFileSync(join(ADAPTER_DIR, "understand-anything-sample.ua.json"), "utf8"),
    ) as unknown;
    const r = mapUnderstandAnything(input);
    expect(r.ok).toBe(true);
    expect(r.map?.edges).toEqual([{ from: "billing/api.py", to: "billing/auth.py" }]);
    expect(r.droppedEdges).toBe(2);
  });

  test("node without a string path is rejected naming nodes[i].path", () => {
    expect(
      mapUnderstandAnything(uaBase({ nodes: [{ id: "n1", path: 5 }] })).error,
    ).toMatch(/nodes\[0\]\.path/);
  });

  test("static edge with a missing endpoint is rejected naming edges[i].to", () => {
    const r = mapUnderstandAnything(uaBase({ edges: [{ from: "n1", origin: "static" }] }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/edges\[0\]\.to/);
  });

  test("llm / missing origins are still dropped and counted, never passed through", () => {
    const r = mapUnderstandAnything(
      uaBase({
        edges: [
          { from: "n1", to: "n2", origin: "static" },
          { from: "n1", to: "n2", origin: "llm" },
          { from: "n1", to: "n2" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.map?.edges).toHaveLength(1);
    expect(r.droppedEdges).toBe(2);
  });

  test("generated passthrough works", () => {
    const r = mapUnderstandAnything(
      uaBase({
        nodes: [{ id: "n1", path: "gen.py", generated: true }],
        edges: [],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.map?.modules[0]?.generated).toBe(true);
  });

  test("post-mapping validation rejects a malformed snapshot", () => {
    const r = mapUnderstandAnything(uaBase({ repo_snapshot_sha256: "zz" }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/repoSnapshotSha256/);
  });
});

describe("aider adapter (T008 strictness)", () => {
  test("text map still forces PARTIAL_SUBGRAPH (regression guard)", () => {
    const text = readFileSync(join(ADAPTER_DIR, "aider-sample.txt"), "utf8");
    const r = mapAiderRepoMap(text, { repoSnapshotSha256: SNAP });
    expect(r.ok).toBe(true);
    expect(r.map?.completeness).toBe("PARTIAL_SUBGRAPH");
    expect(r.map?.edges).toEqual([]);
  });

  test("JSON files[i] non-string is rejected naming files[i]", () => {
    const r = mapAiderRepoMap({ files: ["a.py", 42] }, { repoSnapshotSha256: SNAP });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/files\[1\]/);
  });

  test("JSON absolute path is rejected naming files[i], never echoed raw", () => {
    const r = mapAiderRepoMap(
      { files: ["/home/alice/billing/api.py"] },
      { repoSnapshotSha256: SNAP },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/files\[0\]/);
    expect(r.error).not.toContain("/home/alice");
    expect(r.error).not.toContain("alice");
  });

  test("JSON unknown top-level field is rejected naming the field", () => {
    const r = mapAiderRepoMap(
      { files: ["a.py"], surprise: true },
      { repoSnapshotSha256: SNAP },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/surprise/);
  });

  test("JSON claiming FULL_GRAPH is still forced PARTIAL_SUBGRAPH (regression guard)", () => {
    const r = mapAiderRepoMap(
      { files: ["billing/api.py"], completeness: "FULL_GRAPH" },
      { repoSnapshotSha256: SNAP },
    );
    expect(r.ok).toBe(true);
    expect(r.map?.completeness).toBe("PARTIAL_SUBGRAPH");
  });

  test("text form: unsafe header is dropped with a redacted note, never leaked", () => {
    const r = mapAiderRepoMap(
      "/home/alice/billing/api.py:\n  def f(...)\nbilling/auth.py:\n  def g(...)\n",
      { repoSnapshotSha256: SNAP },
    );
    expect(r.ok).toBe(true);
    expect(r.map?.modules.map((m) => m.path)).toEqual(["billing/auth.py"]);
    expect(JSON.stringify(r.notes)).not.toContain("/home/alice");
    expect(JSON.stringify(r.notes)).not.toContain("alice");
  });

  test("missing snapshot is still an error, never guessed", () => {
    expect(mapAiderRepoMap("a.py:\n", {}).ok).toBe(false);
  });
});
