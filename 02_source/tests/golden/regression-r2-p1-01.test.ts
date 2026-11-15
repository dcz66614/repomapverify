/**
 * FIX P024 R2 P1-01 regression: a TypeScript resolution config that
 * exists but cannot be read or parsed must never silently degrade to
 * "no config" (PROJECT_BOOK §5.1 fail-closed).
 *
 * The gap (GPT R2 verdict, verified by the main chat): loadTsConfig /
 * loadPackageJson returned `undefined` both when the file was absent
 * AND when it existed but was unreadable or malformed, so the two
 * cases were indistinguishable. resolveSpecifier then classified an
 * alias import such as `@acme/internal` (tsconfig paths) — or a
 * package self-reference import (package.json exports) — as
 * `external`, the edge silently vanished, the snapshot only carried
 * an UNREADABLE hash marker that never reached the comparator, and a
 * claimed map that also omitted the edge audited PASS.
 *
 * The fix: the loaders return a discriminated status (absent / ok /
 * unreadable / malformed); an unreadable or malformed config yields
 * a CONFIG_UNREADABLE unknown for every affected import (never
 * `external`), a config-level unknown, and a structured
 * `BuiltGraph.typescriptConfigProblems` entry, which the comparator
 * turns into a SOURCE_NOT_ENUMERATED finding and INCOMPLETE — even
 * when no import in the repo actually uses the config (fail-closed:
 * the config is a promised resolution input, and its content is
 * unknown, not empty).
 *
 * Failure injection — READ THIS FIRST:
 *
 * The suite runs as root, and root BYPASSES permission bits: a file
 * chmod 000 is still readable to root, so a real chmod fixture would
 * silently pass in-process here and only fail on a non-root machine.
 * The in-process tests therefore inject EACCES instead of relying on
 * the filesystem, exactly like regression-p1-01.test.ts and
 * regression-toml-unreadable.test.ts:
 *
 * - `vi.mock("node:fs")` wraps readFileSync so exactly the listed
 *   absolute paths throw EACCES (code "EACCES"). Every other fs call
 *   passes through untouched, including existsSync/statSync — which
 *   is exactly real behaviour: on a chmod-000 file in a readable
 *   directory, stat still succeeds; only the read fails.
 *
 * The REAL permission check is the second describe block: it chmods
 * tsconfig.json 000 for real and runs the BUILT CLI as user `nobody`
 * via runuser (no mocks, no injection). Those tests copy dist +
 * node_modules under /tmp first, because /home/hatch is not
 * traversable by `nobody`, and skip cleanly when runuser is
 * unavailable. They assert the GPT scenario end to end: CLI exit
 * code 2, status INCOMPLETE, a SOURCE_NOT_ENUMERATED finding naming
 * tsconfig.json, never PASS.
 *
 * Oracle parity for this P1 is NOT asserted here: the Oracle fix
 * (oracle.py must stop treating an unreadable config as its default)
 * is a separate workstream in the R2 fix plan, and asserting it now
 * would fail before that work lands. The S0 gate compares production
 * against the Oracle on the 48 fixtures and will catch divergence.
 *
 * Counterexample discipline: every unreadable/malformed case below
 * is a false-PASS on the pre-fix code — verified by running this
 * file against the pre-fix tree with `git stash push -- 02_source/src`
 * (see the R2-P1-01 handoff for the output).
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
import {
  loadPackageJson,
  loadTsConfig,
} from "../../src/extractors/typescript/resolve.js";
import { collectEvidence } from "../../src/cli/evidence.js";
import { compareMapsDetailed } from "../../src/comparator/compare.js";

/** Paths that must fail. See the header note — root bypasses chmod. */
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
    // A chmod-000 file is still removable by root, but restore
    // permissions first so a later non-root cleanup never trips.
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
    join(process.env.TMPDIR ?? tmpdir(), "regression-r2-p1-01-"),
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
    mapId: "r2-p1-01-regression",
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

/** The GPT R2 repro repo: tsconfig paths @acme/* -> src/*. */
const ALIAS_REPO: Record<string, string> = {
  "tsconfig.json":
    '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": { "@acme/*": ["src/*"] }\n  }\n}\n',
  "src/main.ts": 'import { x } from "@acme/internal";\nconsole.log(x);\n',
  "src/internal.ts": "export const x = 1;\n",
};

/** Package self-reference repo: package.json exports "." -> src/index.ts. */
const SELF_REF_REPO: Record<string, string> = {
  "package.json":
    '{\n  "name": "@acme/pkg",\n  "exports": { ".": "./src/index.ts" }\n}\n',
  "src/main.ts": 'import { y } from "@acme/pkg";\nconsole.log(y);\n',
  "src/index.ts": "export const y = 2;\n",
};

describe("FIX P024 R2 P1-01: unreadable / malformed TS resolution config", () => {
  test("unreadable tsconfig: alias import is UNKNOWN, INCOMPLETE + SOURCE_NOT_ENUMERATED (GPT repro)", async () => {
    const repo = mkRepo(ALIAS_REPO);
    const tsconfigAbs = join(repo, "tsconfig.json");
    failState.files.add(tsconfigAbs);
    try {
      // The loaders must distinguish "exists but unreadable" from
      // "absent": status unreadable, no config value.
      expect(loadTsConfig(repo)).toEqual({ status: "unreadable" });
      expect(loadPackageJson(repo)).toEqual({ status: "absent" });

      const snapshot = prodSnapshot(repo);
      // The agent's map mirrors the degraded resolution: both modules
      // claimed, the alias edge omitted. On the old code this audited
      // PASS (alias -> external, edge vanished, no finding).
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "src/main.ts", kind: "module" },
          { id: "m2", path: "src/internal.ts", kind: "module" },
        ],
        [],
      );
      const { built, evidence, report } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      expect(report.status).not.toBe("PASS");
      expect(report.snapshotStatus).toBe("MATCH");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0tsconfig.json\0",
      ]);
      // Structured propagation: the snapshot's UNREADABLE marker is
      // now a BuiltGraph field, not just a hash line.
      expect(built.typescriptConfigProblems).toEqual([
        { file: "tsconfig.json", status: "UNREADABLE" },
      ]);
      // The alias import is UNKNOWN (CONFIG_UNREADABLE), never
      // external: the edge is missing-with-cause, not vanished.
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
      // The config itself is an unknown too (fail-closed even with
      // no import using it — see the malformed-no-alias test below).
      expect(
        ts.unknowns.filter((u) => u.from === "tsconfig.json"),
      ).toEqual([
        expect.objectContaining({
          specifier: "",
          reason: "CONFIG_UNREADABLE",
        }),
      ]);
      expect(ts.tsconfigStatus).toBe("unreadable");
      expect(ts.packageJsonStatus).toBe("absent");
      // The evidence the comparator sees carries the same unknown.
      expect(
        (evidence.unknownImports ?? []).filter(
          (u) => u.reason === "CONFIG_UNREADABLE",
        ).length,
      ).toBeGreaterThanOrEqual(1);
      // The snapshot is still markered (it differs from the clean
      // hash), and the map binds to the markered hash.
      failState.files.clear();
      expect(prodSnapshot(repo)).not.toBe(snapshot);
    } finally {
      failState.files.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("unreadable package.json: self-reference import is UNKNOWN, INCOMPLETE", async () => {
    const repo = mkRepo(SELF_REF_REPO);
    const pkgAbs = join(repo, "package.json");
    failState.files.add(pkgAbs);
    try {
      expect(loadPackageJson(repo)).toEqual({ status: "unreadable" });
      expect(loadTsConfig(repo)).toEqual({ status: "absent" });

      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "src/main.ts", kind: "module" },
          { id: "m2", path: "src/index.ts", kind: "module" },
        ],
        [],
      );
      const { built, report } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      expect(report.snapshotStatus).toBe("MATCH");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0package.json\0",
      ]);
      expect(built.typescriptConfigProblems).toEqual([
        { file: "package.json", status: "UNREADABLE" },
      ]);
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.externalImportCount).toBe(0);
      expect(
        ts.unknowns.filter((u) => u.specifier === "@acme/pkg"),
      ).toEqual([
        expect.objectContaining({
          from: "src/main.ts",
          specifier: "@acme/pkg",
          reason: "CONFIG_UNREADABLE",
        }),
      ]);
      expect(ts.packageJsonStatus).toBe("unreadable");
      failState.files.clear();
      expect(prodSnapshot(repo)).not.toBe(snapshot);
    } finally {
      failState.files.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("malformed tsconfig: INCOMPLETE + SOURCE_NOT_ENUMERATED, alias UNKNOWN", async () => {
    // No injection needed: a malformed file is unreadable-as-config
    // on every machine, root or not.
    const repo = mkRepo({
      "tsconfig.json": "{ this is not json, paths: [broken\n",
      "src/main.ts": 'import { x } from "@acme/internal";\nconsole.log(x);\n',
      "src/internal.ts": "export const x = 1;\n",
    });
    try {
      expect(loadTsConfig(repo)).toEqual({ status: "malformed" });
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "src/main.ts", kind: "module" },
          { id: "m2", path: "src/internal.ts", kind: "module" },
        ],
        [],
      );
      const { built, report } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      expect(report.snapshotStatus).toBe("MATCH");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0tsconfig.json\0",
      ]);
      expect(built.typescriptConfigProblems).toEqual([
        { file: "tsconfig.json", status: "MALFORMED" },
      ]);
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.externalImportCount).toBe(0);
      expect(
        ts.unknowns.filter((u) => u.specifier === "@acme/internal"),
      ).toEqual([
        expect.objectContaining({ reason: "CONFIG_UNREADABLE" }),
      ]);
      expect(ts.tsconfigStatus).toBe("malformed");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("malformed package.json: INCOMPLETE + SOURCE_NOT_ENUMERATED, self-ref UNKNOWN", async () => {
    const repo = mkRepo({
      "package.json": "{ name: broken json\n",
      "src/main.ts": 'import { y } from "@acme/pkg";\nconsole.log(y);\n',
      "src/index.ts": "export const y = 2;\n",
    });
    try {
      expect(loadPackageJson(repo)).toEqual({ status: "malformed" });
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "src/main.ts", kind: "module" },
          { id: "m2", path: "src/index.ts", kind: "module" },
        ],
        [],
      );
      const { built, report } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0package.json\0",
      ]);
      expect(built.typescriptConfigProblems).toEqual([
        { file: "package.json", status: "MALFORMED" },
      ]);
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.externalImportCount).toBe(0);
      expect(
        ts.unknowns.filter((u) => u.specifier === "@acme/pkg"),
      ).toEqual([
        expect.objectContaining({ reason: "CONFIG_UNREADABLE" }),
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("malformed tsconfig with NO alias import: still INCOMPLETE (fail-closed, config is necessary)", async () => {
    // The config is a promised resolution input: whether any import
    // happens to use it is unknowable while it is unparseable, so
    // its unreadability alone must block PASS — the audit must not
    // wait for an alias import to appear.
    const repo = mkRepo({
      "tsconfig.json": "{ broken\n",
      "src/main.ts": 'import "./util";\nconsole.log(1);\n',
      "src/util.ts": "export const x = 1;\n",
    });
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "src/main.ts", kind: "module" },
          { id: "m2", path: "src/util.ts", kind: "module" },
        ],
        [{ from: "src/main.ts", to: "src/util.ts" }],
      );
      const { report } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0tsconfig.json\0",
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("both configs unreadable: two findings, INCOMPLETE", async () => {
    const repo = mkRepo({
      ...ALIAS_REPO,
      "package.json":
        '{\n  "name": "@acme/pkg",\n  "exports": { ".": "./src/internal.ts" }\n}\n',
    });
    failState.files.add(join(repo, "tsconfig.json"));
    failState.files.add(join(repo, "package.json"));
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "src/main.ts", kind: "module" },
          { id: "m2", path: "src/internal.ts", kind: "module" },
        ],
        [],
      );
      const { built, report } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0package.json\0",
        "SOURCE_NOT_ENUMERATED\0tsconfig.json\0",
      ]);
      expect(built.typescriptConfigProblems).toEqual([
        { file: "package.json", status: "UNREADABLE" },
        { file: "tsconfig.json", status: "UNREADABLE" },
      ]);
    } finally {
      failState.files.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("readable tsconfig: alias resolves, PASS (control)", async () => {
    const repo = mkRepo(ALIAS_REPO);
    try {
      expect(loadTsConfig(repo).status).toBe("ok");
      expect(loadTsConfig(repo).config?.paths).toEqual({
        "@acme/*": ["src/*"],
      });
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "src/main.ts", kind: "module" },
          { id: "m2", path: "src/internal.ts", kind: "module" },
        ],
        [{ from: "src/main.ts", to: "src/internal.ts" }],
      );
      const { built, report } = await runProduction(repo, map);
      expect(built.typescriptConfigProblems).toBeUndefined();
      expect(report.status).toBe("PASS");
      expect(report.findings).toEqual([]);
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.externalImportCount).toBe(0);
      expect(ts.edges).toHaveLength(1);
      expect(ts.tsconfigStatus).toBe("ok");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("readable package.json: self-reference resolves, PASS (control)", async () => {
    const repo = mkRepo(SELF_REF_REPO);
    try {
      expect(loadPackageJson(repo).status).toBe("ok");
      expect(loadPackageJson(repo).packageJson?.name).toBe("@acme/pkg");
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "src/main.ts", kind: "module" },
          { id: "m2", path: "src/index.ts", kind: "module" },
        ],
        [{ from: "src/main.ts", to: "src/index.ts" }],
      );
      const { built, report } = await runProduction(repo, map);
      expect(built.typescriptConfigProblems).toBeUndefined();
      expect(report.status).toBe("PASS");
      expect(report.findings).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("no config files at all: absent is not a problem, PASS (control)", async () => {
    const repo = mkRepo({
      "src/main.ts": 'import "./util";\n',
      "src/util.ts": "export const x = 1;\n",
    });
    try {
      expect(loadTsConfig(repo)).toEqual({ status: "absent" });
      expect(loadPackageJson(repo)).toEqual({ status: "absent" });
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "src/main.ts", kind: "module" },
          { id: "m2", path: "src/util.ts", kind: "module" },
        ],
        [{ from: "src/main.ts", to: "src/util.ts" }],
      );
      const { built, report } = await runProduction(repo, map);
      expect(built.typescriptConfigProblems).toBeUndefined();
      expect(report.status).toBe("PASS");
      expect(report.findings).toEqual([]);
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.tsconfigStatus).toBe("absent");
      expect(ts.packageJsonStatus).toBe("absent");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("no config files: bare third-party import is still external, PASS (control)", async () => {
    // Absence must keep the old behaviour exactly: a plausible bare
    // package name with no config to give it another meaning is
    // external, not UNKNOWN.
    const repo = mkRepo({
      "src/main.ts": 'import "react";\nimport "./util";\n',
      "src/util.ts": "export const x = 1;\n",
    });
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "src/main.ts", kind: "module" },
          { id: "m2", path: "src/util.ts", kind: "module" },
        ],
        [{ from: "src/main.ts", to: "src/util.ts" }],
      );
      const { built, report } = await runProduction(repo, map);
      expect(built.typescriptConfigProblems).toBeUndefined();
      expect(report.status).toBe("PASS");
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.externalImportCount).toBe(1);
      expect(ts.unknowns).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

/**
 * REAL permission check: chmod 000 + the built CLI run as `nobody`.
 * No mocks here — the EACCES is produced by the filesystem, for a
 * real non-root user, exactly like GPT's R2 repro.
 */
describe("FIX P024 R2 P1-01: real chmod 000 + CLI as nobody (no mocks)", () => {
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
    nobodyDir = mkdtempSync(join(REAL_TMP, "r2-p1-01-nobody-"));
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
    const root = mkdtempSync(join(REAL_TMP, "r2-p1-01-repo-"));
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

  /** Snapshot of a repo as seen by `nobody` (production code, real EACCES). */
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
    // The hash of the snapshot proves the CLI really saw the
    // UNREADABLE marker (a root-computed clean hash would not match).
    return { code: r.status, stdout: r.stdout ?? "", report };
  }

  test.skipIf(!NOBODY_OK)(
    "chmod 000 tsconfig, CLI as nobody: exit 2, INCOMPLETE, SOURCE_NOT_ENUMERATED",
    () => {
      const repo = mkNobodyRepo(ALIAS_REPO);
      chmodSync(join(repo, "tsconfig.json"), 0o000);
      try {
        const snapshot = snapshotAsNobody(repo);
        // Sanity: the nobody snapshot is the MARKERED hash, not the
        // clean hash a root read would produce.
        failState.files.clear();
        expect(prodSnapshot(repo)).not.toBe(snapshot);
        const map = claimedMap(
          snapshot,
          [
            { id: "m1", path: "src/main.ts", kind: "module" },
            { id: "m2", path: "src/internal.ts", kind: "module" },
          ],
          [],
        );
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
    "chmod 000 tsconfig, CLI as nobody, readable control: exit 0, PASS",
    () => {
      const repo = mkNobodyRepo(ALIAS_REPO);
      const snapshot = snapshotAsNobody(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "src/main.ts", kind: "module" },
          { id: "m2", path: "src/internal.ts", kind: "module" },
        ],
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
