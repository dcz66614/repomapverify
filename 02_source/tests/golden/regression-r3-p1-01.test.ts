/**
 * FIX P024 R3 P1-01 regression: a tsconfig `extends` chain must never
 * let a bare specifier silently fall through to `external`.
 *
 * The gap (GPT R3 verdict, verified by the main chat): `hasExtends`
 * was only declared (resolve.ts:63) and assigned (resolve.ts:155) —
 * never read. resolveSpecifier() resolved only the CURRENT tsconfig's
 * paths/baseUrl, and a bare specifier that looked like a plausible
 * npm name (e.g. `@acme/internal`) reached the step-5 fallback and
 * became `external`. The alias defined only in the inherited base
 * config was therefore silently dropped, the edge vanished, and a
 * FULL_GRAPH claimed map audited PASS.
 *
 * GPT repro: tsconfig.json {"extends":"./base.json",
 * "compilerOptions":{"baseUrl":"."}}; base.json paths
 * {"@acme/*":["src/*"]}; src/main.ts imports "@acme/internal";
 * src/internal.ts exists. Production returned kind=external; the
 * audit over the exact core graph returned status PASS, findings [].
 *
 * The fix (agreed convention, shared with the Oracle side):
 * `tsconfig?.hasExtends === true` forces any bare specifier that
 * reaches the step-5 external fallback to UNKNOWN with reason
 * ALIAS_NOT_RESOLVED — never `external`. The boundary fixture
 * tests/fixtures/boundary/ts-out-of-scope-extends/README.md already
 * states this convention ("the alias defined only in base.json is
 * ALIAS_NOT_RESOLVED (UNKNOWN, never guessed)"), and its expected
 * audit is INCOMPLETE with findings [] — the unknown forces
 * INCOMPLETE through the existing unknown-aggregation chain, no
 * extra propagation is needed.
 *
 * Scope of the rule, asserted below:
 * - node: builtins still go external (step 0, before the check);
 * - specifiers resolved by the CURRENT tsconfig paths/baseUrl, or
 *   by self-reference, are unaffected;
 * - a bad config (unreadable / malformed) keeps priority: step 4
 *   CONFIG_UNREADABLE wins over the extends rule;
 * - extends with no bare import changes nothing (PASS control);
 * - the inherited base file itself is never read, so a malformed
 *   base.json is irrelevant.
 *
 * Counterexample discipline: every failing case below is a false
 * PASS on the pre-fix code — verified by running this file against
 * the pre-fix tree (see the R3-P1-01 prod handoff for the output).
 *
 * This suite does NOT touch the S0 gate: no fixtures under
 * tests/fixtures/s0/, no golden.json changes. Repos are built in
 * TMPDIR per test and removed afterwards.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { parseClaimedMapJson } from "../../src/io/validate-claimed-map.js";
import { buildGroundTruthGraphFromRepo } from "../../src/graph/fromRepo.js";
import { computeRepoSnapshotSha256 as prodSnapshot } from "../../src/graph/fromRepo.js";
import { extractTypeScriptRepo } from "../../src/extractors/typescript/index.js";
import { loadTsConfig } from "../../src/extractors/typescript/resolve.js";
import { collectEvidence } from "../../src/cli/evidence.js";
import { compareMapsDetailed } from "../../src/comparator/compare.js";

/** Paths that must fail (EACCES injection — root bypasses chmod). */
const failState = vi.hoisted(() => ({
  files: new Set<string>(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const denied = () => {
    const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
    err.code = "EACCES";
    return err;
  };
  return {
    ...actual,
    readFileSync: function (this: unknown, ...args: unknown[]) {
      const p = args[0];
      if (typeof p === "string" && failState.files.has(p)) throw denied();
      return (actual.readFileSync as (...a: unknown[]) => unknown).apply(
        this,
        args,
      );
    },
  };
});

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SRC_ROOT = join(HERE, "..", "..");

afterEach(() => {
  failState.files.clear();
  for (const d of tmpDirs.splice(0)) {
    try {
      chmodSync(d, 0o755);
    } catch {
      /* already gone */
    }
    rmSync(d, { recursive: true, force: true });
  }
});

/** Temp dirs created by this file (repos), removed after each test. */
const tmpDirs: string[] = [];

function writeRepo(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
}

function mkRepo(files: Record<string, string>): string {
  const root = mkdtempSync(
    join(process.env.TMPDIR ?? tmpdir(), "regression-r3-p1-01-"),
  );
  tmpDirs.push(root);
  writeRepo(root, files);
  return root;
}

interface ClaimModule {
  id: string;
  path: string;
  kind: "module" | "package";
}

function claimedMap(
  snapshot: string,
  modules: ClaimModule[],
  edges: { from: string; to: string }[],
  entrypoints: string[] = [],
): Record<string, unknown> {
  return {
    schema: "repomapverify.claimed-map/v1",
    mapId: "r3-p1-01-regression",
    repo: "regression",
    completeness: "FULL_GRAPH",
    repoSnapshotSha256: snapshot,
    modules,
    entrypoints,
    edges,
  };
}

/** Run the production audit in-process (mocked fs active). */
async function runProduction(repo: string, map: Record<string, unknown>) {
  const checked = parseClaimedMapJson(JSON.stringify(map));
  expect(
    checked.ok,
    `production validator rejected the map: ${JSON.stringify(
      (checked as { errors?: unknown }).errors ?? null,
    )}`,
  ).toBe(true);
  if (!checked.ok) throw new Error("unreachable");
  const built = await buildGroundTruthGraphFromRepo(repo);
  const { evidence } = await collectEvidence(repo);
  const { report } = compareMapsDetailed(built, checked.map, evidence);
  return { built, evidence, report };
}

function findingKeys(
  findings: { id: string; from?: string; to?: string }[],
): string[] {
  return findings
    .map((f) => `${f.id}\0${f.from ?? ""}\0${f.to ?? ""}`)
    .sort();
}

/** The GPT R3 repro repo: alias @acme/* lives ONLY in base.json. */
const EXTENDS_REPO: Record<string, string> = {
  "tsconfig.json":
    '{\n  "extends": "./base.json",\n  "compilerOptions": { "baseUrl": "." }\n}\n',
  "base.json":
    '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": { "@acme/*": ["src/*"] }\n  }\n}\n',
  "src/main.ts": 'import { x } from "@acme/internal";\nconsole.log(x);\n',
  "src/internal.ts": "export const x = 1;\n",
};

const EXTENDS_MODULES: ClaimModule[] = [
  { id: "m1", path: "src/main.ts", kind: "module" },
  { id: "m2", path: "src/internal.ts", kind: "module" },
];

describe("FIX P024 R3 P1-01: tsconfig extends must not fall through to external", () => {
  test("GPT repro: inherited @acme/* alias is UNKNOWN ALIAS_NOT_RESOLVED, INCOMPLETE, never PASS", async () => {
    const repo = mkRepo(EXTENDS_REPO);
    try {
      // The loader records extends; the current config has no paths.
      const loaded = loadTsConfig(repo);
      expect(loaded.status).toBe("ok");
      expect(loaded.config?.hasExtends).toBe(true);
      expect(loaded.config?.paths).toEqual({});

      const snapshot = prodSnapshot(repo);
      // The agent's map mirrors the degraded resolution: both modules
      // claimed, the alias edge omitted. On the old code this audited
      // PASS (alias -> external, edge vanished, no finding).
      const map = claimedMap(snapshot, EXTENDS_MODULES, []);
      const { built, evidence, report } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      expect(report.status).not.toBe("PASS");
      expect(report.snapshotStatus).toBe("MATCH");
      // Same convention as the ts-out-of-scope-extends boundary
      // fixture: INCOMPLETE, findings [] — the unknown alone blocks
      // PASS; the config itself is fine, so no SOURCE_NOT_ENUMERATED.
      expect(report.findings).toEqual([]);
      expect(built.typescriptConfigProblems).toBeUndefined();
      // The import is UNKNOWN (ALIAS_NOT_RESOLVED), never external.
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.externalImportCount).toBe(0);
      expect(ts.edges).toEqual([]);
      expect(
        ts.unknowns.filter((u) => u.specifier === "@acme/internal"),
      ).toEqual([
        expect.objectContaining({
          from: "src/main.ts",
          specifier: "@acme/internal",
          reason: "ALIAS_NOT_RESOLVED",
        }),
      ]);
      // The evidence the comparator sees carries the same unknown.
      expect(
        (evidence.unknownImports ?? []).filter(
          (u) =>
            u.specifier === "@acme/internal" &&
            u.reason === "ALIAS_NOT_RESOLVED",
        ).length,
      ).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("extends + ordinary third-party import: also UNKNOWN, never external", async () => {
    // The agreed convention is about ANY bare specifier reaching the
    // step-5 fallback while hasExtends is true: the inherited config
    // might have defined it, so it cannot be ruled out as external.
    const repo = mkRepo({
      ...EXTENDS_REPO,
      "src/main.ts": 'import "react";\nimport "./internal";\n',
    });
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        EXTENDS_MODULES,
        [{ from: "src/main.ts", to: "src/internal.ts" }],
      );
      const { report } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      expect(report.status).not.toBe("PASS");
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.externalImportCount).toBe(0);
      expect(
        ts.unknowns.filter((u) => u.specifier === "react"),
      ).toEqual([
        expect.objectContaining({ reason: "ALIAS_NOT_RESOLVED" }),
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("extends + node builtin: still external, PASS (step 0 precedes the extends check)", async () => {
    const repo = mkRepo({
      ...EXTENDS_REPO,
      "src/main.ts": 'import "node:fs";\nimport "./internal";\n',
    });
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        EXTENDS_MODULES,
        [{ from: "src/main.ts", to: "src/internal.ts" }],
      );
      const { report } = await runProduction(repo, map);
      expect(report.status).toBe("PASS");
      expect(report.findings).toEqual([]);
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.externalImportCount).toBe(1);
      expect(ts.unknowns).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("extends + alias resolved by the CURRENT tsconfig paths: unaffected, PASS", async () => {
    const repo = mkRepo({
      "tsconfig.json":
        '{\n  "extends": "./base.json",\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": { "@acme/*": ["src/*"] }\n  }\n}\n',
      "base.json": '{ "compilerOptions": { "baseUrl": "." } }\n',
      "src/main.ts": 'import { x } from "@acme/internal";\nconsole.log(x);\n',
      "src/internal.ts": "export const x = 1;\n",
    });
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        EXTENDS_MODULES,
        [{ from: "src/main.ts", to: "src/internal.ts" }],
      );
      const { report } = await runProduction(repo, map);
      expect(report.status).toBe("PASS");
      expect(report.findings).toEqual([]);
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.externalImportCount).toBe(0);
      expect(ts.edges).toHaveLength(1);
      expect(ts.unknowns).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("extends + specifier resolved via CURRENT baseUrl: unaffected, PASS", async () => {
    const repo = mkRepo({
      ...EXTENDS_REPO,
      "src/main.ts": 'import { x } from "src/internal";\nconsole.log(x);\n',
    });
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        EXTENDS_MODULES,
        [{ from: "src/main.ts", to: "src/internal.ts" }],
      );
      const { report } = await runProduction(repo, map);
      expect(report.status).toBe("PASS");
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.edges).toHaveLength(1);
      expect(ts.unknowns).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("extends + no bare import at all: PASS (extends alone is not a problem)", async () => {
    const repo = mkRepo({
      ...EXTENDS_REPO,
      "src/main.ts": 'import "./internal";\nconsole.log(1);\n',
    });
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        EXTENDS_MODULES,
        [{ from: "src/main.ts", to: "src/internal.ts" }],
      );
      const { report } = await runProduction(repo, map);
      expect(report.status).toBe("PASS");
      expect(report.findings).toEqual([]);
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.unknowns).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("extends + malformed base.json: base is never read, PASS", async () => {
    const repo = mkRepo({
      ...EXTENDS_REPO,
      "base.json": "{ broken json\n",
      "src/main.ts": 'import "./internal";\nconsole.log(1);\n',
    });
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        EXTENDS_MODULES,
        [{ from: "src/main.ts", to: "src/internal.ts" }],
      );
      const { report } = await runProduction(repo, map);
      expect(report.status).toBe("PASS");
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.unknowns).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("extends + unreadable tsconfig: CONFIG_UNREADABLE wins over the extends rule (step 4 priority)", async () => {
    const repo = mkRepo(EXTENDS_REPO);
    failState.files.add(join(repo, "tsconfig.json"));
    try {
      expect(loadTsConfig(repo)).toEqual({ status: "unreadable" });
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(snapshot, EXTENDS_MODULES, []);
      const { built, report } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      expect(report.status).not.toBe("PASS");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0tsconfig.json\0",
      ]);
      expect(built.typescriptConfigProblems).toEqual([
        { file: "tsconfig.json", status: "UNREADABLE" },
      ]);
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.externalImportCount).toBe(0);
      expect(
        ts.unknowns.filter((u) => u.specifier === "@acme/internal"),
      ).toEqual([
        expect.objectContaining({ reason: "CONFIG_UNREADABLE" }),
      ]);
    } finally {
      failState.files.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

/**
 * REAL permission / CLI check: the GPT repro repo run through the
 * BUILT CLI as user `nobody` (no mocks). The extends behaviour is
 * filesystem-independent, but the end-to-end CLI path (exit code,
 * report status) is what GPT exercised, so it is asserted here for
 * real — plus a chmod-000 variant proving CONFIG_UNREADABLE still
 * takes priority over the extends rule for a real non-root user.
 */
describe("FIX P024 R3 P1-01: real CLI as nobody (no mocks)", () => {
  // Probe at COLLECTION time (describe bodies run at collection, so
  // test.skipIf below sees the real value; a beforeAll-set flag would
  // always read false here and skip every test).
  const NOBODY_OK = (() => {
    try {
      return (
        spawnSync("runuser", ["-u", "nobody", "--", "node", "--version"], {
          encoding: "utf8",
          timeout: 30000,
        }).status === 0
      );
    } catch {
      return false;
    }
  })();

  // Real /tmp: os.tmpdir() honours TMPDIR (workspace here), which
  // `nobody` cannot traverse. Every nobody-visible path uses /tmp.
  const REAL_TMP = "/tmp";
  let nobodyDir = "";
  let cliDir = "";
  /** Per-test repo dirs, removed after each test. */
  const repoTmp: string[] = [];

  beforeAll(() => {
    if (!NOBODY_OK) return;
    // The built CLI must exist and be current for the nobody run.
    const build = spawnSync("npm", ["run", "build"], {
      cwd: SRC_ROOT,
      encoding: "utf8",
      timeout: 180000,
    });
    expect(
      build.status,
      `npm run build failed: ${build.stdout ?? ""}${build.stderr ?? ""}`,
    ).toBe(0);
    // /home/hatch is not traversable by nobody, so the CLI (dist +
    // node_modules) is copied under /tmp and made world-readable.
    nobodyDir = mkdtempSync(join(REAL_TMP, "r3-p1-01-nobody-"));
    // mkdtemp creates 0700: `nobody` could not even traverse it.
    chmodSync(nobodyDir, 0o755);
    cliDir = join(nobodyDir, "cli");
    mkdirSync(cliDir, { recursive: true });
    chmodSync(cliDir, 0o755);
    const cp = spawnSync(
      "cp",
      ["-a", join(SRC_ROOT, "dist"), join(SRC_ROOT, "node_modules"), cliDir],
      { encoding: "utf8", timeout: 180000 },
    );
    expect(cp.status, `copying dist/node_modules failed: ${cp.stderr ?? ""}`).toBe(0);
    const chmod = spawnSync("chmod", ["-R", "a+rX", cliDir], {
      encoding: "utf8",
      timeout: 120000,
    });
    expect(chmod.status).toBe(0);
  }, 300000);

  afterAll(() => {
    if (nobodyDir !== "") rmSync(nobodyDir, { recursive: true, force: true });
  });

  afterEach(() => {
    failState.files.clear();
    for (const d of repoTmp.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  /** Build a world-readable repo fixture under /tmp. */
  function mkNobodyRepo(files: Record<string, string>): string {
    const root = mkdtempSync(join(REAL_TMP, "r3-p1-01-repo-"));
    repoTmp.push(root);
    chmodSync(root, 0o755);
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content, "utf8");
      chmodSync(join(abs, ".."), 0o755);
      chmodSync(abs, 0o644);
    }
    return root;
  }

  /** Snapshot of a repo as seen by `nobody` (production code). */
  function snapshotAsNobody(repo: string): string {
    const script = join(nobodyDir, "snap.mjs");
    writeFileSync(
      script,
      [
        `import { computeRepoSnapshotSha256 } from ${JSON.stringify(join(cliDir, "dist", "graph", "fromRepo.js"))};`,
        `process.stdout.write(computeRepoSnapshotSha256(${JSON.stringify(repo)}));`,
        "",
      ].join("\n"),
      "utf8",
    );
    chmodSync(script, 0o644);
    const r = spawnSync("runuser", ["-u", "nobody", "--", "node", script], {
      encoding: "utf8",
      timeout: 60000,
    });
    expect(
      r.status,
      `snapshot-as-nobody failed: ${r.stderr ?? ""}`,
    ).toBe(0);
    expect(r.stdout).toMatch(/^[0-9a-f]{64}$/);
    return r.stdout;
  }

  /** Run the built CLI as `nobody`; returns exit code + stdout + report. */
  function auditAsNobody(
    repo: string,
    map: Record<string, unknown>,
  ): { code: number | null; stdout: string; report: Record<string, any> } {
    const mapPath = join(nobodyDir, "claimed-map.json");
    writeFileSync(mapPath, JSON.stringify(map), "utf8");
    chmodSync(mapPath, 0o644);
    const outDir = join(nobodyDir, "out");
    mkdirSync(outDir, { recursive: true });
    chmodSync(outDir, 0o777);
    const r = spawnSync(
      "runuser",
      [
        "-u",
        "nobody",
        "--",
        "node",
        join(cliDir, "dist", "cli.js"),
        "audit",
        "--repo",
        repo,
        "--map",
        mapPath,
        "--out",
        outDir,
        "--format",
        "json",
      ],
      { encoding: "utf8", timeout: 120000 },
    );
    const reportPath = join(outDir, "repomapverify-report.json");
    expect(
      existsSync(reportPath),
      `CLI as nobody wrote no report (exit ${r.status}): stdout=${r.stdout ?? ""} stderr=${r.stderr ?? ""}`,
    ).toBe(true);
    const report = JSON.parse(
      readFileSync(reportPath, "utf8"),
    ) as Record<string, any>;
    return { code: r.status, stdout: r.stdout ?? "", report };
  }

  test.skipIf(!NOBODY_OK)(
    "GPT repro via CLI as nobody: exit 2, INCOMPLETE, never PASS",
    () => {
      const repo = mkNobodyRepo(EXTENDS_REPO);
      const snapshot = snapshotAsNobody(repo);
      const map = claimedMap(snapshot, EXTENDS_MODULES, []);
      const { code, stdout, report } = auditAsNobody(repo, map);
      expect(code).toBe(2);
      expect(stdout).toContain("RESULT: INCOMPLETE");
      expect(report.status).toBe("INCOMPLETE");
      expect(report.status).not.toBe("PASS");
      expect(report.snapshotStatus).toBe("MATCH");
      expect(report.findings).toEqual([]);
    },
  );

  test.skipIf(!NOBODY_OK)(
    "chmod 000 tsconfig (extends repo), CLI as nobody: exit 2, INCOMPLETE, SOURCE_NOT_ENUMERATED",
    () => {
      const repo = mkNobodyRepo(EXTENDS_REPO);
      chmodSync(join(repo, "tsconfig.json"), 0o000);
      try {
        const snapshot = snapshotAsNobody(repo);
        // Sanity: the nobody snapshot is the MARKERED hash, not the
        // clean hash a root read would produce.
        failState.files.clear();
        expect(prodSnapshot(repo)).not.toBe(snapshot);
        const map = claimedMap(snapshot, EXTENDS_MODULES, []);
        const { code, stdout, report } = auditAsNobody(repo, map);
        expect(code).toBe(2);
        expect(stdout).toContain("RESULT: INCOMPLETE");
        expect(report.status).toBe("INCOMPLETE");
        expect(report.status).not.toBe("PASS");
        expect(report.snapshotStatus).toBe("MATCH");
        expect(findingKeys(report.findings)).toEqual([
          "SOURCE_NOT_ENUMERATED\0tsconfig.json\0",
        ]);
      } finally {
        chmodSync(join(repo, "tsconfig.json"), 0o644);
      }
    },
  );

  test.skipIf(!NOBODY_OK)(
    "extends + relative-only control, CLI as nobody: exit 0, PASS",
    () => {
      const repo = mkNobodyRepo({
        ...EXTENDS_REPO,
        "src/main.ts": 'import "./internal";\nconsole.log(1);\n',
      });
      const snapshot = snapshotAsNobody(repo);
      const map = claimedMap(
        snapshot,
        EXTENDS_MODULES,
        [{ from: "src/main.ts", to: "src/internal.ts" }],
      );
      const { code, stdout, report } = auditAsNobody(repo, map);
      expect(code).toBe(0);
      expect(stdout).toContain("RESULT: PASS");
      expect(report.status).toBe("PASS");
      expect(report.findings).toEqual([]);
    },
  );
});
