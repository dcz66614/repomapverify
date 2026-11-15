/**
 * FIX P024 R3 P1-02 regression: field-level malformed config must be
 * MALFORMED, never silently accepted as OK.
 *
 * The gap (GPT R3 verdict, verified by the main chat): the R2 fix
 * distinguished unreadable / malformed JSON at the whole-file level,
 * but field-level structure was not validated.
 *
 * A. tsconfig `paths` (resolve.ts loadTsConfig): `typeof
 *    opts.paths === "object" && opts.paths !== null` is false for a
 *    string, so `paths: "not-an-object"` was ignored and the config
 *    stayed status ok with paths {}; non-array targets were silently
 *    skipped by the Array.isArray filter, and non-string elements
 *    were silently dropped. An alias import then resolved `external`
 *    while the Oracle (which checks paths is a dict) said MALFORMED.
 * B. package.json `name` (resolve.ts loadPackageJson): `name:
 *    typeof raw.name === "string" ? raw.name : undefined` silently
 *    converted an explicitly present but invalid name (null, 123,
 *    "") into "absent", so self-reference membership was unknowable
 *    while the config still read ok.
 *
 * The fix (agreed convention, shared with the Oracle side):
 * - `paths` present but not a plain object (null, string, number,
 *   array) -> MALFORMED; a paths value that is not an array ->
 *   MALFORMED; an array element that is not a string -> MALFORMED.
 *   Absent -> normal (paths={}); empty object -> ok. baseUrl /
 *   moduleResolution keep their current lenient handling; `exports`
 *   is out of scope for this fix.
 * - `"name" in raw` and name is not a non-empty string -> MALFORMED.
 *   Absent -> normal (undefined). An empty string is MALFORMED, not
 *   a legal package name.
 *
 * A MALFORMED config flows through the existing R2 chain unchanged:
 * the loader status drives BuiltGraph.typescriptConfigProblems, the
 * comparator emits SOURCE_NOT_ENUMERATED, the config-level unknown
 * forces INCOMPLETE, and resolveSpecifier step 4 returns
 * CONFIG_UNREADABLE for any bare specifier that cannot be ruled out
 * as config-driven — so the import unknown reason below is
 * CONFIG_UNREADABLE, not ALIAS_NOT_RESOLVED.
 *
 * Counterexample discipline: every malformed case below is a false
 * PASS on the pre-fix code — verified by running this file against
 * the pre-fix tree (see the R3-P1-02 prod handoff for the output).
 *
 * This suite does NOT touch the S0 gate: no fixtures under
 * tests/fixtures/s0/ are modified, no golden.json changes. Repos are
 * built in TMPDIR per test and removed afterwards. The last test
 * scans the S0 fixtures read-only to guard the new strict rule
 * against existing fixture content.
 */
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
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

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SRC_ROOT = join(HERE, "..", "..");

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
    join(process.env.TMPDIR ?? tmpdir(), "regression-r3-p1-02-"),
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
    mapId: "r3-p1-02-regression",
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

/** tsconfig paths alias repo: the alias import is the tripwire. */
const ALIAS_REPO_BASE: Record<string, string> = {
  "src/main.ts": 'import { x } from "@acme/internal";\nconsole.log(x);\n',
  "src/internal.ts": "export const x = 1;\n",
};

const ALIAS_MODULES: ClaimModule[] = [
  { id: "m1", path: "src/main.ts", kind: "module" },
  { id: "m2", path: "src/internal.ts", kind: "module" },
];

/** Package self-reference repo: the self-ref import is the tripwire. */
const SELF_REF_BASE: Record<string, string> = {
  "src/main.ts": 'import { y } from "@acme/pkg";\nconsole.log(y);\n',
  "src/index.ts": "export const y = 2;\n",
};

const SELF_REF_MODULES: ClaimModule[] = [
  { id: "m1", path: "src/main.ts", kind: "module" },
  { id: "m2", path: "src/index.ts", kind: "module" },
];

describe("FIX P024 R3 P1-02A: tsconfig paths field-level validation", () => {
  const malformedPathsCases: { label: string; pathsJson: string }[] = [
    { label: 'paths is a string "not-an-object" (GPT repro)', pathsJson: '"not-an-object"' },
    { label: "paths is null", pathsJson: "null" },
    { label: "paths is a number", pathsJson: "42" },
    { label: "paths is an array", pathsJson: '["src/*"]' },
    { label: "paths value is a string, not an array", pathsJson: '{"@acme/*": "src/*"}' },
    { label: "paths value is null, not an array", pathsJson: '{"@acme/*": null}' },
    { label: "paths array element is a number", pathsJson: '{"@acme/*": ["src/*", 123]}' },
    { label: "paths array element is null", pathsJson: '{"@acme/*": [null]}' },
  ];

  for (const { label, pathsJson } of malformedPathsCases) {
    test(`${label}: MALFORMED + INCOMPLETE + SOURCE_NOT_ENUMERATED, never PASS`, async () => {
      const repo = mkRepo({
        ...ALIAS_REPO_BASE,
        "tsconfig.json":
          `{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": ${pathsJson}\n  }\n}\n`,
      });
      try {
        expect(loadTsConfig(repo)).toEqual({ status: "malformed" });

        const snapshot = prodSnapshot(repo);
        // The agent's map mirrors the degraded resolution: both
        // modules claimed, the alias edge omitted. On the old code
        // this audited PASS (paths ignored, alias -> external).
        const map = claimedMap(snapshot, ALIAS_MODULES, []);
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
  }

  test("paths absent: ok, alias falls back to baseUrl/external as before (control)", async () => {
    const repo = mkRepo({
      ...ALIAS_REPO_BASE,
      "tsconfig.json": '{\n  "compilerOptions": { "baseUrl": "." }\n}\n',
    });
    try {
      const loaded = loadTsConfig(repo);
      expect(loaded.status).toBe("ok");
      expect(loaded.config?.paths).toEqual({});
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(snapshot, ALIAS_MODULES, []);
      const { built, report } = await runProduction(repo, map);
      // No config problem: the alias is a plausible bare package name
      // with no config to give it another meaning -> external, PASS.
      expect(built.typescriptConfigProblems).toBeUndefined();
      expect(report.status).toBe("PASS");
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.externalImportCount).toBe(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("paths empty object: ok, alias resolves via baseUrl fallback (control)", async () => {
    // baseUrl "." + specifier "src/internal" resolves; @acme/internal
    // does not match any pattern, so it stays external — the point is
    // the config itself is valid, not the alias outcome.
    const repo = mkRepo({
      ...ALIAS_REPO_BASE,
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": {}\n  }\n}\n',
    });
    try {
      const loaded = loadTsConfig(repo);
      expect(loaded.status).toBe("ok");
      expect(loaded.config?.paths).toEqual({});
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(snapshot, ALIAS_MODULES, []);
      const { built, report } = await runProduction(repo, map);
      expect(built.typescriptConfigProblems).toBeUndefined();
      expect(report.status).toBe("PASS");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("paths valid: ok, alias resolves, PASS (control)", async () => {
    const repo = mkRepo({
      ...ALIAS_REPO_BASE,
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": { "@acme/*": ["src/*"] }\n  }\n}\n',
    });
    try {
      const loaded = loadTsConfig(repo);
      expect(loaded.status).toBe("ok");
      expect(loaded.config?.paths).toEqual({ "@acme/*": ["src/*"] });
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(snapshot, ALIAS_MODULES, [
        { from: "src/main.ts", to: "src/internal.ts" },
      ]);
      const { report } = await runProduction(repo, map);
      expect(report.status).toBe("PASS");
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.edges).toHaveLength(1);
      expect(ts.unknowns).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("FIX P024 R3 P1-02B: package.json name field-level validation", () => {
  const malformedNameCases: { label: string; nameJson: string }[] = [
    { label: "name is null (GPT repro)", nameJson: "null" },
    { label: "name is a number", nameJson: "123" },
    { label: "name is an empty string", nameJson: '""' },
    { label: "name is an object", nameJson: '{"scope": "@acme"}' },
    { label: "name is an array", nameJson: '["@acme/pkg"]' },
  ];

  for (const { label, nameJson } of malformedNameCases) {
    test(`${label}: MALFORMED + INCOMPLETE + SOURCE_NOT_ENUMERATED, never PASS`, async () => {
      const repo = mkRepo({
        ...SELF_REF_BASE,
        "package.json":
          `{\n  "name": ${nameJson},\n  "exports": { ".": "./src/index.ts" }\n}\n`,
      });
      try {
        expect(loadPackageJson(repo)).toEqual({ status: "malformed" });

        const snapshot = prodSnapshot(repo);
        // The agent's map mirrors the degraded resolution: both
        // modules claimed, the self-ref edge omitted. On the old code
        // this audited PASS (name silently dropped, @acme/pkg counted
        // external on both sides).
        const map = claimedMap(snapshot, SELF_REF_MODULES, []);
        const { built, evidence, report } = await runProduction(repo, map);
        expect(report.status).toBe("INCOMPLETE");
        expect(report.status).not.toBe("PASS");
        expect(report.snapshotStatus).toBe("MATCH");
        expect(findingKeys(report.findings)).toEqual([
          "SOURCE_NOT_ENUMERATED\0package.json\0",
        ]);
        expect(built.typescriptConfigProblems).toEqual([
          { file: "package.json", status: "MALFORMED" },
        ]);
        // The self-ref import is UNKNOWN (CONFIG_UNREADABLE via step
        // 4), never external.
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
        expect(
          (evidence.unknownImports ?? []).filter(
            (u) => u.reason === "CONFIG_UNREADABLE",
          ).length,
        ).toBeGreaterThanOrEqual(1);
        expect(ts.packageJsonStatus).toBe("malformed");
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });
  }

  test("name absent: ok, self-ref import is external as before (control)", async () => {
    const repo = mkRepo({
      ...SELF_REF_BASE,
      "package.json": '{\n  "exports": { ".": "./src/index.ts" }\n}\n',
    });
    try {
      const loaded = loadPackageJson(repo);
      expect(loaded.status).toBe("ok");
      expect(loaded.packageJson?.name).toBeUndefined();
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(snapshot, SELF_REF_MODULES, []);
      const { built, report } = await runProduction(repo, map);
      expect(built.typescriptConfigProblems).toBeUndefined();
      expect(report.status).toBe("PASS");
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.externalImportCount).toBe(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("name valid: ok, self-reference resolves, PASS (control)", async () => {
    const repo = mkRepo({
      ...SELF_REF_BASE,
      "package.json":
        '{\n  "name": "@acme/pkg",\n  "exports": { ".": "./src/index.ts" }\n}\n',
    });
    try {
      const loaded = loadPackageJson(repo);
      expect(loaded.status).toBe("ok");
      expect(loaded.packageJson?.name).toBe("@acme/pkg");
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(snapshot, SELF_REF_MODULES, [
        { from: "src/main.ts", to: "src/index.ts" },
      ]);
      const { report } = await runProduction(repo, map);
      expect(report.status).toBe("PASS");
      const ts = await extractTypeScriptRepo(repo);
      expect(ts.edges).toHaveLength(1);
      expect(ts.unknowns).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("FIX P024 R3 P1-02: S0 fixtures carry no invalid name/paths (guard)", () => {
  test("every S0 package.json name is absent or a non-empty string; every tsconfig paths value is a string array", () => {
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
    const pkgFiles = files.filter((f) => f.endsWith("package.json"));
    const tsFiles = files.filter((f) => f.endsWith("tsconfig.json"));
    expect(pkgFiles.length).toBeGreaterThan(0);
    expect(tsFiles.length).toBeGreaterThan(0);
    for (const f of pkgFiles) {
      const raw = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
      if ("name" in raw) {
        expect(typeof raw.name, `${f}: name must be a string`).toBe("string");
        expect((raw.name as string).length, `${f}: name must be non-empty`).toBeGreaterThan(0);
      }
    }
    for (const f of tsFiles) {
      const raw = JSON.parse(readFileSync(f, "utf8")) as {
        compilerOptions?: Record<string, unknown>;
      };
      const paths = raw.compilerOptions?.paths;
      if (paths === undefined) continue;
      expect(typeof paths, `${f}: paths must be an object`).toBe("object");
      expect(paths, `${f}: paths must not be null or an array`).not.toBeNull();
      expect(Array.isArray(paths), `${f}: paths must not be an array`).toBe(false);
      for (const [k, v] of Object.entries(paths as Record<string, unknown>)) {
        expect(Array.isArray(v), `${f}: paths[${k}] must be an array`).toBe(true);
        for (const x of v as unknown[]) {
          expect(typeof x, `${f}: paths[${k}] elements must be strings`).toBe("string");
        }
      }
    }
  });
});
