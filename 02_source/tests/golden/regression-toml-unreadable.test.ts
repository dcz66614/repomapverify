/**
 * FIX P024 R1 P1-01 follow-up regression: an UNREADABLE
 * `.repomapverify.toml` must force INCOMPLETE, never a quiet PASS.
 *
 * The gap: `fromRepo` read the toml with a read-failure fallback to
 * "no declaration" (PROJECT_BOOK §5.1 fail-closed: unknown != pass).
 * A repo whose toml exists but cannot be read was therefore audited
 * as if it had declared NO entrypoints — no WRONG_ENTRYPOINT check,
 * ENTRYPOINT_CANDIDATE info findings only — and a fully claimed map
 * could PASS even though whether entrypoints are declared at all was
 * unknown. The snapshot did record the toml as UNREADABLE, so the
 * map's snapshot still MATCHed (both sides mark it the same way);
 * the snapshot alone could not distinguish "no declaration" from
 * "unknown declaration".
 *
 * The fix: the unreadability is recorded explicitly — production
 * `BuiltGraph.entrypointsDeclarationUnreadable` (fromRepo -> buildGraph
 * -> comparator: SOURCE_NOT_ENUMERATED finding for the toml file +
 * INCOMPLETE) and Oracle `gt["entrypointsDeclarationUnreadable"]`
 * (audit_claimed_map: INCOMPLETE, status only, no finding of its
 * own — the Oracle convention from the P1-01 suite). The S0 gate
 * mirror (scripts/s0-gate.mjs auditFromGT) reads the same flag.
 *
 * Failure injection — same discipline as regression-p1-01.test.ts:
 * the suite runs as root, and root BYPASSES permission bits, so a
 * chmod-000 toml would still be readable here. The tests therefore
 * inject EACCES / PermissionError for the toml path instead:
 *
 * - Production (in-process): `vi.mock("node:fs")` wraps readFileSync
 *   so exactly the toml path throws EACCES. Every other fs call
 *   passes through untouched.
 * - Oracle (subprocess): a small driver script patches builtins.open
 *   (and os.scandir, unused here) to raise PermissionError for the
 *   toml path before running oracle.py. The driver is written to
 *   TMPDIR at runtime; it is not a committed fixture.
 *
 * A REAL permission check (chmod 000 + run as user `nobody`) is NOT
 * part of this suite — it cannot run inside vitest as root — but it
 * was done by hand as end-to-end verification (see the handoff for
 * this fix): the CLI run as `nobody` returns exit 2 INCOMPLETE with
 * SOURCE_NOT_ENUMERATED naming `.repomapverify.toml`.
 *
 * Controls: a readable toml and a missing toml must behave EXACTLY
 * as before (PASS on a fully claimed map, no flag anywhere) — the
 * fix triggers ONLY when the file exists but cannot be read.
 *
 * Counterexample discipline: every unreadable-toml case below is a
 * false-PASS on the pre-fix code — verified by selectively disabling
 * just the two verdict-forcing lines (comparator
 * `hasUnreadableEntrypointsDeclaration` and the Oracle audit's
 * `toml_unreadable` condition) and re-running this file: all three
 * languages then return PASS on both sides (production
 * `expected 'PASS' to be 'INCOMPLETE'`; Oracle audit likewise PASS
 * with the ground-truth flag still True). Note the history: against
 * committed HEAD the old code did NOT pass — it crashed (fromRepo
 * read the toml with no try/catch, so the audit died with a usage
 * error). The silent "no declaration" fallback, and with it the
 * false-PASS path, was introduced by the P1-01 fix itself, which is
 * why this follow-up exists.
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
const ORACLE_PY = join(SRC_ROOT, "oracle", "python", "oracle.py");

/** Oracle driver: patches open/scandir to raise PermissionError for
 * the injected paths, then runs oracle.py as __main__. Written to
 * TMPDIR at runtime (see the header note). */
const ORACLE_DRIVER = `
import builtins, json, os, runpy, sys
_oracle_dir = os.environ["P102_ORACLE_DIR"]
_fixture = os.environ["P102_FIXTURE"]
_out = os.environ["P102_OUT"]
_fail_files = set(json.loads(os.environ.get("P102_FAIL_FILES", "[]")))
_fail_dirs = set(json.loads(os.environ.get("P102_FAIL_DIRS", "[]")))
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
    mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "regression-toml-")),
    "oracle-driver.py",
  );
  writeFileSync(driverPath, ORACLE_DRIVER, "utf8");
});

afterEach(() => {
  failState.files.clear();
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
    join(process.env.TMPDIR ?? tmpdir(), "regression-toml-"),
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
    mapId: "toml-unreadable-regression",
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
  failDirs: string[] = [],
): Record<string, any> {
  const tmpOut = mkdtempSync(
    join(process.env.TMPDIR ?? tmpdir(), "regression-toml-"),
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
          P102_ORACLE_DIR: join(SRC_ROOT, "oracle", "python"),
          P102_FIXTURE: fixtureDir,
          P102_OUT: outFile,
          P102_FAIL_FILES: JSON.stringify(failFiles),
          P102_FAIL_DIRS: JSON.stringify(failDirs),
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
 * Callers MUST clear failState before copying: the copy is a
 * test-harness file operation, not part of the audited scan.
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

describe("FIX P024 R1 P1-01 follow-up: unreadable .repomapverify.toml", () => {
  test("python unreadable toml: INCOMPLETE + SOURCE_NOT_ENUMERATED, both sides", async () => {
    const repo = mkRepo({
      "main.py": "import private.payment\n",
      "private/__init__.py": "",
      "private/payment.py": "import os\n",
      ".repomapverify.toml": '[entrypoints]\npaths = ["main.py"]\n',
    });
    const tomlAbs = join(repo, ".repomapverify.toml");
    failState.files.add(tomlAbs);
    try {
      const snapshot = prodSnapshot(repo);
      // The map is otherwise fully correct: every module, the one
      // edge, and the declared entrypoint are claimed. On the old
      // code this audited PASS ("no declaration"); the declaration
      // is in fact UNKNOWN.
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
      const { built, report } = await runProduction(repo, map);
      expect(built.entrypointsDeclarationUnreadable).toBe(true);
      expect(built.declaredEntrypointPaths).toEqual([]);
      expect(report.status).toBe("INCOMPLETE");
      expect(report.snapshotStatus).toBe("MATCH");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0.repomapverify.toml\0",
      ]);
      // The snapshot is still markered (it differs from the clean
      // hash), and the map binds to the markered hash.
      failState.files.clear();
      expect(prodSnapshot(repo)).not.toBe(snapshot);
      failState.files.add(tomlAbs);

      // Oracle side (patched open raises PermissionError).
      failState.files.clear();
      const { fixture, repo: fixtureRepo } = copyRepoToFixture(
        repo,
        [
          "main.py",
          "private/__init__.py",
          "private/payment.py",
          ".repomapverify.toml",
        ],
        map,
        "py-toml-unreadable",
      );
      const oracle = runOracle(fixture, [join(fixtureRepo, ".repomapverify.toml")]);
      expect(oracle.audit.status).toBe("INCOMPLETE");
      expect(oracle.audit.snapshotStatus).toBe("MATCH");
      expect(oracle.groundTruth.repoSnapshotSha256).toBe(snapshot);
      expect(oracle.groundTruth.entrypointsDeclarationUnreadable).toBe(true);
      expect(oracle.audit.entrypointsDeclarationUnreadable).toBe(true);
      // The Oracle audit forces INCOMPLETE via the ground-truth flag
      // (it emits no SOURCE_NOT_ENUMERATED finding of its own; see
      // the header note).
      expect(oracle.audit.findings).toEqual([]);
    } finally {
      failState.files.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("typescript unreadable toml: INCOMPLETE, both sides", async () => {
    const repo = mkRepo({
      "src/main.ts": 'import "./util";\n',
      "src/util.ts": "export const x = 1;\n",
      ".repomapverify.toml": '[entrypoints]\npaths = ["src/main.ts"]\n',
    });
    const tomlAbs = join(repo, ".repomapverify.toml");
    failState.files.add(tomlAbs);
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "src/main.ts", kind: "module" },
          { id: "m2", path: "src/util.ts", kind: "module" },
        ],
        [{ from: "src/main.ts", to: "src/util.ts" }],
        ["src/main.ts"],
      );
      const { built, report } = await runProduction(repo, map);
      expect(built.entrypointsDeclarationUnreadable).toBe(true);
      expect(report.status).toBe("INCOMPLETE");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0.repomapverify.toml\0",
      ]);

      failState.files.clear();
      const { fixture, repo: fixtureRepo } = copyRepoToFixture(
        repo,
        ["src/main.ts", "src/util.ts", ".repomapverify.toml"],
        map,
        "ts-toml-unreadable",
      );
      const oracle = runOracle(fixture, [join(fixtureRepo, ".repomapverify.toml")]);
      expect(oracle.audit.status).toBe("INCOMPLETE");
      expect(oracle.audit.snapshotStatus).toBe("MATCH");
      expect(oracle.groundTruth.repoSnapshotSha256).toBe(snapshot);
      expect(oracle.groundTruth.entrypointsDeclarationUnreadable).toBe(true);
      expect(oracle.audit.findings).toEqual([]);
    } finally {
      failState.files.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("go unreadable toml: INCOMPLETE, both sides", async () => {
    const repo = mkRepo({
      "go.mod": "module example.com/repo\n\ngo 1.24\n",
      "cmd/server/main.go":
        'package main\n\nimport "example.com/repo/internal/util"\n\nfunc main() { _ = util.Name }\n',
      "internal/util/util.go": "package util\n\nconst Name = \"util\"\n",
      ".repomapverify.toml":
        '[entrypoints]\npaths = ["cmd/server/main.go"]\n',
    });
    const tomlAbs = join(repo, ".repomapverify.toml");
    failState.files.add(tomlAbs);
    try {
      const snapshot = prodSnapshot(repo);
      const map = claimedMap(
        snapshot,
        [
          { id: "m1", path: "cmd/server", kind: "package" },
          { id: "m2", path: "internal/util", kind: "package" },
        ],
        [{ from: "cmd/server", to: "internal/util" }],
        ["cmd/server/main.go"],
      );
      const { built, report } = await runProduction(repo, map);
      expect(built.entrypointsDeclarationUnreadable).toBe(true);
      expect(report.status).toBe("INCOMPLETE");
      expect(findingKeys(report.findings)).toEqual([
        "SOURCE_NOT_ENUMERATED\0.repomapverify.toml\0",
      ]);

      failState.files.clear();
      const { fixture, repo: fixtureRepo } = copyRepoToFixture(
        repo,
        [
          "go.mod",
          "cmd/server/main.go",
          "internal/util/util.go",
          ".repomapverify.toml",
        ],
        map,
        "go-toml-unreadable",
      );
      const oracle = runOracle(fixture, [join(fixtureRepo, ".repomapverify.toml")]);
      expect(oracle.audit.status).toBe("INCOMPLETE");
      expect(oracle.audit.snapshotStatus).toBe("MATCH");
      expect(oracle.groundTruth.repoSnapshotSha256).toBe(snapshot);
      expect(oracle.groundTruth.entrypointsDeclarationUnreadable).toBe(true);
      expect(oracle.audit.findings).toEqual([]);
    } finally {
      failState.files.clear();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("readable toml: PASS, both sides, no flag (control)", async () => {
    const repo = mkRepo({
      "main.py": "import private.payment\n",
      "private/__init__.py": "",
      "private/payment.py": "import os\n",
      ".repomapverify.toml": '[entrypoints]\npaths = ["main.py"]\n',
    });
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
      const { built, report } = await runProduction(repo, map);
      expect(built.entrypointsDeclarationUnreadable).toBeUndefined();
      expect(built.declaredEntrypointPaths).toEqual(["main.py"]);
      expect(report.status).toBe("PASS");
      expect(report.findings).toEqual([]);

      const { fixture } = copyRepoToFixture(
        repo,
        [
          "main.py",
          "private/__init__.py",
          "private/payment.py",
          ".repomapverify.toml",
        ],
        map,
        "py-toml-readable",
      );
      const oracle = runOracle(fixture, []);
      expect(oracle.audit.status).toBe("PASS");
      expect(oracle.audit.snapshotStatus).toBe("MATCH");
      expect(oracle.groundTruth.repoSnapshotSha256).toBe(snapshot);
      expect(
        "entrypointsDeclarationUnreadable" in oracle.groundTruth,
      ).toBe(false);
      expect("entrypointsDeclarationUnreadable" in oracle.audit).toBe(
        false,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("no toml file: PASS, both sides, no flag (control)", async () => {
    const repo = mkRepo({
      "main.py": "import private.payment\n",
      "private/__init__.py": "",
      "private/payment.py": "import os\n",
    });
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
      );
      const { built, report } = await runProduction(repo, map);
      expect(built.entrypointsDeclarationUnreadable).toBeUndefined();
      expect(built.declaredEntrypointPaths).toEqual([]);
      expect(report.status).toBe("PASS");
      expect(report.findings).toEqual([]);

      const { fixture } = copyRepoToFixture(
        repo,
        ["main.py", "private/__init__.py", "private/payment.py"],
        map,
        "py-toml-absent",
      );
      const oracle = runOracle(fixture, []);
      expect(oracle.audit.status).toBe("PASS");
      expect(oracle.audit.snapshotStatus).toBe("MATCH");
      expect(oracle.groundTruth.repoSnapshotSha256).toBe(snapshot);
      expect(
        "entrypointsDeclarationUnreadable" in oracle.groundTruth,
      ).toBe(false);
      expect("entrypointsDeclarationUnreadable" in oracle.audit).toBe(
        false,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
