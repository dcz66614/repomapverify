/**
 * T006 comparator unit tests (PROJECT_BOOK §5.1–§5.2; PLAN T006).
 *
 * Synthetic BuiltGraphs (via the frozen T005 `buildGraph`) + synthetic
 * claimed maps. Each rule is tested in isolation; the 48 S0 fixtures
 * are covered by golden.test.ts in this directory.
 *
 * Status expectations follow the frozen rules:
 * - FAIL iff any FAIL-class finding (gate FAIL_FINDING_IDS).
 * - Else INCOMPLETE iff any INCOMPLETE-forcing finding, any
 *   unresolvable import, any non-OK parseStatus, any
 *   UNKNOWN_ENDPOINT / CONFLICT_DROPPED_ENDPOINT dropped edge, or
 *   any unresolved entrypoint.
 * - Else PASS — including when the only findings are the P2 report
 *   findings DUPLICATE_CONTENT / GENERATED_MISMATCH (§5.1 FAIL
 *   enumerates exactly hallucinated edge/module, wrong entrypoint,
 *   missing edge, unclaimed reachable module, plus the gate's
 *   NAME_COLLISION_CONFUSION).
 */
import { describe, expect, test } from "vitest";
import {
  computeContentSha256,
  computeModuleId,
  type Language,
  type ModuleV1,
} from "../../src/contracts/module.js";
import type { ClaimedMapV1 } from "../../src/contracts/claimed-map.js";
import { FINDING_DEFAULT_SEVERITY } from "../../src/contracts/findings.js";
import { buildGraph } from "../../src/graph/build.js";
import type { BuiltGraph } from "../../src/graph/types.js";
import {
  compareMaps,
  compareMapsDetailed,
  informationalFindings,
} from "../../src/comparator/compare.js";
import {
  duplicateContentFinding,
  dynamicImportUnknownFinding,
  entrypointCandidateFinding,
  generatedMismatchFinding,
  hallucinatedEdgeFinding,
  hallucinatedModuleFinding,
  isolatedModuleFinding,
  missingEdgeFinding,
  nameCollisionConfusionFinding,
  sourceNotEnumeratedFinding,
  unclaimedReachableModuleFinding,
  wrongEntrypointFinding,
} from "../../src/findings/findings.js";
import { normalizeRelativePath } from "../../src/contracts/module.js";

const SNAP = "0".repeat(64);
const OTHER_SNAP = "1".repeat(64);

function mod(
  language: Language,
  relativePath: string,
  content = `${relativePath}\n`,
  extra: Partial<ModuleV1> = {},
): ModuleV1 {
  const normalized = normalizeRelativePath(
    relativePath === "." ? "" : relativePath,
  );
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

function build(
  modules: ModuleV1[],
  edges: { from: string; to: string }[],
  entrypointPaths: string[],
  snapshot: string = SNAP,
): BuiltGraph {
  const byId = new Map(modules.map((m) => [m.relativePath, m.moduleId]));
  return buildGraph({
    modules: modules.map((m) => ({ module: m })),
    edges: edges.map((e) => ({
      fromModuleId: byId.get(e.from) as string,
      toModuleId: byId.get(e.to) as string,
    })),
    entrypointPaths,
    repoSnapshotSha256: snapshot,
  });
}

function claim(
  modules: string[],
  edges: { from: string; to: string }[],
  entrypoints: string[],
  opts: {
    completeness?: "FULL_GRAPH" | "PARTIAL_SUBGRAPH";
    snapshot?: string;
  } = {},
): ClaimedMapV1 {
  return {
    schema: "repomapverify.claimed-map/v1",
    mapId: "test-map",
    repo: "test-repo",
    completeness: opts.completeness ?? "FULL_GRAPH",
    repoSnapshotSha256: opts.snapshot ?? SNAP,
    modules: modules.map((p, i) => ({
      id: `m${i + 1}`,
      path: p,
      kind: "module" as const,
    })),
    entrypoints,
    edges,
  };
}

/** Shorthand: finding ids of a report, in report order. */
function ids(report: ReturnType<typeof compareMaps>): string[] {
  return report.findings.map((f) => f.id);
}

describe("control: exact match passes", () => {
  test("FULL_GRAPH exact match => PASS, 0 findings, full coverage", () => {
    const main = mod("python", "main.py");
    const a = mod("python", "a.py");
    const built = build([main, a], [{ from: "main.py", to: "a.py" }], ["main.py"]);
    const report = compareMaps(
      built,
      claim(["main.py", "a.py"], [{ from: "main.py", to: "a.py" }], ["main.py"]),
    );
    expect(report.status).toBe("PASS");
    expect(report.findings).toEqual([]);
    expect(report.snapshotStatus).toBe("MATCH");
    expect(report.coverage).toEqual({ verifiedClaims: 4, totalClaims: 4 });
    expect(report.groundTruth).toEqual({ modules: 2, edges: 1 });
  });
});

describe("hallucination", () => {
  test("claimed edge + module that do not exist => HALLUCINATED_EDGE + HALLUCINATED_MODULE, FAIL", () => {
    const api = mod("python", "billing/api.py");
    const auth = mod("python", "billing/auth.py");
    const built = build(
      [api, auth],
      [{ from: "billing/api.py", to: "billing/auth.py" }],
      ["billing/api.py"],
    );
    const report = compareMaps(
      built,
      claim(
        ["billing/api.py", "billing/auth.py", "billing/refunds.py"],
        [
          { from: "billing/api.py", to: "billing/auth.py" },
          { from: "billing/api.py", to: "billing/refunds.py" },
        ],
        ["billing/api.py"],
      ),
    );
    expect(report.status).toBe("FAIL");
    expect(ids(report)).toEqual(["HALLUCINATED_EDGE", "HALLUCINATED_MODULE"]);
    expect(report.coverage).toEqual({ verifiedClaims: 4, totalClaims: 6 });
    const edge = report.findings.find((f) => f.id === "HALLUCINATED_EDGE");
    expect(edge?.severity).toBe("P1");
    expect(edge?.claimedJsonPath).toBe("edges[1]");
  });

  test("claimed path that does not exist is HALLUCINATED, never UNKNOWN", () => {
    const main = mod("python", "main.py");
    const built = build([main], [], ["main.py"]);
    const report = compareMaps(
      built,
      claim(["main.py", "ghost.py"], [], ["main.py"]),
    );
    expect(report.status).toBe("FAIL");
    expect(ids(report)).toEqual(["HALLUCINATED_MODULE"]);
    expect(ids(report)).not.toContain("SOURCE_NOT_ENUMERATED");
    expect(ids(report)).not.toContain("DYNAMIC_IMPORT_UNKNOWN");
  });

  test("claimed './'-prefixed path resolves; unsafe '..' path is hallucinated, not normalized into the repo", () => {
    const main = mod("python", "main.py");
    const a = mod("python", "a.py");
    const built = build([main, a], [{ from: "main.py", to: "a.py" }], ["main.py"]);
    const ok = compareMaps(
      built,
      claim(["./main.py", "a.py"], [{ from: "./main.py", to: "a.py" }], ["main.py"]),
    );
    expect(ok.status).toBe("PASS");
    const bad = compareMaps(
      built,
      claim(["main.py", "a.py", "../evil.py"], [{ from: "main.py", to: "a.py" }], ["main.py"]),
    );
    expect(bad.status).toBe("FAIL");
    expect(ids(bad)).toEqual(["HALLUCINATED_MODULE"]);
  });

  test("duplicate claimed modules/edges are deduplicated, not double-reported", () => {
    const main = mod("python", "main.py");
    const built = build([main], [], ["main.py"]);
    const report = compareMaps(
      built,
      claim(
        ["main.py", "main.py", "ghost.py", "ghost.py"],
        [
          { from: "main.py", to: "ghost.py" },
          { from: "main.py", to: "ghost.py" },
        ],
        ["main.py"],
      ),
    );
    expect(report.findings).toHaveLength(2);
    expect(report.claimed).toEqual({ modules: 2, edges: 1 });
  });
});

describe("entrypoints", () => {
  test("claimed entrypoint not declared => WRONG_ENTRYPOINT, FAIL", () => {
    const main = mod("python", "main.py");
    const api = mod("python", "api.py");
    const built = build([main, api], [], ["main.py"]);
    const report = compareMaps(
      built,
      claim(["main.py", "api.py"], [], ["api.py"]),
    );
    expect(report.status).toBe("FAIL");
    expect(ids(report)).toEqual(["WRONG_ENTRYPOINT"]);
  });

  test("no declaration => no WRONG_ENTRYPOINT; candidates are info findings only", () => {
    const main = mod("python", "main.py");
    const a = mod("python", "a.py");
    const built = build(
      [main, a],
      [{ from: "main.py", to: "a.py" }],
      [],
    );
    const { report, infoFindings } = compareMapsDetailed(
      built,
      claim(["main.py", "a.py"], [{ from: "main.py", to: "a.py" }], ["main.py"]),
    );
    expect(report.status).toBe("PASS");
    expect(report.findings).toEqual([]);
    expect(infoFindings.map((f) => f.id)).toEqual(["ENTRYPOINT_CANDIDATE"]);
    expect(infoFindings[0]?.from).toBe("main.py");
    expect(infoFindings[0]?.severity).toBe("INFO");
  });

  test("Go root package claimed as '.' matches the real '.' module (go-ctrl-08)", () => {
    const root = mod("go", ".", "package main\n", { nodeKind: "package" });
    const app = mod("go", "internal/app", "package app\n", { nodeKind: "package" });
    const built = build(
      [root, app],
      [{ from: ".", to: "internal/app" }],
      ["main.go"],
    );
    const report = compareMaps(
      built,
      claim(
        [".", "internal/app"],
        [{ from: ".", to: "internal/app" }],
        ["."],
      ),
    );
    expect(report.status).toBe("PASS");
    expect(report.findings).toEqual([]);
  });

  test("Go: claimed package dir and claimed toml file path both agree with the declaration", () => {
    const server = mod("go", "cmd/server", "package server\n", { nodeKind: "package" });
    const app = mod("go", "internal/app", "package app\n", { nodeKind: "package" });
    const built = build(
      [server, app],
      [{ from: "cmd/server", to: "internal/app" }],
      ["cmd/server/main.go"],
    );
    const byDir = compareMaps(
      built,
      claim(
        ["cmd/server", "internal/app"],
        [{ from: "cmd/server", to: "internal/app" }],
        ["cmd/server"],
      ),
    );
    expect(byDir.status).toBe("PASS");
    const byFile = compareMaps(
      built,
      claim(
        ["cmd/server", "internal/app"],
        [{ from: "cmd/server", to: "internal/app" }],
        ["cmd/server/main.go"],
      ),
    );
    expect(byFile.status).toBe("PASS");
    const wrong = compareMaps(
      built,
      claim(
        ["cmd/server", "internal/app"],
        [{ from: "cmd/server", to: "internal/app" }],
        ["internal/app"],
      ),
    );
    expect(ids(wrong)).toEqual(["WRONG_ENTRYPOINT"]);
  });
});

describe("omissions: FULL_GRAPH vs PARTIAL_SUBGRAPH", () => {
  test("FULL_GRAPH: unclaimed real edge + unclaimed reachable module => MISSING_EDGE + UNCLAIMED_REACHABLE_MODULE, FAIL", () => {
    const main = mod("python", "main.py");
    const a = mod("python", "a.py");
    const b = mod("python", "b.py");
    const built = build(
      [main, a, b],
      [
        { from: "main.py", to: "a.py" },
        { from: "main.py", to: "b.py" },
      ],
      ["main.py"],
    );
    const report = compareMaps(
      built,
      claim(["main.py", "a.py"], [{ from: "main.py", to: "a.py" }], ["main.py"]),
    );
    expect(report.status).toBe("FAIL");
    expect(ids(report)).toEqual(["MISSING_EDGE", "UNCLAIMED_REACHABLE_MODULE"]);
    expect(report.findings.find((f) => f.id === "MISSING_EDGE")?.severity).toBe("P2");
  });

  test("PARTIAL_SUBGRAPH: the same omissions produce no MISSING_EDGE / UNCLAIMED_REACHABLE_MODULE", () => {
    const main = mod("python", "main.py");
    const a = mod("python", "a.py");
    const b = mod("python", "b.py");
    const built = build(
      [main, a, b],
      [
        { from: "main.py", to: "a.py" },
        { from: "main.py", to: "b.py" },
      ],
      ["main.py"],
    );
    const report = compareMaps(
      built,
      claim(["main.py", "a.py"], [{ from: "main.py", to: "a.py" }], ["main.py"], {
        completeness: "PARTIAL_SUBGRAPH",
      }),
    );
    expect(report.status).toBe("PASS");
    expect(report.findings).toEqual([]);
    // But a hallucinated claimed edge is still checked under PARTIAL_SUBGRAPH.
    const bad = compareMaps(
      built,
      claim(
        ["main.py", "a.py", "ghost.py"],
        [
          { from: "main.py", to: "a.py" },
          { from: "main.py", to: "ghost.py" },
        ],
        ["main.py"],
        { completeness: "PARTIAL_SUBGRAPH" },
      ),
    );
    expect(ids(bad)).toEqual(["HALLUCINATED_EDGE", "HALLUCINATED_MODULE"]);
  });
});

describe("stale snapshot", () => {
  test("snapshot mismatch => STALE_SNAPSHOT / INCOMPLETE with no blame findings, even with hallucinated claims", () => {
    const main = mod("python", "main.py");
    const built = build([main], [], ["main.py"]);
    const report = compareMaps(
      built,
      claim(["main.py", "ghost.py"], [{ from: "main.py", to: "ghost.py" }], ["main.py"], {
        snapshot: OTHER_SNAP,
      }),
    );
    expect(report.status).toBe("INCOMPLETE");
    expect(report.snapshotStatus).toBe("STALE_SNAPSHOT");
    expect(report.findings).toEqual([]);
    expect(report.coverage).toEqual({ verifiedClaims: 0, totalClaims: 4 });
  });

  test("missing declared snapshot => STALE_SNAPSHOT", () => {
    const main = mod("python", "main.py");
    const built = build([main], [], ["main.py"]);
    const report = compareMaps(
      built,
      claim(["main.py"], [], ["main.py"], { snapshot: "" }),
    );
    expect(report.status).toBe("INCOMPLETE");
    expect(report.snapshotStatus).toBe("STALE_SNAPSHOT");
  });
});

describe("UNKNOWN never yields PASS", () => {
  test("dynamic import unknown alone => INCOMPLETE, finding listed, no FAIL", () => {
    const loader = mod("python", "loader.py");
    const alpha = mod("python", "plugins/alpha.py");
    const built = build([loader, alpha], [], ["loader.py"]);
    const report = compareMaps(
      built,
      claim(["loader.py", "plugins/alpha.py"], [], ["loader.py"]),
      { dynamicUnknowns: [{ path: "loader.py", line: 5, statement: "importlib.import_module(name)", kind: "IMPORTLIB_VARIABLE" }] },
    );
    expect(report.status).toBe("INCOMPLETE");
    expect(ids(report)).toEqual(["DYNAMIC_IMPORT_UNKNOWN"]);
    expect(report.findings[0]?.severity).toBe("P1");
  });

  test("dynamic unknown + hallucinated edge => FAIL carrying the UNKNOWN finding (FAIL+INCOMPLETE)", () => {
    const loader = mod("python", "loader.py");
    const built = build([loader], [], ["loader.py"]);
    const report = compareMaps(
      built,
      claim(["loader.py"], [{ from: "loader.py", to: "ghost.py" }], ["loader.py"]),
      { dynamicUnknowns: [{ path: "loader.py" }] },
    );
    expect(report.status).toBe("FAIL");
    expect(ids(report)).toEqual(["DYNAMIC_IMPORT_UNKNOWN", "HALLUCINATED_EDGE"]);
  });

  test("TypeScript-style unknown import with reason DYNAMIC_IMPORT_UNKNOWN => DYNAMIC finding", () => {
    const main = mod("typescript", "src/main.ts");
    const built = build([main], [], ["src/main.ts"]);
    const report = compareMaps(
      built,
      claim(["src/main.ts"], [], ["src/main.ts"]),
      {
        unknownImports: [
          { from: "src/main.ts", specifier: "./lazy", reason: "DYNAMIC_IMPORT_UNKNOWN", line: 3 },
        ],
      },
    );
    expect(report.status).toBe("INCOMPLETE");
    expect(ids(report)).toEqual(["DYNAMIC_IMPORT_UNKNOWN"]);
  });

  test("unresolvable repo-local import => INCOMPLETE with no invented finding", () => {
    const a = mod("python", "a.py");
    const built = build([a], [], ["a.py"]);
    const report = compareMaps(
      built,
      claim(["a.py"], [], ["a.py"]),
      {
        unknownImports: [
          { from: "a.py", specifier: "pkg.missing", reason: "UNRESOLVABLE_REPO_LOCAL", line: 2, statement: "import pkg.missing" },
        ],
      },
    );
    expect(report.status).toBe("INCOMPLETE");
    expect(report.findings).toEqual([]);
  });

  test("unreadable / too-large / parse-failed source => SOURCE_NOT_ENUMERATED + INCOMPLETE", () => {
    for (const parseStatus of ["UNREADABLE", "TOO_LARGE", "PARSE_ERROR"] as const) {
      const bad = mod("python", "bad.py", "x=1\n", { parseStatus });
      const main = mod("python", "main.py");
      const built = build([main, bad], [], ["main.py"]);
      const report = compareMaps(
        built,
        claim(["main.py", "bad.py"], [], ["main.py"]),
      );
      expect(report.status, parseStatus).toBe("INCOMPLETE");
      expect(ids(report), parseStatus).toEqual(["SOURCE_NOT_ENUMERATED"]);
      expect(report.findings[0]?.severity).toBe("P1");
    }
  });
});

describe("name-collision confusion (T004-evidence rule)", () => {
  test("hallucinated target is a REAL module with the same basename as the missing target => collision fires", () => {
    const cart = mod("python", "cart.py");
    const libUtils = mod("python", "lib/utils.py");
    const shopUtils = mod("python", "shop/utils.py");
    const built = build(
      [cart, libUtils, shopUtils],
      [{ from: "cart.py", to: "shop/utils.py" }],
      ["cart.py"],
    );
    const report = compareMaps(
      built,
      claim(
        ["cart.py", "lib/utils.py", "shop/utils.py"],
        [{ from: "cart.py", to: "lib/utils.py" }],
        ["cart.py"],
      ),
    );
    expect(report.status).toBe("FAIL");
    expect(ids(report)).toEqual([
      "HALLUCINATED_EDGE",
      "MISSING_EDGE",
      "NAME_COLLISION_CONFUSION",
    ]);
    expect(
      report.findings.find((f) => f.id === "NAME_COLLISION_CONFUSION")?.severity,
    ).toBe("P1");
  });

  test("hallucinated target does not exist at all => plain HALLUCINATED, no collision", () => {
    const cart = mod("python", "cart.py");
    const shopUtils = mod("python", "shop/utils.py");
    const built = build(
      [cart, shopUtils],
      [{ from: "cart.py", to: "shop/utils.py" }],
      ["cart.py"],
    );
    const report = compareMaps(
      built,
      claim(
        ["cart.py", "shop/utils.py", "utils.py"],
        [{ from: "cart.py", to: "utils.py" }],
        ["cart.py"],
      ),
    );
    expect(ids(report)).toEqual([
      "HALLUCINATED_EDGE",
      "HALLUCINATED_MODULE",
      "MISSING_EDGE",
    ]);
    expect(ids(report)).not.toContain("NAME_COLLISION_CONFUSION");
  });

  test("PARTIAL_SUBGRAPH: no MISSING_EDGE, so no collision can fire", () => {
    const cart = mod("python", "cart.py");
    const libUtils = mod("python", "lib/utils.py");
    const shopUtils = mod("python", "shop/utils.py");
    const built = build(
      [cart, libUtils, shopUtils],
      [{ from: "cart.py", to: "shop/utils.py" }],
      ["cart.py"],
    );
    const report = compareMaps(
      built,
      claim(
        ["cart.py", "lib/utils.py", "shop/utils.py"],
        [{ from: "cart.py", to: "lib/utils.py" }],
        ["cart.py"],
        { completeness: "PARTIAL_SUBGRAPH" },
      ),
    );
    expect(ids(report)).toEqual(["HALLUCINATED_EDGE"]);
  });
});

describe("generated code and duplicate content", () => {
  test("claimed edge that exists only in generated code => GENERATED_MISMATCH, not HALLUCINATED_EDGE", () => {
    const main = mod("python", "main.py");
    const gen = mod("python", "gen_pb.py", "gen\n", { isGenerated: true });
    const built = build([main, gen], [], ["main.py"]);
    const report = compareMaps(
      built,
      claim(
        ["main.py", "gen_pb.py"],
        [{ from: "main.py", to: "gen_pb.py" }],
        ["main.py"],
      ),
      { generatedEdges: [{ from: "main.py", to: "gen_pb.py" }] },
    );
    expect(ids(report)).toEqual(["GENERATED_MISMATCH"]);
    expect(report.findings[0]?.severity).toBe("P2");
    // P2 only: not in the §5.1 FAIL enumeration, so the status stays PASS.
    expect(report.status).toBe("PASS");
    expect(report.coverage).toEqual({ verifiedClaims: 3, totalClaims: 4 });
  });

  test("duplicate content in the repo => DUPLICATE_CONTENT (P2) in info findings, report stays PASS", () => {
    const a = mod("python", "a/one.py", "same\n");
    const b = mod("python", "b/two.py", "same\n");
    const built = build([a, b], [], ["a/one.py"]);
    expect(built.duplicateContent).toHaveLength(1);
    const { report, infoFindings } = compareMapsDetailed(
      built,
      claim(["a/one.py", "b/two.py"], [], ["a/one.py"]),
    );
    expect(report.findings).toEqual([]);
    expect(infoFindings.map((f) => f.id)).toEqual(["DUPLICATE_CONTENT"]);
    expect(infoFindings[0]?.severity).toBe("P2");
    expect(report.status).toBe("PASS");
  });

  test("two EMPTY files sharing the empty-content hash are not DUPLICATE_CONTENT anywhere (py-c05)", () => {
    const a = mod("python", "billing/__init__.py", "");
    const b = mod("python", "billing/reports/__init__.py", "");
    const built = build([a, b], [], ["billing/__init__.py"]);
    expect(built.duplicateContent).toHaveLength(1);
    const { report, infoFindings } = compareMapsDetailed(
      built,
      claim(["billing/__init__.py", "billing/reports/__init__.py"], [], ["billing/__init__.py"]),
    );
    expect(report.findings).toEqual([]);
    expect(infoFindings).toEqual([]);
    expect(report.status).toBe("PASS");
  });
});

describe("BuiltGraph passthroughs", () => {
  test("identity conflict => NAME_COLLISION_CONFUSION with the verbatim conflict detail", () => {
    const main = mod("python", "main.py");
    const built: BuiltGraph = {
      ...build([main], [], ["main.py"]),
      conflicts: [
        {
          moduleId: "deadbeef",
          language: "python",
          identityPath: "Foo/bar.py",
          realPaths: ["/repo/Foo/bar.py", "/repo/foo/bar.py"],
          detail: "test conflict detail",
        },
      ],
    };
    const report = compareMaps(built, claim(["main.py"], [], ["main.py"]));
    expect(ids(report)).toEqual(["NAME_COLLISION_CONFUSION"]);
    expect(report.findings[0]?.detail).toContain("test conflict detail");
    expect(report.status).toBe("FAIL");
  });

  test("dropped UNKNOWN_ENDPOINT edge => INCOMPLETE; dropped SELF_EDGE is benign", () => {
    const main = mod("python", "main.py");
    const clean = build([main], [], ["main.py"]);
    const dropped: BuiltGraph = {
      ...clean,
      droppedEdges: [
        { fromModuleId: "a".repeat(64), toModuleId: "b".repeat(64), reason: "UNKNOWN_ENDPOINT" },
      ],
    };
    const incomplete = compareMaps(dropped, claim(["main.py"], [], ["main.py"]));
    expect(incomplete.status).toBe("INCOMPLETE");
    expect(incomplete.findings).toEqual([]);
    const selfDropped: BuiltGraph = {
      ...clean,
      droppedEdges: [
        { fromModuleId: main.moduleId, toModuleId: main.moduleId, reason: "SELF_EDGE" },
      ],
    };
    expect(compareMaps(selfDropped, claim(["main.py"], [], ["main.py"])).status).toBe("PASS");
  });

  test("unresolved declared entrypoint => INCOMPLETE, no WRONG_ENTRYPOINT invented", () => {
    const main = mod("python", "main.py");
    const built: BuiltGraph = {
      ...build([main], [], ["main.py"]),
      unresolvedEntrypoints: ["nope.py"],
    };
    const report = compareMaps(built, claim(["main.py"], [], ["main.py"]));
    expect(report.status).toBe("INCOMPLETE");
    expect(report.findings).toEqual([]);
  });
});

describe("informational findings", () => {
  test("isolated unclaimed module => ISOLATED_MODULE info finding, report stays PASS", () => {
    const main = mod("python", "main.py");
    const a = mod("python", "a.py");
    const orphan = mod("python", "orphan.py");
    const built = build(
      [main, a, orphan],
      [{ from: "main.py", to: "a.py" }],
      ["main.py"],
    );
    const { report, infoFindings } = compareMapsDetailed(
      built,
      claim(["main.py", "a.py"], [{ from: "main.py", to: "a.py" }], ["main.py"]),
    );
    expect(report.status).toBe("PASS");
    expect(report.findings).toEqual([]);
    expect(infoFindings.map((f) => f.id)).toEqual(["ISOLATED_MODULE"]);
    expect(infoFindings[0]?.from).toBe("orphan.py");
    expect(infoFindings[0]?.severity).toBe("P2");
  });

  test("isolated module that IS claimed gets no ISOLATED_MODULE finding", () => {
    const main = mod("python", "main.py");
    const orphan = mod("python", "orphan.py");
    const built = build([main, orphan], [], ["main.py"]);
    const info = informationalFindings(
      built,
      claim(["main.py", "orphan.py"], [], ["main.py"]),
    );
    expect(info).toEqual([]);
  });

  test("with a declaration there are no ENTRYPOINT_CANDIDATE info findings", () => {
    const main = mod("python", "main.py");
    const built = build([main], [], ["main.py"]);
    expect(
      informationalFindings(built, claim(["main.py"], [], ["main.py"])),
    ).toEqual([]);
  });
});

describe("finding severities: all 12 types carry their spec defaults", () => {
  test("one builder per type, severity matches FINDING_DEFAULT_SEVERITY", () => {
    const built: Record<string, ReturnType<typeof hallucinatedEdgeFinding>> = {
      HALLUCINATED_EDGE: hallucinatedEdgeFinding("a.py", "b.py"),
      HALLUCINATED_MODULE: hallucinatedModuleFinding("b.py"),
      WRONG_ENTRYPOINT: wrongEntrypointFinding("x.py", ["main.py"]),
      MISSING_EDGE: missingEdgeFinding("a.py", "b.py"),
      UNCLAIMED_REACHABLE_MODULE: unclaimedReachableModuleFinding("b.py"),
      ISOLATED_MODULE: isolatedModuleFinding("c.py"),
      ENTRYPOINT_CANDIDATE: entrypointCandidateFinding("main.py"),
      NAME_COLLISION_CONFUSION: nameCollisionConfusionFinding("a.py", "b.py"),
      DYNAMIC_IMPORT_UNKNOWN: dynamicImportUnknownFinding("a.py"),
      SOURCE_NOT_ENUMERATED: sourceNotEnumeratedFinding("a.py", "PARSE_ERROR"),
      DUPLICATE_CONTENT: duplicateContentFinding(["a.py", "b.py"], "ab12"),
      GENERATED_MISMATCH: generatedMismatchFinding("a.py", "b.py"),
    };
    expect(Object.keys(built).sort()).toEqual(
      Object.keys(FINDING_DEFAULT_SEVERITY).sort(),
    );
    for (const [id, finding] of Object.entries(built)) {
      expect(finding.severity, id).toBe(
        FINDING_DEFAULT_SEVERITY[id as keyof typeof FINDING_DEFAULT_SEVERITY],
      );
    }
  });
});

describe("determinism and ordering", () => {
  test("same inputs twice => identical reports; findings sorted by (id, from, to)", () => {
    const cart = mod("python", "cart.py");
    const libUtils = mod("python", "lib/utils.py");
    const shopUtils = mod("python", "shop/utils.py");
    const built = build(
      [cart, libUtils, shopUtils],
      [{ from: "cart.py", to: "shop/utils.py" }],
      ["cart.py"],
    );
    const claimed = claim(
      ["cart.py", "lib/utils.py", "shop/utils.py"],
      [{ from: "cart.py", to: "lib/utils.py" }],
      ["cart.py"],
    );
    const first = compareMaps(built, claimed);
    const second = compareMaps(built, claimed);
    expect(second).toEqual(first);
    expect(ids(first)).toEqual([
      "HALLUCINATED_EDGE",
      "MISSING_EDGE",
      "NAME_COLLISION_CONFUSION",
    ]);
  });
});

describe("module-level GENERATED_MISMATCH (FIX T013, P2-01)", () => {
  function claimGen(
    modules: { path: string; generated?: boolean }[],
  ): ClaimedMapV1 {
    return {
      schema: "repomapverify.claimed-map/v1",
      mapId: "test-map",
      repo: "test-repo",
      completeness: "FULL_GRAPH",
      repoSnapshotSha256: SNAP,
      modules: modules.map((m, i) => ({
        id: `m${i + 1}`,
        path: m.path,
        kind: "module" as const,
        ...(m.generated !== undefined ? { generated: m.generated } : {}),
      })),
      entrypoints: ["main.py"],
      edges: [{ from: "main.py", to: "a.py" }],
    };
  }

  test("wrong assertion on a hand-written module => PASS + 1 P2 GENERATED_MISMATCH, coverage unchanged", () => {
    const main = mod("python", "main.py");
    const a = mod("python", "a.py");
    const built = build([main, a], [{ from: "main.py", to: "a.py" }], ["main.py"]);
    const report = compareMaps(
      built,
      claimGen([
        { path: "main.py", generated: false },
        { path: "a.py", generated: true },
      ]),
    );
    expect(report.status).toBe("PASS");
    expect(ids(report)).toEqual(["GENERATED_MISMATCH"]);
    const f = report.findings[0] as { severity?: string; from?: string };
    expect(f?.severity).toBe("P2");
    expect(f?.from).toBe("a.py");
    expect(report.coverage).toEqual({ verifiedClaims: 4, totalClaims: 4 });
  });

  test("wrong assertion on a generated module => PASS + 1 P2 GENERATED_MISMATCH", () => {
    const main = mod("python", "main.py");
    const gen = mod("python", "gen.py", "gen.py\n", { isGenerated: true });
    const built = build(
      [main, gen],
      [{ from: "main.py", to: "gen.py" }],
      ["main.py"],
    );
    const report = compareMaps(
      built,
      {
        schema: "repomapverify.claimed-map/v1",
        mapId: "test-map",
        repo: "test-repo",
        completeness: "FULL_GRAPH",
        repoSnapshotSha256: SNAP,
        modules: [
          { id: "m1", path: "main.py", kind: "module" as const },
          { id: "m2", path: "gen.py", kind: "module" as const, generated: false },
        ],
        entrypoints: ["main.py"],
        edges: [{ from: "main.py", to: "gen.py" }],
      },
    );
    expect(report.status).toBe("PASS");
    expect(ids(report)).toEqual(["GENERATED_MISMATCH"]);
    expect(report.findings[0]?.from).toBe("gen.py");
  });

  test("correct assertions and absent assertions => no finding", () => {
    const main = mod("python", "main.py");
    const a = mod("python", "a.py");
    const built = build([main, a], [{ from: "main.py", to: "a.py" }], ["main.py"]);
    const report = compareMaps(
      built,
      claimGen([
        { path: "main.py", generated: false },
        { path: "a.py" },
      ]),
    );
    expect(report.status).toBe("PASS");
    expect(report.findings).toEqual([]);
  });
});
