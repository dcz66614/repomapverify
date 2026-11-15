/**
 * T005 canonical tests (PROJECT_BOOK §4.2, §10.1; PLAN T005/T008).
 *
 * The canonical graph hash must be stable under input reordering
 * (same semantic graph -> same hash regardless of file order) and
 * must move when content moves — while module_ids never move with
 * content. The snapshot hash is checked against an independent
 * node:crypto computation (never against the function under test).
 */
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { computeContentSha256, computeModuleId, normalizeRelativePath } from "../../src/contracts/module.js";
import { buildGraph } from "../../src/graph/build.js";
import {
  canonicalGraphHash,
  canonicalJson,
  canonicalizeGraph,
  computeCanonicalSnapshotSha256,
} from "../../src/canonical/index.js";
import type { BuildGraphInput } from "../../src/graph/types.js";
import type { Language, ModuleV1 } from "../../src/contracts/module.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function mod(language: Language, relativePath: string, content: string): ModuleV1 {
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
  };
}

/** A small three-language semantic graph, in a fixed order. */
function semanticInput(): BuildGraphInput {
  const main = mod("python", "main.py", "import a\n");
  const a = mod("python", "pkg/a.py", "x = 1\n");
  const b = mod("python", "pkg/b.py", "x = 2\n");
  const tsMain = mod("typescript", "src/main.ts", "import './lib';\n");
  const tsLib = mod("typescript", "src/lib.ts", "export {};\n");
  const goRoot = mod("go", ".", "package main\n");
  const goApp = mod("go", "internal/app", "package app\n");
  return {
    modules: [
      { module: main },
      { module: a },
      { module: b },
      { module: tsMain },
      { module: tsLib },
      { module: goRoot },
      { module: goApp },
    ],
    edges: [
      { fromModuleId: main.moduleId, toModuleId: a.moduleId },
      { fromModuleId: a.moduleId, toModuleId: b.moduleId },
      { fromModuleId: tsMain.moduleId, toModuleId: tsLib.moduleId },
      { fromModuleId: goRoot.moduleId, toModuleId: goApp.moduleId },
    ],
    entrypointPaths: ["main.py", "src/main.ts", "main.go"],
    externalImportCount: 3,
    repoSnapshotSha256: sha256("snapshot"),
  };
}

/** The same semantic graph with every list reversed / shuffled. */
function shuffledInput(): BuildGraphInput {
  const base = semanticInput();
  return {
    ...base,
    modules: [...base.modules].reverse(),
    edges: [...base.edges].reverse(),
    entrypointPaths: [...base.entrypointPaths].reverse(),
  };
}

describe("canonical graph hash", () => {
  test("same semantic graph -> same hash regardless of input file order", () => {
    const a = buildGraph(semanticInput());
    const b = buildGraph(shuffledInput());
    expect(canonicalGraphHash(a)).toBe(canonicalGraphHash(b));
    expect(canonicalJson(canonicalizeGraph(a))).toBe(canonicalJson(canonicalizeGraph(b)));
    // Canonical form itself is sorted: modules by path, edges by (from, to).
    const canon = canonicalizeGraph(a);
    expect(canon.modules.map((m) => m.relativePath)).toEqual([
      ".",
      "internal/app",
      "main.py",
      "pkg/a.py",
      "pkg/b.py",
      "src/lib.ts",
      "src/main.ts",
    ]);
    expect(canon.edges.map((e) => `${e.from} -> ${e.to}`)).toEqual([
      ". -> internal/app",
      "main.py -> pkg/a.py",
      "pkg/a.py -> pkg/b.py",
      "src/main.ts -> src/lib.ts",
    ]);
    expect(canon.entrypoints).toEqual([".", "main.py", "src/main.ts"]);
    expect(canon.reachableFromEntrypoints).toEqual([
      ".",
      "internal/app",
      "main.py",
      "pkg/a.py",
      "pkg/b.py",
      "src/lib.ts",
      "src/main.ts",
    ]);
    expect(canon.isolatedModules).toEqual([]);
  });

  test("NFD vs NFC spellings of the same graph hash identically", () => {
    const buildWithSpelling = (spelling: string): BuildGraphInput => {
      const main = mod("python", "main.py", "import cafe\n");
      const cafe = mod("python", spelling, "x = 1\n");
      return {
        modules: [{ module: main }, { module: cafe }],
        edges: [{ fromModuleId: main.moduleId, toModuleId: cafe.moduleId }],
        entrypointPaths: ["main.py"],
      };
    };
    const nfd = buildWithSpelling("pkg/cafe\u0301.py"); // e + combining acute
    const nfc = buildWithSpelling("pkg/café.py");
    const a = buildGraph(nfd);
    const b = buildGraph(nfc);
    expect(a.graph.modules.size).toBe(2);
    expect(canonicalGraphHash(a)).toBe(canonicalGraphHash(b));
    expect(canonicalizeGraph(a).modules.find((m) => m.relativePath.includes("caf"))?.relativePath).toBe(
      "pkg/café.py",
    );
    expect(canonicalizeGraph(a)).toEqual(canonicalizeGraph(b));
  });

  test("content change moves the hash but never any module_id", () => {
    const before = buildGraph(semanticInput());
    const changed = semanticInput();
    const idx = changed.modules.findIndex((m) => m.module.relativePath === "pkg/a.py");
    const oldMod = changed.modules[idx]?.module;
    const newMod = mod("python", "pkg/a.py", "x = 999 — changed\n");
    expect(newMod.moduleId).toBe(oldMod?.moduleId);
    changed.modules[idx] = { module: newMod };
    const after = buildGraph(changed);
    expect(canonicalGraphHash(after)).not.toBe(canonicalGraphHash(before));
    const beforeIds = canonicalizeGraph(before).modules.map((m) => m.moduleId).sort();
    const afterIds = canonicalizeGraph(after).modules.map((m) => m.moduleId).sort();
    expect(afterIds).toEqual(beforeIds);
    // Only the changed module's content hash differs.
    const diff = canonicalizeGraph(after).modules.filter(
      (m) =>
        canonicalizeGraph(before).modules.find((x) => x.moduleId === m.moduleId)?.contentSha256 !==
        m.contentSha256,
    );
    expect(diff.map((m) => m.relativePath)).toEqual(["pkg/a.py"]);
  });

  test("canonical JSON is key-sorted (deterministic encoding)", () => {
    const json = canonicalJson({ b: 1, a: { d: 2, c: 3 }, z: [2, 1] });
    expect(json).toBe('{"a":{"c":3,"d":2},"b":1,"z":[2,1]}');
    // Arrays keep their (already sorted) order; object keys are alphabetical.
    const graphJson = canonicalJson(canonicalizeGraph(buildGraph(semanticInput())));
    expect(graphJson.indexOf('"duplicateContent"')).toBeLessThan(graphJson.indexOf('"edges"'));
    expect(graphJson.indexOf('"edges"')).toBeLessThan(graphJson.indexOf('"modules"'));
    expect(graphJson.indexOf('"modules"')).toBeLessThan(graphJson.indexOf('"schema"'));
    expect(JSON.parse(graphJson)).toEqual(canonicalizeGraph(buildGraph(semanticInput())));
  });
});

describe("canonical snapshot hash", () => {
  test("matches an independent computation; order-independent; content-sensitive", () => {
    const files = [
      { relativePath: "b.py", contentSha256: sha256("b") },
      { relativePath: "a.py", contentSha256: sha256("a") },
      { relativePath: "pkg/c.py", contentSha256: sha256("c") },
    ];
    const independent = sha256(
      [...files]
        .sort((x, y) => (x.relativePath < y.relativePath ? -1 : 1))
        .map((f) => `${f.relativePath}\0${f.contentSha256}\n`)
        .join(""),
    );
    expect(computeCanonicalSnapshotSha256(files)).toBe(independent);
    expect(computeCanonicalSnapshotSha256([...files].reverse())).toBe(independent);
    const changed = files.map((f) =>
      f.relativePath === "a.py" ? { ...f, contentSha256: sha256("a2") } : f,
    );
    expect(computeCanonicalSnapshotSha256(changed)).not.toBe(independent);
    // Renaming a file changes the snapshot but a pure reorder does not.
    const renamed = files.map((f) =>
      f.relativePath === "a.py" ? { ...f, relativePath: "a2.py" } : f,
    );
    expect(computeCanonicalSnapshotSha256(renamed)).not.toBe(independent);
  });
});
