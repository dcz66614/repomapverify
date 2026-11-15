/**
 * FIX P024 R4 P1-01 regression: tsconfig `compilerOptions: null` must
 * be MALFORMED, never silently treated as "config absent".
 *
 * The gap (GPT R4 verdict, verified by the main chat): resolve.ts
 * loadTsConfig did `const opts = raw.compilerOptions ?? {};` — for
 * `{"compilerOptions":null}` the `??` converts null to {}, so the
 * next line's `opts === null` check is dead code and the loader
 * returns status ok. The production Resolver then treats
 * `@acme/internal` as a plausible bare package name -> external,
 * the edge vanishes, and a FULL_GRAPH claimed map audits PASS.
 * The Oracle (oracle.py:977-979) does `opts =
 * data.get("compilerOptions", {})` and rejects a non-dict with
 * MALFORMED, so the two sides diverged on the same input.
 *
 * GPT repro (final dist.zip, live): input {"compilerOptions":null};
 * same repo contains import{x}from"@acme/internal"; src/internal.ts
 * exists; the map declares both modules but omits that edge.
 * Production: ok -> external -> PASS (wrong). Oracle: MALFORMED ->
 * CONFIG_UNREADABLE -> INCOMPLETE.
 *
 * The fix (agreed convention, shared with the Oracle side):
 * distinguish "field absent" from "field explicitly null" —
 * `raw.compilerOptions === undefined ? {} : raw.compilerOptions` —
 * so the existing typeof/null/Array check after it can actually
 * fire on null. Absent stays ok; {} stays ok. Nothing else in the
 * config loader changes.
 *
 * Counterexample discipline: every failing case below is a false
 * PASS on the pre-fix code — verified by running this file against
 * the pre-fix tree (see the R4-P1-01 prod handoff for the output).
 * The Oracle-side test passes on both trees (the Oracle was already
 * correct); it pins the agreement, not the fix.
 *
 * This suite does NOT touch the S0 gate: no fixtures under
 * tests/fixtures/s0/ are modified, no golden.json changes. Repos are
 * built in TMPDIR per test and removed afterwards. The last test
 * scans the S0 fixtures read-only to guard the new strict rule
 * against existing fixture content.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { parseClaimedMapJson } from "../../src/io/validate-claimed-map.js";
import { buildGroundTruthGraphFromRepo } from "../../src/graph/fromRepo.js";
import { computeRepoSnapshotSha256 as prodSnapshot } from "../../src/graph/fromRepo.js";
import { extractTypeScriptRepo } from "../../src/extractors/typescript/index.js";
import { loadTsConfig } from "../../src/extractors/typescript/resolve.js";
import { collectEvidence } from "../../src/cli/evidence.js";
import { compareMapsDetailed } from "../../src/comparator/compare.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SRC_ROOT = join(HERE, "..", "..");
const ORACLE_PY = join(SRC_ROOT, "oracle", "python", "oracle.py");

afterEach(() => {
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
    join(process.env.TMPDIR ?? tmpdir(), "regression-r4-p1-01-"),
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
    mapId: "r4-p1-01-regression",
    repo: "regression",
    completeness: "FULL_GRAPH",
    repoSnapshotSha256: snapshot,
    modules,
    entrypoints,
    edges,
  };
}

/** Run the production audit in-process. */
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

/** The GPT R4 repro repo: compilerOptions is explicitly null. */
const NULL_OPTS_REPO: Record<string, string> = {
  "tsconfig.json": '{\n  "compilerOptions": null\n}\n',
  "src/main.ts": 'import { x } from "@acme/internal";\nconsole.log(x);\n',
  "src/internal.ts": "export const x = 1;\n",
};

const NULL_OPTS_MODULES: ClaimModule[] = [
  { id: "m1", path: "src/main.ts", kind: "module" },
  { id: "m2", path: "src/internal.ts", kind: "module" },
];

describe("FIX P024 R4 P1-01: compilerOptions null is MALFORMED (unit level)", () => {
  const malformedCases: { label: string; optsJson: string }[] = [
    { label: "compilerOptions is null (GPT repro)", optsJson: "null" },
    { label: 'compilerOptions is a string "not-an-object"', optsJson: '"not-an-object"' },
    { label: "compilerOptions is a number", optsJson: "42" },
    { label: "compilerOptions is an array", optsJson: '["src/*"]' },
  ];

  for (const { label, optsJson } of malformedCases) {
    test(`${label}: loadTsConfig returns malformed`, () => {
      const repo = mkRepo({
        ...NULL_OPTS_REPO,
        "tsconfig.json": `{\n  "compilerOptions": ${optsJson}\n}\n`,
      });
      try {
        expect(loadTsConfig(repo)).toEqual({ status: "malformed" });
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });
  }

  test("compilerOptions absent: ok (control — must not be broken)", () => {
    const repo = mkRepo({
      ...NULL_OPTS_REPO,
      "tsconfig.json": "{}\n",
    });
    try {
      const loaded = loadTsConfig(repo);
      expect(loaded.status).toBe("ok");
      expect(loaded.config?.paths).toEqual({});
      expect(loaded.config?.baseUrl).toBeUndefined();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("compilerOptions {}: ok (control — must not be broken)", () => {
    const repo = mkRepo({
      ...NULL_OPTS_REPO,
      "tsconfig.json": '{\n  "compilerOptions": {}\n}\n',
    });
    try {
      const loaded = loadTsConfig(repo);
      expect(loaded.status).toBe("ok");
      expect(loaded.config?.paths).toEqual({});
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("FIX P024 R4 P1-01: GPT repro end-to-end (in-process production)", () => {
  test("compilerOptions null: MALFORMED + INCOMPLETE + SOURCE_NOT_ENUMERATED, never PASS", async () => {
    const repo = mkRepo(NULL_OPTS_REPO);
    try {
      expect(loadTsConfig(repo)).toEqual({ status: "malformed" });

      const snapshot = prodSnapshot(repo);
      // The agent's map mirrors the degraded resolution: both
      // modules claimed, the @acme/internal edge omitted. On the old
      // code this audited PASS (compilerOptions null read as absent,
      // alias -> external).
      const map = claimedMap(snapshot, NULL_OPTS_MODULES, []);
      const { built, evidence, report } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      expect(report.status).not.toBe("PASS");
      expect(report.snapshotStatus).toBe("MATCH");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0tsconfig.json\0",
      ]);
      expect(built.typescriptConfigProblems).toEqual([
        { file: "tsconfig.json", status: "MALFORMED" },
      ]);
      // The alias import is UNKNOWN (CONFIG_UNREADABLE via step 4),
      // never external.
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.externalImportCount).toBe(0);
      expect(
        ts.unknowns.filter((u) => u.specifier === "@acme/internal"),
      ).toEqual([
        expect.objectContaining({
          from: "src/main.ts",
          specifier: "@acme/internal",
          reason: "CONFIG_UNREADABLE",
        }),
      ]);
      expect(
        (evidence.unknownImports ?? []).filter(
          (u) => u.reason === "CONFIG_UNREADABLE",
        ).length,
      ).toBeGreaterThanOrEqual(1);
      expect(ts.tsconfigStatus).toBe("malformed");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("compilerOptions absent: ok, alias is external as before, PASS (control)", async () => {
    const repo = mkRepo({
      ...NULL_OPTS_REPO,
      "tsconfig.json": "{}\n",
    });
    try {
      const loaded = loadTsConfig(repo);
      expect(loaded.status).toBe("ok");
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(snapshot, NULL_OPTS_MODULES, []);
      const { built, report } = await runProduction(repo, map);
      expect(built.typescriptConfigProblems).toBeUndefined();
      expect(report.status).toBe("PASS");
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.externalImportCount).toBe(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("compilerOptions {}: ok, alias is external as before, PASS (control)", async () => {
    const repo = mkRepo({
      ...NULL_OPTS_REPO,
      "tsconfig.json": '{\n  "compilerOptions": {}\n}\n',
    });
    try {
      const loaded = loadTsConfig(repo);
      expect(loaded.status).toBe("ok");
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(snapshot, NULL_OPTS_MODULES, []);
      const { built, report } = await runProduction(repo, map);
      expect(built.typescriptConfigProblems).toBeUndefined();
      expect(report.status).toBe("PASS");
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.externalImportCount).toBe(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("FIX P024 R4 P1-01: Oracle side (independent, oracle.py unmodified)", () => {
  test("same repo, same map: Oracle MALFORMED + INCOMPLETE + CONFIG_UNREADABLE", () => {
    // The Oracle CLI works on a fixture dir (repo/ + claimed-map.json)
    // whose name carries the ts- language prefix.
    const fixture = mkdtempSync(
      join(process.env.TMPDIR ?? tmpdir(), "ts-r4-p1-01-"),
    );
    tmpDirs.push(fixture);
    const repo = join(fixture, "repo");
    mkdirSync(repo, { recursive: true });
    writeRepo(repo, NULL_OPTS_REPO);
    const snapshot = prodSnapshot(repo);
    const map = claimedMap(snapshot, NULL_OPTS_MODULES, []);
    writeFileSync(
      join(fixture, "claimed-map.json"),
      JSON.stringify(map),
      "utf8",
    );
    const outFile = join(fixture, "oracle.json");
    try {
      const r = spawnSync(
        "python3",
        [ORACLE_PY, "--fixture-dir", fixture, "--out", outFile],
        { encoding: "utf8" },
      );
      expect(r.status, `oracle failed: ${r.stderr ?? ""}`).toBe(0);
      const oracle = JSON.parse(readFileSync(outFile, "utf8")) as Record<
        string,
        any
      >;
      expect(oracle.groundTruth.tsconfigStatus).toBe("MALFORMED");
      expect(oracle.groundTruth.externalImportCount).toBe(0);
      expect(
        (oracle.groundTruth.unknownImports as unknown[]).filter(
          (u: any) =>
            u.specifier === "@acme/internal" &&
            u.reason === "CONFIG_UNREADABLE",
        ).length,
      ).toBeGreaterThanOrEqual(1);
      expect(oracle.audit.status).toBe("INCOMPLETE");
      expect(oracle.audit.status).not.toBe("PASS");
      expect(oracle.audit.snapshotStatus).toBe("MATCH");
      expect(findingKeys(oracle.audit.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0tsconfig.json\0",
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

/**
 * REAL CLI check: the GPT repro repo run through the BUILT CLI as
 * user `nobody` (no mocks). The malformed-config behaviour is
 * filesystem-independent, but the end-to-end CLI path (exit code,
 * report status) is what GPT exercised, so it is asserted here for
 * real.
 */
describe("FIX P024 R4 P1-01: real CLI as nobody (no mocks)", () => {
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
    nobodyDir = mkdtempSync(join(REAL_TMP, "r4-p1-01-nobody-"));
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
    for (const d of repoTmp.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  /** Build a world-readable repo fixture under /tmp. */
  function mkNobodyRepo(files: Record<string, string>): string {
    const root = mkdtempSync(join(REAL_TMP, "r4-p1-01-repo-"));
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
    "GPT repro via CLI as nobody: exit 2, INCOMPLETE, SOURCE_NOT_ENUMERATED, never PASS",
    () => {
      const repo = mkNobodyRepo(NULL_OPTS_REPO);
      const snapshot = snapshotAsNobody(repo);
      const map = claimedMap(snapshot, NULL_OPTS_MODULES, []);
      const { code, stdout, report } = auditAsNobody(repo, map);
      expect(code).toBe(2);
      expect(stdout).toContain("RESULT: INCOMPLETE");
      expect(report.status).toBe("INCOMPLETE");
      expect(report.status).not.toBe("PASS");
      expect(report.snapshotStatus).toBe("MATCH");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0tsconfig.json\0",
      ]);
    },
  );

  test.skipIf(!NOBODY_OK)(
    "compilerOptions absent control, CLI as nobody: exit 0, PASS",
    () => {
      const repo = mkNobodyRepo({
        ...NULL_OPTS_REPO,
        "tsconfig.json": "{}\n",
      });
      const snapshot = snapshotAsNobody(repo);
      const map = claimedMap(snapshot, NULL_OPTS_MODULES, []);
      const { code, stdout, report } = auditAsNobody(repo, map);
      expect(code).toBe(0);
      expect(stdout).toContain("RESULT: PASS");
      expect(report.status).toBe("PASS");
      expect(report.findings).toEqual([]);
    },
  );
});

describe("FIX P024 R4 P1-01: S0 fixtures carry no null/non-object compilerOptions (guard)", () => {
  test("every S0 tsconfig.json compilerOptions is absent or a plain object", () => {
    const s0Root = join(SRC_ROOT, "tests", "fixtures", "s0");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry);
        if (statSync(abs).isDirectory()) walk(abs);
        else files.push(abs);
      }
    };
    walk(s0Root);
    const tsFiles = files.filter((f) => f.endsWith("tsconfig.json"));
    expect(tsFiles.length).toBeGreaterThan(0);
    for (const f of tsFiles) {
      const raw = JSON.parse(readFileSync(f, "utf8")) as {
        compilerOptions?: unknown;
      };
      if (!("compilerOptions" in raw)) continue;
      const opts = raw.compilerOptions;
      expect(typeof opts, `${f}: compilerOptions must be an object`).toBe("object");
      expect(opts, `${f}: compilerOptions must not be null`).not.toBeNull();
      expect(Array.isArray(opts), `${f}: compilerOptions must not be an array`).toBe(false);
    }
  });
});
