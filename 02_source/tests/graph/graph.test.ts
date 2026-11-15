/**
 * T005 graph tests (PROJECT_BOOK §4.1–§4.2, §6.2; PLAN T005).
 *
 * 1. Synthetic-graph unit tests: entrypoints come ONLY from the
 *    declaration (never from graph roots), BFS reachability (including
 *    conditional / type-only edges and the Python __init__ closure),
 *    Go package nodes incl. the root package, edge dedup / dropping,
 *    unresolved entrypoints, duplicate-content signal.
 * 2. S0-fixture tests: for all 48 hand-written goldens,
 *    buildGroundTruthGraphFromRepo must reproduce the golden modules
 *    (path / language / nodeKind / isEntrypoint), the golden edges,
 *    and the golden reachable/isolated sets. Python goldens carry
 *    reachable/isolated directly; TS/Go goldens do not, so the
 *    expected sets are computed here by an independent BFS over the
 *    GOLDEN edges from the GOLDEN toml entrypoints (never from
 *    production output). The Python snapshot hash is also checked
 *    against the Python extractor's own snapshot hash.
 * 3. Symlink end-to-end test on a real temp repo (Python).
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { computeContentSha256, computeModuleId, normalizeRelativePath } from "../../src/contracts/module.js";
import { parseEntrypointsTomlOptional } from "../../src/contracts/entrypoints.js";
import { buildGraph, reachabilityPaths } from "../../src/graph/build.js";
import { buildGroundTruthGraphFromRepo } from "../../src/graph/fromRepo.js";
import { extractPythonRepo } from "../../src/extractors/python/index.js";
import type { BuildGraphInput, GraphModuleInput } from "../../src/graph/types.js";
import type { Language, ModuleV1 } from "../../src/contracts/module.js";

const FIXTURES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "s0",
);

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function mod(
  language: Language,
  relativePath: string,
  content = `${relativePath}\n`,
  extra: Partial<ModuleV1> = {},
): ModuleV1 {
  // Like the extractors: normalize (NFC, slashes) BEFORE hashing.
  const normalized = normalizeRelativePath(relativePath === "." ? "" : relativePath);
  return {
    moduleId: computeModuleId(language, normalized),
    language,
    nodeKind: language === "go" ? "package" : "module",
    relativePath,
    contentSha256: computeContentSha256(content),
    isGenerated: false,
    isEntrypoint: false,
    parseStatus: "OK",
    evidenceLevel: "STATIC_RULE",
    ...extra,
  };
}

function input(
  modules: ModuleV1[],
  edges: BuildGraphInput["edges"],
  entrypointPaths: string[],
): BuildGraphInput {
  return {
    modules: modules.map((m) => ({ module: m }) as GraphModuleInput),
    edges,
    entrypointPaths,
  };
}

describe("buildGraph: entrypoints only from the declaration", () => {
  test("graph roots are candidates, never entrypoints; reachability follows the declaration", () => {
    const main = mod("python", "main.py");
    const a = mod("python", "a.py");
    const b = mod("python", "b.py");
    const root = mod("python", "root.py"); // in-degree 0, NOT declared
    const c = mod("python", "c.py"); // isolated
    const built = buildGraph(
      input(
        [main, a, b, root, c],
        [
          { fromModuleId: main.moduleId, toModuleId: a.moduleId },
          { fromModuleId: a.moduleId, toModuleId: b.moduleId },
        ],
        ["main.py"],
      ),
    );
    expect([...built.graph.modules.values()].find((m) => m.relativePath === "root.py")?.isEntrypoint).toBe(false);
    expect([...built.graph.modules.values()].find((m) => m.relativePath === "main.py")?.isEntrypoint).toBe(true);
    expect(built.entrypointCandidates).toEqual(["c.py", "main.py", "root.py"]);
    expect(reachabilityPaths(built)).toEqual({
      reachable: ["a.py", "b.py", "main.py"],
      isolated: ["c.py", "root.py"],
    });
  });

  test("no declaration => no entrypoints, everything isolated, no WRONG_ENTRYPOINT signal", () => {
    const main = mod("python", "main.py");
    const a = mod("python", "a.py");
    const built = buildGraph(
      input([main, a], [{ fromModuleId: main.moduleId, toModuleId: a.moduleId }], []),
    );
    expect(built.declaredEntrypoints).toEqual([]);
    expect(built.unresolvedEntrypoints).toEqual([]);
    expect(reachabilityPaths(built)).toEqual({ reachable: [], isolated: ["a.py", "main.py"] });
    expect(built.entrypointCandidates).toEqual(["main.py"]);
  });

  test("declared entrypoint that resolves to no module is recorded, never guessed", () => {
    const main = mod("python", "main.py");
    const built = buildGraph(input([main], [], ["nope.py", "main.py"]));
    expect(built.unresolvedEntrypoints).toEqual(["nope.py"]);
    // Declared paths keep declaration order (only the unresolved list is sorted).
    expect(built.declaredEntrypointPaths).toEqual(["nope.py", "main.py"]);
    expect(reachabilityPaths(built).reachable).toEqual(["main.py"]);
  });

  test("multiple entrypoints all seed the BFS", () => {
    const cli = mod("python", "cli.py");
    const worker = mod("python", "worker.py");
    const shared = mod("python", "shared.py");
    const built = buildGraph(
      input(
        [cli, worker, shared],
        [
          { fromModuleId: cli.moduleId, toModuleId: shared.moduleId },
          { fromModuleId: worker.moduleId, toModuleId: shared.moduleId },
        ],
        ["cli.py", "worker.py"],
      ),
    );
    expect(reachabilityPaths(built).reachable).toEqual(["cli.py", "shared.py", "worker.py"]);
  });
});

describe("buildGraph: BFS over core edges", () => {
  test("conditional and type-only edges traverse; cycles terminate", () => {
    const main = mod("typescript", "src/main.ts");
    const types = mod("typescript", "src/types.ts");
    const opt = mod("typescript", "src/opt.ts");
    const loop = mod("typescript", "src/loop.ts");
    const built = buildGraph(
      input(
        [main, types, opt, loop],
        [
          { fromModuleId: main.moduleId, toModuleId: types.moduleId, typeOnly: true },
          { fromModuleId: main.moduleId, toModuleId: opt.moduleId, conditional: true },
          { fromModuleId: opt.moduleId, toModuleId: loop.moduleId },
          { fromModuleId: loop.moduleId, toModuleId: main.moduleId },
        ],
        ["src/main.ts"],
      ),
    );
    expect(reachabilityPaths(built)).toEqual({
      reachable: ["src/loop.ts", "src/main.ts", "src/opt.ts", "src/types.ts"],
      isolated: [],
    });
  });

  test("Python package-init closure: ancestor __init__.py reachable without an edge", () => {
    const main = mod("python", "main.py");
    const init = mod("python", "pkg/__init__.py");
    const sub = mod("python", "pkg/sub.py");
    const deepInit = mod("python", "pkg/deep/__init__.py");
    const deep = mod("python", "pkg/deep/leaf.py");
    const built = buildGraph(
      input(
        [main, init, sub, deepInit, deep],
        [
          { fromModuleId: main.moduleId, toModuleId: sub.moduleId },
          { fromModuleId: sub.moduleId, toModuleId: deep.moduleId },
        ],
        ["main.py"],
      ),
    );
    // __init__ files are reachable by the closure; no edge points at them.
    expect(reachabilityPaths(built).reachable).toEqual([
      "main.py",
      "pkg/__init__.py",
      "pkg/deep/__init__.py",
      "pkg/deep/leaf.py",
      "pkg/sub.py",
    ]);
    // The closure is Python-only: a TS index.ts is NOT pulled in.
    const tsMain = mod("typescript", "src/main.ts");
    const tsIndex = mod("typescript", "src/lib/index.ts");
    const tsLeaf = mod("typescript", "src/lib/leaf.ts");
    const tsBuilt = buildGraph(
      input(
        [tsMain, tsIndex, tsLeaf],
        [{ fromModuleId: tsMain.moduleId, toModuleId: tsLeaf.moduleId }],
        ["src/main.ts"],
      ),
    );
    expect(reachabilityPaths(tsBuilt).isolated).toEqual(["src/lib/index.ts"]);
  });
});

describe("buildGraph: edges and identity", () => {
  test("duplicate edges collapse to one (strongest flags win); unknown endpoints and self-edges are dropped, not silent", () => {
    const main = mod("python", "main.py");
    const a = mod("python", "a.py");
    const built = buildGraph(
      input(
        [main, a],
        [
          { fromModuleId: main.moduleId, toModuleId: a.moduleId, conditional: true, typeOnly: true },
          { fromModuleId: main.moduleId, toModuleId: a.moduleId, conditional: false, typeOnly: false },
          { fromModuleId: main.moduleId, toModuleId: "f".repeat(64) },
          { fromModuleId: main.moduleId, toModuleId: main.moduleId },
        ],
        ["main.py"],
      ),
    );
    expect(built.graph.edges.size).toBe(1);
    const edge = [...built.graph.edges.values()][0];
    expect(edge?.conditional).toBe(false);
    expect(edge?.typeOnly).toBe(false);
    expect(built.droppedEdges).toHaveLength(2);
    expect(new Set(built.droppedEdges.map((d) => d.reason))).toEqual(
      new Set(["UNKNOWN_ENDPOINT", "SELF_EDGE"]),
    );
  });

  test("Go nodes are packages; a root file entrypoint maps to the '.' package", () => {
    const root = mod("go", ".", "package main\n", { nodeKind: "package" });
    const app = mod("go", "internal/app", "package app\n", { nodeKind: "package" });
    expect(root.moduleId).toBe(computeModuleId("go", ""));
    const built = buildGraph(
      input(
        [root, app],
        [{ fromModuleId: root.moduleId, toModuleId: app.moduleId }],
        ["main.go"],
      ),
    );
    expect(built.graph.modules.get(root.moduleId)?.isEntrypoint).toBe(true);
    expect(built.graph.modules.get(root.moduleId)?.relativePath).toBe(".");
    expect(reachabilityPaths(built)).toEqual({
      reachable: [".", "internal/app"],
      isolated: [],
    });
    // A nested entrypoint file maps to its package directory.
    const built2 = buildGraph(
      input(
        [root, app],
        [{ fromModuleId: root.moduleId, toModuleId: app.moduleId }],
        ["internal/app/server.go"],
      ),
    );
    expect(built2.graph.modules.get(app.moduleId)?.isEntrypoint).toBe(true);
    expect(built2.graph.modules.get(root.moduleId)?.isEntrypoint).toBe(false);
  });

  test("duplicate content is reported as a signal, not merged", () => {
    const a = mod("python", "a/one.py", "same\n");
    const b = mod("python", "b/two.py", "same\n");
    const built = buildGraph(input([a, b], [], []));
    expect(built.graph.modules.size).toBe(2);
    expect(built.duplicateContent).toHaveLength(1);
    expect(built.duplicateContent[0]?.relativePaths).toEqual(["a/one.py", "b/two.py"]);
  });

  test("symlinked spellings merge in the graph; edges remap to the canonical module", () => {
    const main = mod("python", "main.py");
    const real = mod("python", "pkg/mod.py");
    const alias = mod("python", "linkmod.py");
    // Both spellings are the same physical file (same realPath).
    const built = buildGraph(
      {
        modules: [
          { module: main },
          { module: real, realPath: "/repo/pkg/mod.py" },
          { module: alias, realPath: "/repo/pkg/mod.py" },
        ],
        edges: [{ fromModuleId: main.moduleId, toModuleId: real.moduleId }],
        entrypointPaths: ["main.py"],
      },
    );
    expect(built.graph.modules.size).toBe(2);
    const merged = [...built.graph.modules.values()].find(
      (m) => m.relativePath === "linkmod.py" || m.relativePath === "pkg/mod.py",
    );
    expect(merged).toBeDefined();
    expect(built.aliases.get(merged?.moduleId ?? "")).toEqual(
      merged?.relativePath === "linkmod.py" ? ["pkg/mod.py"] : ["linkmod.py"],
    );
    expect(built.graph.edges.size).toBe(1);
    expect(reachabilityPaths(built).reachable).toContain(merged?.relativePath ?? "");
  });
});

/** Independent BFS over golden edges from golden toml entrypoints (test-side, not production). */
function expectedReachability(
  goldenModules: Array<{ relativePath: string }>,
  goldenEdges: Array<{ from: string; to: string }>,
  tomlPaths: string[],
  language: string,
): { reachable: string[]; isolated: string[] } {
  const byPath = new Set(goldenModules.map((m) => m.relativePath));
  let entrypoints: string[] = tomlPaths;
  if (language === "go") {
    entrypoints = tomlPaths.map((p) => {
      const parts = p.split("/");
      parts.pop();
      return parts.join("/") || ".";
    });
  }
  const out = new Map<string, string[]>();
  for (const e of goldenEdges) {
    const list = out.get(e.from) ?? [];
    list.push(e.to);
    out.set(e.from, list);
  }
  const reachable = new Set<string>();
  const stack = [...entrypoints];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (reachable.has(cur) || !byPath.has(cur)) continue;
    reachable.add(cur);
    for (const nxt of out.get(cur) ?? []) stack.push(nxt);
  }
  return {
    reachable: [...reachable].sort(),
    isolated: [...byPath].filter((p) => !reachable.has(p)).sort(),
  };
}

function listFixtures(langDir: string): string[] {
  return readdirSync(join(FIXTURES_ROOT, langDir))
    .filter((n) => /^(py|ts|go)-/.test(n))
    .sort();
}

describe("S0 fixtures: graph matches the hand-written goldens (48/48)", () => {
  test("python fixtures (16): modules, edges, reachable/isolated, snapshot", async () => {
    for (const name of listFixtures("python")) {
      const dir = join(FIXTURES_ROOT, "python", name);
      const golden = JSON.parse(readFileSync(join(dir, "golden.json"), "utf8"));
      const built = await buildGroundTruthGraphFromRepo(join(dir, "repo"));
      const gotModules = [...built.graph.modules.values()]
        .map((m) => ({
          relativePath: m.relativePath,
          language: m.language,
          nodeKind: m.nodeKind,
          isEntrypoint: m.isEntrypoint,
        }))
        .sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1));
      const wantModules = golden.modules
        .map((m: { relativePath: string; isEntrypoint: boolean; nodeKind: string }) => ({
          relativePath: m.relativePath,
          language: "python",
          nodeKind: m.nodeKind,
          isEntrypoint: m.isEntrypoint,
        }))
        .sort((a: { relativePath: string }, b: { relativePath: string }) =>
          a.relativePath < b.relativePath ? -1 : 1,
        );
      expect(gotModules, `${name} modules`).toEqual(wantModules);
      const gotEdges = [...built.graph.edges.values()]
        .map((e) => ({
          from: built.graph.modules.get(e.fromModuleId)?.relativePath,
          to: built.graph.modules.get(e.toModuleId)?.relativePath,
        }))
        .sort((a, b) =>
          (a.from ?? "") < (b.from ?? "") ? -1 : (a.from ?? "") > (b.from ?? "") ? 1 : (a.to ?? "") < (b.to ?? "") ? -1 : (a.to ?? "") > (b.to ?? "") ? 1 : 0,
        );
      const wantEdges = golden.edges
        .map((e: { from: string; to: string }) => ({ from: e.from, to: e.to }))
        .sort((a: { from: string; to: string }, b: { from: string; to: string }) =>
          a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0,
        );
      expect(gotEdges, `${name} edges`).toEqual(wantEdges);
      expect(reachabilityPaths(built), `${name} reachability`).toEqual({
        reachable: [...golden.reachableFromEntrypoints].sort(),
        isolated: [...golden.isolatedModules].sort(),
      });
      // Snapshot hash agrees with the Python extractor's own snapshot.
      const py = await extractPythonRepo(join(dir, "repo"));
      expect(built.graph.repoSnapshotSha256, `${name} snapshot`).toBe(py.repoSnapshotSha256);
      expect(built.graph.externalImportCount, `${name} external`).toBe(py.externalImports.length);
    }
  }, 180_000);

  test("typescript fixtures (16): modules, edges, reachable/isolated vs golden BFS", async () => {
    for (const name of listFixtures("typescript")) {
      const dir = join(FIXTURES_ROOT, "typescript", name);
      const golden = JSON.parse(readFileSync(join(dir, "golden.json"), "utf8"));
      const tomlAbs = join(dir, "repo", ".repomapverify.toml");
      const tomlPaths = existsSync(tomlAbs)
        ? parseEntrypointsTomlOptional(readFileSync(tomlAbs, "utf8")).paths
        : [];
      const built = await buildGroundTruthGraphFromRepo(join(dir, "repo"));
      const gotModules = [...built.graph.modules.values()]
        .map((m) => ({
          relativePath: m.relativePath,
          language: m.language,
          nodeKind: m.nodeKind,
          isEntrypoint: m.isEntrypoint,
        }))
        .sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1));
      const wantModules = golden.expected.modules
        .map((m: { relativePath: string; isEntrypoint: boolean; nodeKind: string }) => ({
          relativePath: m.relativePath,
          language: "typescript",
          nodeKind: m.nodeKind,
          isEntrypoint: m.isEntrypoint,
        }))
        .sort((a: { relativePath: string }, b: { relativePath: string }) =>
          a.relativePath < b.relativePath ? -1 : 1,
        );
      expect(gotModules, `${name} modules`).toEqual(wantModules);
      const gotEdges = [...built.graph.edges.values()]
        .map((e) => ({
          from: built.graph.modules.get(e.fromModuleId)?.relativePath,
          to: built.graph.modules.get(e.toModuleId)?.relativePath,
        }))
        .sort((a, b) =>
          (a.from ?? "") < (b.from ?? "") ? -1 : (a.from ?? "") > (b.from ?? "") ? 1 : (a.to ?? "") < (b.to ?? "") ? -1 : (a.to ?? "") > (b.to ?? "") ? 1 : 0,
        );
      const wantEdges = golden.expected.edges
        .map((e: { from: string; to: string }) => ({ from: e.from, to: e.to }))
        .sort((a: { from: string; to: string }, b: { from: string; to: string }) =>
          a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0,
        );
      expect(gotEdges, `${name} edges`).toEqual(wantEdges);
      const wantReach = expectedReachability(
        golden.expected.modules,
        golden.expected.edges,
        tomlPaths,
        "typescript",
      );
      expect(reachabilityPaths(built), `${name} reachability`).toEqual(wantReach);
      expect(built.graph.externalImportCount, `${name} external`).toBe(
        golden.expected.externalImportCount,
      );
    }
  }, 180_000);

  test("go fixtures (16): packages, edges, reachable/isolated vs golden BFS", async () => {
    for (const name of listFixtures("go")) {
      const dir = join(FIXTURES_ROOT, "go", name);
      const golden = JSON.parse(readFileSync(join(dir, "golden.json"), "utf8"));
      const tomlAbs = join(dir, "repo", ".repomapverify.toml");
      const tomlPaths = existsSync(tomlAbs)
        ? parseEntrypointsTomlOptional(readFileSync(tomlAbs, "utf8")).paths
        : [];
      const built = await buildGroundTruthGraphFromRepo(join(dir, "repo"));
      const gotModules = [...built.graph.modules.values()]
        .map((m) => ({
          relativePath: m.relativePath,
          language: m.language,
          nodeKind: m.nodeKind,
          isEntrypoint: m.isEntrypoint,
        }))
        .sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1));
      const wantModules = golden.expected.modules
        .map((m: { relativePath: string; isEntrypoint: boolean; nodeKind: string }) => ({
          relativePath: m.relativePath,
          language: "go",
          nodeKind: m.nodeKind,
          isEntrypoint: m.isEntrypoint,
        }))
        .sort((a: { relativePath: string }, b: { relativePath: string }) =>
          a.relativePath < b.relativePath ? -1 : 1,
        );
      expect(gotModules, `${name} modules`).toEqual(wantModules);
      const gotEdges = [...built.graph.edges.values()]
        .map((e) => ({
          from: built.graph.modules.get(e.fromModuleId)?.relativePath,
          to: built.graph.modules.get(e.toModuleId)?.relativePath,
        }))
        .sort((a, b) =>
          (a.from ?? "") < (b.from ?? "") ? -1 : (a.from ?? "") > (b.from ?? "") ? 1 : (a.to ?? "") < (b.to ?? "") ? -1 : (a.to ?? "") > (b.to ?? "") ? 1 : 0,
        );
      const wantEdges = golden.expected.edges
        .map((e: { from: string; to: string }) => ({ from: e.from, to: e.to }))
        .sort((a: { from: string; to: string }, b: { from: string; to: string }) =>
          a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0,
        );
      expect(gotEdges, `${name} edges`).toEqual(wantEdges);
      const wantReach = expectedReachability(
        golden.expected.modules,
        golden.expected.edges,
        tomlPaths,
        "go",
      );
      expect(reachabilityPaths(built), `${name} reachability`).toEqual(wantReach);
      expect(built.graph.externalImportCount, `${name} external`).toBe(
        golden.expected.externalImportCount,
      );
    }
  }, 180_000);
});

describe("symlink end-to-end (real Python repo)", () => {
  test("in-repo symlink merges, outside symlink is never a module", async () => {
    const base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "t005-graph-"));
    const repo = join(base, "repo");
    const outside = join(base, "outside");
    try {
      mkdirSync(join(repo, "pkg"), { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(repo, ".repomapverify.toml"), '[entrypoints]\npaths = ["main.py"]\n');
      writeFileSync(join(repo, "main.py"), "from pkg.mod import run\n");
      writeFileSync(join(repo, "pkg", "__init__.py"), "");
      writeFileSync(join(repo, "pkg", "mod.py"), "def run():\n    pass\n");
      symlinkSync(join(repo, "pkg", "mod.py"), join(repo, "aliasmod.py"));
      writeFileSync(join(outside, "secret.py"), "x = 1\n");
      symlinkSync(join(outside, "secret.py"), join(repo, "ext.py"));

      const built = await buildGroundTruthGraphFromRepo(repo);
      const paths = [...built.graph.modules.values()].map((m) => m.relativePath).sort();
      // One module for the physical mod.py (two spellings), none for ext.py.
      expect(paths).toContain("main.py");
      expect(paths).toContain("pkg/__init__.py");
      expect(paths).not.toContain("ext.py");
      expect(paths.filter((p) => p === "pkg/mod.py" || p === "aliasmod.py")).toHaveLength(1);
      const mergedId = [...built.graph.modules.values()].find(
        (m) => m.relativePath === "pkg/mod.py" || m.relativePath === "aliasmod.py",
      )?.moduleId;
      expect(mergedId).toBeDefined();
      expect(built.aliases.get(mergedId as string)).toHaveLength(1);
      expect(built.graph.edges.size).toBe(1);
      expect(reachabilityPaths(built).reachable).toEqual([
        "main.py",
        "pkg/__init__.py",
        paths.find((p) => p === "pkg/mod.py" || p === "aliasmod.py") as string,
      ].sort());
      // Snapshot counts the physical file once (canonical path only).
      const snapLines = built.graph.repoSnapshotSha256;
      expect(snapLines).toBe(sha256(
        [
          `.repomapverify.toml\0${sha256('[entrypoints]\npaths = ["main.py"]\n')}\n`,
          `main.py\0${sha256("from pkg.mod import run\n")}\n`,
          `pkg/__init__.py\0${sha256("")}\n`,
          `${paths.find((p) => p === "pkg/mod.py" || p === "aliasmod.py")}\0${sha256("def run():\n    pass\n")}\n`,
        ].sort().join(""),
      ));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, 120_000);
});
