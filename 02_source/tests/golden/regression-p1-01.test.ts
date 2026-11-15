/**
 * FIX P024 R1 P1-01 regression: unreadable files and directories must
 * never be silently skipped (PROJECT_BOOK §5.1 "跳过项转 finding":
 * source files that exist but cannot be read, and directories that
 * cannot be listed, become SOURCE_NOT_ENUMERATED / INCOMPLETE — never
 * a quiet PASS, and never a false HALLUCINATED_* blaming the agent
 * for the auditor's own inability to read the tree).
 *
 * Failure injection — READ THIS FIRST:
 *
 * The suite runs as root, and root BYPASSES permission bits: a file
 * chmod 000 is still readable to root, so a real chmod fixture would
 * silently pass here and only fail on a non-root machine. The tests
 * therefore inject EACCES instead of relying on the filesystem:
 *
 * - Production (in-process): `vi.mock("node:fs")` wraps readFileSync
 *   / readdirSync so exactly the listed absolute paths throw EACCES
 *   (code "EACCES"). Every other fs call passes through untouched,
 *   including existsSync/statSync/lstatSync/realpathSync — which is
 *   exactly real behaviour: on a chmod-000 file in a readable
 *   directory, stat/lstat/realpath still succeed; only the read
 *   fails. On a chmod-000 directory, only the listing fails.
 * - Oracle (subprocess): a small driver script patches builtins.open
 *   and os.scandir to raise PermissionError for the same absolute
 *   paths before running oracle.py. os.walk honours the patched
 *   scandir through its onerror handler, mirroring the production
 *   scan. The driver is written to TMPDIR at runtime; it is not a
 *   committed fixture.
 *
 * A REAL permission check (chmod 000 + run as user `nobody`) is NOT
 * part of this suite — it cannot run inside vitest as root — but it
 * was done by hand as end-to-end verification (see the P1-01
 * handoff): the CLI run as `nobody` returns exit 2 INCOMPLETE with
 * SOURCE_NOT_ENUMERATED, and its snapshot equals the mocked one.
 *
 * Each case runs BOTH implementations on the same repo and asserts
 * the two verdicts agree (INCOMPLETE, except the _test.go case which
 * is PASS by design) and the production findings name the unreadable
 * path. The Oracle audit deliberately does NOT emit a
 * SOURCE_NOT_ENUMERATED finding of its own — it forces INCOMPLETE
 * through the non-OK parseStatus / UNREADABLE unknown, exactly like
 * the S0 gate mirror (scripts/s0-gate.mjs auditFromGT) — so the
 * oracle side asserts status INCOMPLETE and an UNREADABLE module /
 * unknown in its ground truth, not a finding. The production
 * comparator is the one that emits the §5.1 finding.
 *
 * Counterexample discipline: every case below is a false-PASS on the
 * old code — the old extractors skipped the unreadable path and the
 * audit returned PASS (verified by running this file against the
 * pre-fix tree with `git stash push -- 02_source/src
 * 02_source/oracle`; see the P1-01 handoff for the output).
 *
 * This suite does NOT touch the S0 gate: no fixtures under
 * tests/fixtures/s0/, no golden.json changes. Repos are built in
 * TMPDIR per test and removed afterwards.
 */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { parseClaimedMapJson } from "../../src/io/validate-claimed-map.js";
import { buildGroundTruthGraphFromRepo } from "../../src/graph/fromRepo.js";
import { computeRepoSnapshotSha256 as prodSnapshot } from "../../src/graph/fromRepo.js";
import { extractPythonRepo } from "../../src/extractors/python/index.js";
import { collectEvidence } from "../../src/cli/evidence.js";
import { compareMapsDetailed } from "../../src/comparator/compare.js";

/**
 * Paths that must fail. Root bypasses permission bits, so EACCES is
 * injected: readFileSync throws for `files`, readdirSync throws for
 * `dirs`. See the header note — this is the whole point of the mock.
 */
const failState = vi.hoisted(() => ({
  files: new Set<string>(),
  dirs: new Set<string>(),
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
    readdirSync: function (this: unknown, ...args: unknown[]) {
      const p = args[0];
      if (typeof p === "string" && failState.dirs.has(p)) throw denied();
      return (actual.readdirSync as (...a: unknown[]) => unknown).apply(
        this,
        args,
      );
    },
  };
});

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SRC_ROOT = join(HERE, "..", "..");
const ORACLE_PY = join(SRC_ROOT, "oracle", "python", "oracle.py");

/** Oracle driver: patches open/scandir to raise PermissionError for
 * the injected paths, then runs oracle.py as __main__. Written to
 * TMPDIR at runtime (see the header note). */
const ORACLE_DRIVER = `
import builtins, json, os, runpy, sys
_oracle_dir = os.environ["P101_ORACLE_DIR"]
_fixture = os.environ["P101_FIXTURE"]
_out = os.environ["P101_OUT"]
_fail_files = set(json.loads(os.environ.get("P101_FAIL_FILES", "[]")))
_fail_dirs = set(json.loads(os.environ.get("P101_FAIL_DIRS", "[]")))
_real_open = builtins.open
def _open(path, *args, **kwargs):
    try:
        s = os.fspath(path)
    except TypeError:
        s = None
    if isinstance(s, str) and os.path.abspath(s) in _fail_files:
        raise PermissionError(13, "Permission denied", s)
    return _real_open(path, *args, **kwargs)
builtins.open = _open
_real_scandir = os.scandir
def _scandir(path="."):
    try:
        s = os.fspath(path)
    except TypeError:
        s = None
    if isinstance(s, str) and os.path.abspath(s) in _fail_dirs:
        raise PermissionError(13, "Permission denied", s)
    return _real_scandir(path)
os.scandir = _scandir
sys.argv = ["oracle.py", "--fixture-dir", _fixture, "--out", _out]
runpy.run_path(os.path.join(_oracle_dir, "oracle.py"), run_name="__main__")
`;

let driverPath = "";

beforeAll(() => {
  driverPath = join(
    mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "regression-p1-01-")),
    "oracle-driver.py",
  );
  writeFileSync(driverPath, ORACLE_DRIVER, "utf8");
});

afterEach(() => {
  failState.files.clear();
  failState.dirs.clear();
  for (const d of tmpDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

/** Temp dirs created by this file (repos + fixtures), removed after each test. */
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
    join(process.env.TMPDIR ?? tmpdir(), "regression-p1-01-"),
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
    mapId: "p1-01-regression",
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

/** Run the Oracle via the patching driver on a fixture dir. */
function runOracle(
  fixtureDir: string,
  failFiles: string[],
  failDirs: string[],
): Record<string, any> {
  const tmpOut = mkdtempSync(
    join(process.env.TMPDIR ?? tmpdir(), "regression-p1-01-"),
  );
  try {
    const outFile = join(tmpOut, "oracle.json");
    const r = spawnSync(
      "python3",
      [driverPath],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          P101_ORACLE_DIR: join(SRC_ROOT, "oracle", "python"),
          P101_FIXTURE: fixtureDir,
          P101_OUT: outFile,
          P101_FAIL_FILES: JSON.stringify(failFiles),
          P101_FAIL_DIRS: JSON.stringify(failDirs),
        },
      },
    );
    expect(
      r.status,
      `oracle driver failed: status=${r.status} stderr=${r.stderr ?? ""}`,
    ).toBe(0);
    return JSON.parse(readFileSync(outFile, "utf8")) as Record<string, any>;
  } finally {
    rmSync(tmpOut, { recursive: true, force: true });
  }
}

/**
 * Copy a built repo into a fresh fixture dir (repo/ + claimed-map.json)
 * for the Oracle CLI. The copy is byte-identical, so the mocked
 * production snapshot and the driver-patched Oracle snapshot agree.
 */
function copyRepoToFixture(
  repo: string,
  rels: string[],
  map: Record<string, unknown>,
  name: string,
): { fixture: string; repo: string } {
  // The fixture dir basename must start with the language prefix
  // (py-/ts-/go-): the Oracle CLI infers the language from it.
  const fixture = mkdtempSync(
    join(process.env.TMPDIR ?? tmpdir(), `${name}-`),
  );
  tmpDirs.push(fixture);
  const fixtureRepo = join(fixture, "repo");
  mkdirSync(fixtureRepo, { recursive: true });
  writeFileSync(
    join(fixture, "claimed-map.json"),
    JSON.stringify(map),
    "utf8",
  );
  for (const rel of rels) {
    const dst = join(fixtureRepo, rel);
    mkdirSync(join(dst, ".."), { recursive: true });
    writeFileSync(dst, readFileSync(join(repo, rel), "utf8"), "utf8");
  }
  return { fixture, repo: fixtureRepo };
}

function findingKeys(
  findings: { id: string; from?: string; to?: string }[],
): string[] {
  return findings
    .map((f) => `${f.id}\0${f.from ?? ""}\0${f.to ?? ""}`)
    .sort();
}

describe("FIX P024 R1 P1-01: unreadable files and directories", () => {
  test("python unreadable file: INCOMPLETE + SOURCE_NOT_ENUMERATED, both sides", async () => {
    const repo = mkRepo({
      "main.py": "import private.payment\n",
      "private/__init__.py": "",
      "private/payment.py": "import os\n",
      ".repomapverify.toml": '[entrypoints]\npaths = ["main.py"]\n',
    });
    const unreadable = join(repo, "private", "payment.py");
    failState.files.add(unreadable);
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "main.py", kind: "module" },
          { id: "m2", path: "private/__init__.py", kind: "module" },
          { id: "m3", path: "private/payment.py", kind: "module" },
        ],
        [{ from: "main.py", to: "private/payment.py" }],
        ["main.py"],
      );
      const { report, evidence } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0private/payment.py\0",
      ]);
      // The unreadable module is IN the ground truth (not dropped).
      const py = await extractPythonRepo(repo);
      const mod = py.modules.find(
        (m) => m.relativePath === "private/payment.py",
      );
      expect(mod?.parseStatus).toBe("UNREADABLE");
      expect(mod?.contentSha256).toBe("");
      // The Python extractor snapshot agrees with the graph snapshot.
      expect(py.repoSnapshotSha256).toBe(snapshot);
      // The unreadable file did not silently drop from the snapshot:
      // the markered hash differs from the clean-tree hash.
      failState.files.clear();
      expect(prodSnapshot(repo)).not.toBe(snapshot);

      // Oracle side (patched open raises PermissionError).
      const { fixture, repo: fixtureRepo } = copyRepoToFixture(
        repo,
        [
          "main.py",
          "private/__init__.py",
          "private/payment.py",
          ".repomapverify.toml",
        ],
        map,
        "py-unreadable-file",
      );
      const oracle = runOracle(fixture, [join(fixtureRepo, "private", "payment.py")], []);
      expect(oracle.audit.status).toBe("INCOMPLETE");
      expect(oracle.audit.snapshotStatus).toBe("MATCH");
      expect(oracle.groundTruth.repoSnapshotSha256).toBe(snapshot);
      const oracleMod = (oracle.groundTruth.modules as any[]).find(
        (m) => m.relativePath === "private/payment.py",
      );
      expect(oracleMod?.parseStatus).toBe("UNREADABLE");
      expect(oracleMod?.contentSha256).toBe("");
      // The Oracle audit forces INCOMPLETE via the non-OK parse
      // status (it emits no SOURCE_NOT_ENUMERATED finding of its own;
      // see the header note).
      expect(oracle.audit.findings).toEqual([]);
    } finally {
      failState.files.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("python unreadable directory: INCOMPLETE + SOURCE_NOT_ENUMERATED, no false FAIL", async () => {
    const repo = mkRepo({
      "main.py": "import private.payment\n",
      "private/__init__.py": "",
      "private/payment.py": "import os\n",
      ".repomapverify.toml": '[entrypoints]\npaths = ["main.py"]\n',
    });
    failState.dirs.add(join(repo, "private"));
    try {
      const snapshot = prodSnapshot(repo);
      // The agent's map was built when the tree was readable: it
      // claims the modules behind the now-unreadable directory.
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "main.py", kind: "module" },
          { id: "m2", path: "private/__init__.py", kind: "module" },
          { id: "m3", path: "private/payment.py", kind: "module" },
        ],
        [{ from: "main.py", to: "private/payment.py" }],
        ["main.py"],
      );
      const { report, evidence } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      // Exactly one finding, naming the directory — and crucially NO
      // HALLUCINATED_MODULE / HALLUCINATED_EDGE for the modules the
      // auditor cannot see (they exist; the auditor is blind, the
      // agent is not wrong).
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0private\0",
      ]);
      expect(
        (evidence.unknownImports ?? []).filter(
          (u) => u.reason === "UNREADABLE",
        ).length,
        "one UNREADABLE unknown per extractor (python/typescript/go " +
          "each walk the tree; the comparator dedupes them to a single " +
          "finding)",
      ).toBe(3);
      expect(
        [
          ...new Set(
            (evidence.unknownImports ?? [])
              .filter((u) => u.reason === "UNREADABLE")
              .map((u) => `${u.from}\0${u.specifier}\0${u.reason}`),
          ),
        ],
      ).toEqual(["private\0\0UNREADABLE"]);
      // The Python entry carries the statement; TS/Go entries carry
      // none (their unknown shapes have no statement field).
      expect(
        (evidence.unknownImports ?? []).filter(
          (u) =>
            u.reason === "UNREADABLE" &&
            (u as { statement?: string }).statement !== undefined,
        ),
      ).toEqual([
        expect.objectContaining({
          from: "private",
          specifier: "",
          statement:
            'directory "private" could not be listed; its contents are unknown',
        }),
      ]);
    } finally {
      failState.dirs.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("typescript unreadable file: INCOMPLETE + SOURCE_NOT_ENUMERATED, both sides", async () => {
    const repo = mkRepo({
      "src/main.ts": 'import "./private/payment";\nimport "./util";\n',
      "src/util.ts": "export const x = 1;\n",
      "src/private/payment.ts": "export const y = 2;\n",
      ".repomapverify.toml": '[entrypoints]\npaths = ["src/main.ts"]\n',
    });
    const unreadable = join(repo, "src", "private", "payment.ts");
    failState.files.add(unreadable);
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "src/main.ts", kind: "module" },
          { id: "m2", path: "src/private/payment.ts", kind: "module" },
          { id: "m3", path: "src/util.ts", kind: "module" },
        ],
        [
          { from: "src/main.ts", to: "src/private/payment.ts" },
          { from: "src/main.ts", to: "src/util.ts" },
        ],
        ["src/main.ts"],
      );
      const { report } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0src/private/payment.ts\0",
      ]);
    } finally {
      failState.files.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("typescript unreadable directory: INCOMPLETE + SOURCE_NOT_ENUMERATED, no false FAIL", async () => {
    const repo = mkRepo({
      "src/main.ts": 'import "./private/payment";\n',
      "src/private/payment.ts": "export const y = 2;\n",
      ".repomapverify.toml": '[entrypoints]\npaths = ["src/main.ts"]\n',
    });
    failState.dirs.add(join(repo, "src", "private"));
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "src/main.ts", kind: "module" },
          { id: "m2", path: "src/private/payment.ts", kind: "module" },
        ],
        [{ from: "src/main.ts", to: "src/private/payment.ts" }],
        ["src/main.ts"],
      );
      const { report } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0src/private\0",
      ]);
    } finally {
      failState.dirs.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("go unreadable file: INCOMPLETE + package and file findings, both sides", async () => {
    const repo = mkRepo({
      "go.mod": "module example.com/repo\n\ngo 1.24\n",
      "cmd/server/main.go":
        'package main\n\nimport "example.com/repo/internal/app"\n\nfunc main() { _ = app.Name }\n',
      "internal/app/app.go":
        'package app\n\nimport "example.com/repo/internal/util"\n\nconst Name = util.Name\n',
      "internal/app/secret.go":
        'package app\n\nimport "fmt"\n\nvar _ = fmt.Sprint\n',
      "internal/util/util.go": "package util\n\nconst Name = \"util\"\n",
      ".repomapverify.toml":
        '[entrypoints]\npaths = ["cmd/server/main.go"]\n',
    });
    failState.files.add(join(repo, "internal", "app", "secret.go"));
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "cmd/server", kind: "package" },
          { id: "m2", path: "internal/app", kind: "package" },
          { id: "m3", path: "internal/util", kind: "package" },
        ],
        [
          { from: "cmd/server", to: "internal/app" },
          { from: "internal/app", to: "internal/util" },
        ],
        ["cmd/server/main.go"],
      );
      const { report, evidence } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      // Package-level finding (the package composition is incomplete)
      // plus the file-level finding (the package finding alone could
      // not name the unreadable file).
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0internal/app\0",
        "SOURCE_NOT_ENUMERATED\0internal/app/secret.go\0",
      ]);
      expect(
        (evidence.unknownImports ?? []).filter(
          (u) => u.reason === "UNREADABLE",
        ),
      ).toEqual([
        expect.objectContaining({
          from: "internal/app/secret.go",
          specifier: "",
        }),
      ]);
    } finally {
      failState.files.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("go unreadable directory: INCOMPLETE + SOURCE_NOT_ENUMERATED, no false FAIL", async () => {
    const repo = mkRepo({
      "go.mod": "module example.com/repo\n\ngo 1.24\n",
      "cmd/server/main.go":
        'package main\n\nimport "example.com/repo/internal/private"\n\nfunc main() { _ = private.Name }\n',
      "internal/private/priv.go":
        "package private\n\nconst Name = \"private\"\n",
      ".repomapverify.toml":
        '[entrypoints]\npaths = ["cmd/server/main.go"]\n',
    });
    failState.dirs.add(join(repo, "internal", "private"));
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "cmd/server", kind: "package" },
          { id: "m2", path: "internal/private", kind: "package" },
        ],
        [{ from: "cmd/server", to: "internal/private" }],
        ["cmd/server/main.go"],
      );
      const { report } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0internal/private\0",
      ]);
    } finally {
      failState.dirs.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("go package whose only file is unreadable: INCOMPLETE via the file finding alone", async () => {
    const repo = mkRepo({
      "go.mod": "module example.com/repo\n\ngo 1.24\n",
      "cmd/server/main.go":
        'package main\n\nimport "example.com/repo/internal/solo"\n\nfunc main() { _ = solo.Name }\n',
      "internal/solo/only.go":
        "package solo\n\nconst Name = \"solo\"\n",
      ".repomapverify.toml":
        '[entrypoints]\npaths = ["cmd/server/main.go"]\n',
    });
    failState.files.add(join(repo, "internal", "solo", "only.go"));
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "cmd/server", kind: "package" },
          { id: "m2", path: "internal/solo", kind: "package" },
        ],
        [{ from: "cmd/server", to: "internal/solo" }],
        ["cmd/server/main.go"],
      );
      const { report } = await runProduction(repo, map);
      expect(report.status).toBe("INCOMPLETE");
      // No package module exists at all (its only file is unreadable),
      // so the file-level UNREADABLE unknown is the only trace — and
      // the claimed package must NOT be reported as hallucinated: it
      // is hidden behind its unreadable file (parent-dir rule).
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0internal/solo/only.go\0",
      ]);
    } finally {
      failState.files.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("go unreadable _test.go: excluded by name, no finding, PASS", async () => {
    const repo = mkRepo({
      "go.mod": "module example.com/repo\n\ngo 1.24\n",
      "internal/app/app.go": "package app\n\nconst Name = \"app\"\n",
      "internal/app/app_test.go":
        'package app\n\nimport "testing"\n\nfunc TestX(t *testing.T) {}\n',
    });
    failState.files.add(join(repo, "internal", "app", "app_test.go"));
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [{ id: "m1", path: "internal/app", kind: "package" }],
        [],
      );
      const { report } = await runProduction(repo, map);
      // Test files are excluded from the build graph by NAME, so an
      // unreadable one loses nothing: no finding, PASS — but the
      // snapshot is still markered (it differs from the clean hash),
      // and the map binds to the markered hash, so this PASS is an
      // honest one over a fully enumerated graph.
      expect(report.status).toBe("PASS");
      expect(report.findings).toEqual([]);
      expect(report.snapshotStatus).toBe("MATCH");
      failState.files.clear();
      expect(prodSnapshot(repo)).not.toBe(snapshot);
    } finally {
      failState.files.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("scanRepoFilesDetailed records an unlistable directory", async () => {
    const { scanRepoFilesDetailed } = await import(
      "../../src/identity/symlinks.js"
    );
    const repo = mkRepo({
      "a.txt": "a\n",
      "private/b.txt": "b\n",
    });
    failState.dirs.add(join(repo, "private"));
    try {
      const { entries, unreadableDirs } = scanRepoFilesDetailed(repo);
      expect(unreadableDirs).toEqual(["private"]);
      // Everything else is still enumerated.
      expect(entries.map((e) => e.relativePath).sort()).toEqual([
        "a.txt",
        "private",
      ]);
    } finally {
      failState.dirs.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("oracle does not crash on an unreadable repo file (python, driver)", async () => {
    const repo = mkRepo({
      "main.py": "import private.payment\n",
      "private/__init__.py": "",
      "private/payment.py": "import os\n",
      ".repomapverify.toml": '[entrypoints]\npaths = ["main.py"]\n',
    });
    failState.files.add(join(repo, "private", "payment.py"));
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "main.py", kind: "module" },
          { id: "m2", path: "private/__init__.py", kind: "module" },
          { id: "m3", path: "private/payment.py", kind: "module" },
        ],
        [{ from: "main.py", to: "private/payment.py" }],
        ["main.py"],
      );
      // Clear the injection before copying: the copy is a test-harness
      // file operation, not part of the audited scan. The clean-tree
      // snapshot (no marker) differs from the markered one by design.
      failState.files.clear();
      const cleanSnapshot = prodSnapshot(repo);
      expect(cleanSnapshot).not.toBe(snapshot);
      // The clean Oracle run needs a map bound to the CLEAN snapshot
      // (the markered map would read STALE_SNAPSHOT against it);
      // the injected run needs the markered map.
      const mapClean = claimedMap(
        cleanSnapshot,
        [
          { id: "m1", path: "main.py", kind: "module" },
          { id: "m2", path: "private/__init__.py", kind: "module" },
          { id: "m3", path: "private/payment.py", kind: "module" },
        ],
        [{ from: "main.py", to: "private/payment.py" }],
        ["main.py"],
      );
      const { fixture, repo: fixtureRepo } = copyRepoToFixture(
        repo,
        [
          "main.py",
          "private/__init__.py",
          "private/payment.py",
          ".repomapverify.toml",
        ],
        mapClean,
        "py-oracle-no-crash",
      );
      // No failures injected into the driver: with a readable tree
      // and a matching snapshot the Oracle PASSES. This pins that the
      // driver itself does not perturb the Oracle. Its snapshot is
      // the CLEAN hash (no marker), since nothing is unreadable here.
      const clean = runOracle(fixture, [], []);
      expect(clean.audit.status).toBe("PASS");
      expect(clean.groundTruth.repoSnapshotSha256).toBe(cleanSnapshot);
      // Now inject the unreadable file: the Oracle must exit 0 and
      // report INCOMPLETE (not crash with PermissionError). The map
      // is re-bound to the markered snapshot first.
      writeFileSync(
        join(fixture, "claimed-map.json"),
        JSON.stringify(map),
        "utf8",
      );
      const oracle = runOracle(
        fixture,
        [join(fixtureRepo, "private", "payment.py")],
        [],
      );
      expect(oracle.audit.status).toBe("INCOMPLETE");
      expect(oracle.groundTruth.repoSnapshotSha256).toBe(snapshot);
    } finally {
      failState.files.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("FIX P024 R1 P1-01: oracle unreadable-directory parity (driver)", () => {
  test("oracle records an unlistable directory and stays INCOMPLETE, not a crash", async () => {
    const repo = mkRepo({
      "main.py": "import private.payment\n",
      "private/__init__.py": "",
      "private/payment.py": "import os\n",
      ".repomapverify.toml": '[entrypoints]\npaths = ["main.py"]\n',
    });
    failState.dirs.add(join(repo, "private"));
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "main.py", kind: "module" },
          { id: "m2", path: "private/__init__.py", kind: "module" },
          { id: "m3", path: "private/payment.py", kind: "module" },
        ],
        [{ from: "main.py", to: "private/payment.py" }],
        ["main.py"],
      );
      const { fixture, repo: fixtureRepo } = copyRepoToFixture(
        repo,
        [
          "main.py",
          "private/__init__.py",
          "private/payment.py",
          ".repomapverify.toml",
        ],
        map,
        "py-oracle-unreadable-dir",
      );
      const oracle = runOracle(
        fixture,
        [],
        [join(fixtureRepo, "private")],
      );
      expect(oracle.audit.status).toBe("INCOMPLETE");
      expect(oracle.audit.snapshotStatus).toBe("MATCH");
      expect(oracle.groundTruth.repoSnapshotSha256).toBe(snapshot);
      // The Oracle ground truth carries the same UNREADABLE unknown
      // production emits (same from/specifier/reason/line/statement).
      expect(
        (oracle.groundTruth.unknownImports as any[]).filter(
          (u) => u.reason === "UNREADABLE",
        ),
      ).toEqual([
        {
          from: "private",
          specifier: "",
          reason: "UNREADABLE",
          line: 1,
          statement:
            'directory "private" could not be listed; its contents are unknown',
        },
      ]);
      // ...and no false hallucination for the modules behind it.
      expect(oracle.audit.findings).toEqual([]);
    } finally {
      failState.dirs.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
