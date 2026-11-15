/**
 * T009 CLI tests (PROJECT_BOOK §6.4, §7; PLAN T009).
 *
 * End-to-end through the real built entry (`node dist/cli.js`),
 * plus in-process `main()` checks for usage errors. Covers:
 * - --help / no args / unknown command / unknown flag / bad --format
 * - audit control (exit 0 PASS), planted per language (exit 1 FAIL
 *   with the golden findings), INCOMPLETE dynamic-import case
 *   (exit 2), input errors (exit 3, clear message, no stack trace)
 * - ground-truth JSON-only output + --lang filter
 * - --format json / html writes only that file
 * - infoFindings surfaced (ENTRYPOINT_CANDIDATE, DUPLICATE_CONTENT)
 * - HTML offline (no external references) + edge evidence + own sections
 * - privacy: a repo under a realistic /home/<user>/... path leaves
 *   no absolute path or username in either report
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, beforeAll } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "..", "..");
const FIXTURES = join(SRC_DIR, "tests", "fixtures", "s0");
const CLI = join(SRC_DIR, "dist", "cli.js");

function tmpOut(): string {
  return mkdtempSync(join(tmpdir(), "repomapverify-t009-"));
}

function runCli(args: string[], env: Record<string, string> = {}): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function audit(
  fixtureDir: string,
  outDir: string,
  extra: string[] = [],
): { status: number | null; stdout: string; stderr: string; json: any; html: string } {
  const r = runCli([
    "audit",
    "--repo",
    join(fixtureDir, "repo"),
    "--map",
    join(fixtureDir, "claimed-map.json"),
    "--out",
    outDir,
    ...extra,
  ]);
  const jsonPath = join(outDir, "repomapverify-report.json");
  const htmlPath = join(outDir, "repomapverify-report.html");
  return {
    ...r,
    json: existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, "utf8")) : null,
    html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
  };
}

beforeAll(() => {
  // The S0 gate builds before running tests; rebuild only when dist
  // is missing so a test run never races a concurrent rebuild.
  if (!existsSync(CLI)) {
    execFileSync("npm", ["run", "build"], { cwd: SRC_DIR, stdio: "pipe" });
  }
}, 300_000);

describe("usage / help", () => {
  test("--help exits 0 and prints usage", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("repomapverify audit");
    expect(r.stdout).toContain("ground-truth");
  });

  test("no args prints usage, exit 0", () => {
    expect(runCli([]).status).toBe(0);
  });

  test("unknown command exits 3 with a clear message, no stack trace", () => {
    const r = runCli(["frobnicate"]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("Error: unknown command");
    expect(r.stderr).not.toContain("node:internal");
    expect(r.stderr).not.toMatch(/\n\s+at\s+\S+\s+\(/);
  });

  test("audit without --repo exits 3", () => {
    const r = runCli(["audit", "--map", "x.json"]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("audit needs --repo");
  });

  test("audit without --map exits 3", () => {
    const r = runCli(["audit", "--repo", "."]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("audit needs --map");
  });

  test("unknown flag exits 3", () => {
    const r = runCli(["audit", "--repo", ".", "--map", "x.json", "--bogus", "1"]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("unknown flag --bogus");
  });

  test("bad --format exits 3", () => {
    const r = runCli([
      "audit",
      "--repo",
      ".",
      "--map",
      "x.json",
      "--format",
      "pdf",
    ]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("--format must be json or html");
  });

  test("bad --lang exits 3", () => {
    const r = runCli(["ground-truth", "--repo", ".", "--lang", "rust"]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("--lang must be python, typescript or go");
  });
});

describe("audit end-to-end (exit codes match status)", () => {
  test("control fixture py-c01: exit 0 + PASS", () => {
    const out = tmpOut();
    const r = audit(join(FIXTURES, "python", "py-c01-basic-imports"), out);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RESULT: PASS");
    expect(r.json.status).toBe("PASS");
    expect(r.json.findings).toEqual([]);
    expect(r.json.infoFindings).toEqual([]);
    expect(r.html).toContain("PASS");
  });

  test("planted python py-p01: exit 1 + FAIL with the golden findings", () => {
    const out = tmpOut();
    const r = audit(join(FIXTURES, "python", "py-p01-hallucinated-edge"), out);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("RESULT: FAIL");
    expect(r.json.status).toBe("FAIL");
    expect(r.json.findings.map((f: any) => f.id).sort()).toEqual([
      "HALLUCINATED_EDGE",
      "HALLUCINATED_MODULE",
    ]);
    const edge = r.json.findings.find((f: any) => f.id === "HALLUCINATED_EDGE");
    expect(edge.from).toBe("billing/api.py");
    expect(edge.to).toBe("billing/refunds.py");
    expect(edge.severity).toBe("P1");
  });

  test("planted typescript ts-plant-01: exit 1 + FAIL", () => {
    const out = tmpOut();
    const r = audit(join(FIXTURES, "typescript", "ts-plant-01"), out);
    expect(r.status).toBe(1);
    expect(r.json.status).toBe("FAIL");
    expect(r.json.findings.map((f: any) => f.id)).toContain("HALLUCINATED_EDGE");
  });

  test("planted go go-plant-01: exit 1 + FAIL", () => {
    const out = tmpOut();
    const r = audit(join(FIXTURES, "go", "go-plant-01"), out);
    expect(r.status).toBe(1);
    expect(r.json.status).toBe("FAIL");
    expect(r.json.findings.map((f: any) => f.id)).toContain("HALLUCINATED_EDGE");
  });

  test("INCOMPLETE: dynamic import with a matching map -> exit 2", () => {
    const base = tmpOut();
    const repo = join(base, "repo");
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "main.py"), 'import loader\nimport util\n\n\ndef run():\n    loader.load("x")\n    util.go()\n');
    writeFileSync(join(repo, "loader.py"), 'import importlib\n\n\ndef load(name):\n    return importlib.import_module(name)\n');
    writeFileSync(join(repo, "util.py"), "def go():\n    pass\n");
    writeFileSync(join(repo, ".repomapverify.toml"), '[entrypoints]\npaths = ["main.py"]\n');
    // Snapshot-bind the claimed map from the ground-truth command.
    const gt = runCli(["ground-truth", "--repo", repo, "--lang", "python"]);
    expect(gt.status).toBe(0);
    const snap = JSON.parse(gt.stdout).repoSnapshotSha256 as string;
    expect(snap).toMatch(/^[0-9a-f]{64}$/);
    const mapPath = join(base, "claimed-map.json");
    writeFileSync(
      mapPath,
      JSON.stringify({
        schema: "repomapverify.claimed-map/v1",
        mapId: "synthetic-dynamic-incomplete",
        repo: "e2e-incomplete",
        completeness: "FULL_GRAPH",
        repoSnapshotSha256: snap,
        modules: [
          { id: "m1", path: "main.py", kind: "module" },
          { id: "m2", path: "loader.py", kind: "module" },
          { id: "m3", path: "util.py", kind: "module" },
        ],
        entrypoints: ["main.py"],
        edges: [
          { from: "main.py", to: "loader.py" },
          { from: "main.py", to: "util.py" },
        ],
      }),
    );
    const out = join(base, "out");
    const r = runCli(["audit", "--repo", repo, "--map", mapPath, "--out", out]);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("RESULT: INCOMPLETE");
    const report = JSON.parse(readFileSync(join(out, "repomapverify-report.json"), "utf8"));
    expect(report.status).toBe("INCOMPLETE");
    expect(report.findings.map((f: any) => f.id)).toEqual(["DYNAMIC_IMPORT_UNKNOWN"]);
    expect(report.findings[0].from).toBe("loader.py");
  });

  test("input errors exit 3: missing repo, missing map, bad schema", () => {
    const out = tmpOut();
    const missingRepo = runCli([
      "audit",
      "--repo",
      join(out, "no-such-repo"),
      "--map",
      "x.json",
      "--out",
      out,
    ]);
    expect(missingRepo.status).toBe(3);
    expect(missingRepo.stderr).toContain("repo path does not exist");

    const missingMap = runCli([
      "audit",
      "--repo",
      join(FIXTURES, "python", "py-c01-basic-imports", "repo"),
      "--map",
      join(out, "no-such-map.json"),
      "--out",
      out,
    ]);
    expect(missingMap.status).toBe(3);
    expect(missingMap.stderr).toContain("claimed map file does not exist");

    const badMapPath = join(out, "bad-map.json");
    writeFileSync(
      badMapPath,
      JSON.stringify({ schema: "not-a-claimed-map", mapId: "x" }),
    );
    const badSchema = runCli([
      "audit",
      "--repo",
      join(FIXTURES, "python", "py-c01-basic-imports", "repo"),
      "--map",
      badMapPath,
      "--out",
      out,
    ]);
    expect(badSchema.status).toBe(3);
    expect(badSchema.stderr).toContain("invalid claimed map");
    expect(badSchema.stderr).not.toMatch(/\n\s+at\s+\S+\s+\(/);
  });
});

describe("ground-truth command", () => {
  test("prints only the ground-truth JSON, exit 0", () => {
    const r = runCli([
      "ground-truth",
      "--repo",
      join(FIXTURES, "python", "py-c01-basic-imports", "repo"),
    ]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    const g = JSON.parse(r.stdout);
    expect(g.schema).toBe("repomapverify.ground-truth/v1");
    expect(g.modules).toHaveLength(4);
    expect(g.edges).toHaveLength(3);
    expect(g.repoSnapshotSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("--lang python filters to python modules only", () => {
    const r = runCli([
      "ground-truth",
      "--repo",
      join(FIXTURES, "python", "py-c01-basic-imports", "repo"),
      "--lang",
      "python",
    ]);
    expect(r.status).toBe(0);
    const g = JSON.parse(r.stdout);
    expect(g.modules.every((m: any) => m.language === "python")).toBe(true);
  });

  test("missing repo exits 3", () => {
    const r = runCli(["ground-truth", "--repo", "/no/such/repo"]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("repo path does not exist");
  });
});

describe("--format", () => {
  test("json writes only the JSON report", () => {
    const out = tmpOut();
    const r = audit(join(FIXTURES, "python", "py-c01-basic-imports"), out, ["--format", "json"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(out, "repomapverify-report.json"))).toBe(true);
    expect(existsSync(join(out, "repomapverify-report.html"))).toBe(false);
  });

  test("html writes only the HTML report", () => {
    const out = tmpOut();
    const r = audit(join(FIXTURES, "python", "py-c01-basic-imports"), out, ["--format", "html"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(out, "repomapverify-report.json"))).toBe(false);
    expect(existsSync(join(out, "repomapverify-report.html"))).toBe(true);
  });
});

describe("infoFindings are surfaced, never dropped", () => {
  test("ts-ctrl-08 (no toml): ENTRYPOINT_CANDIDATE in JSON + HTML own section", () => {
    const out = tmpOut();
    const r = audit(join(FIXTURES, "typescript", "ts-ctrl-08"), out);
    expect(r.status).toBe(0);
    expect(r.json.status).toBe("PASS");
    expect(r.json.findings).toEqual([]);
    expect(r.json.infoFindings.map((f: any) => f.id)).toContain("ENTRYPOINT_CANDIDATE");
    expect(r.json.sections.entrypointCandidates).toContain("src/main.ts");
    expect(r.html).toContain("Informational findings");
    expect(r.html).toContain("Entrypoint candidates");
    expect(r.html).toContain("src/main.ts");
    // Own sections exist even when empty — never mixed into the edge list.
    expect(r.html).toContain("Wrong entrypoints");
    expect(r.html).toContain("Unclaimed reachable modules");
    expect(r.html).toContain("Isolated modules");
  });

  test("py-p05: DUPLICATE_CONTENT lives in infoFindings, not main findings", () => {
    const out = tmpOut();
    const r = audit(join(FIXTURES, "python", "py-p05-name-collision"), out);
    expect(r.status).toBe(1);
    expect(r.json.findings.map((f: any) => f.id)).not.toContain("DUPLICATE_CONTENT");
    expect(r.json.infoFindings.map((f: any) => f.id)).toContain("DUPLICATE_CONTENT");
    expect(r.json.sections.duplicateContent.length).toBeGreaterThan(0);
    expect(r.html).toContain("Duplicate content");
  });
});

describe("HTML report: offline + edge evidence", () => {
  test("single file, zero external references; edge shows file, line, statement", () => {
    const out = tmpOut();
    const r = audit(join(FIXTURES, "python", "py-p01-hallucinated-edge"), out);
    expect(r.status).toBe(1);
    expect(r.html).not.toMatch(/https?:\/\//);
    expect(r.html).not.toMatch(/<script/);
    expect(r.html).not.toMatch(/\ssrc=/);
    expect(r.html).not.toMatch(/href="https?:/);
    expect(r.html).not.toMatch(/@import|url\(/);
    // Real edge evidence: source file, line number, import statement.
    expect(r.html).toContain("billing/api.py");
    expect(r.html).toContain("from billing.auth import login");
    // Header summary fields.
    expect(r.html).toContain("Ground-truth graph");
    expect(r.html).toContain("Coverage");
    expect(r.html).toContain("FULL_GRAPH");
    expect(r.html).toContain("Canonical semantic hash");
    // Colors / status words present.
    expect(r.html).toContain("verified");
    expect(r.html).toContain("fabricated");
  });
});

describe("privacy: realistic /home/<user>/... repo path", () => {
  test("no absolute path or username leaks into either report", () => {
    const base = tmpOut();
    const fakeHome = join(base, "home", "alice");
    const repo = join(fakeHome, "work", "billing-service");
    cpSync(join(FIXTURES, "python", "py-c01-basic-imports", "repo"), repo, {
      recursive: true,
    });
    const out = join(base, "out");
    const r = runCli(
      [
        "audit",
        "--repo",
        repo,
        "--map",
        join(FIXTURES, "python", "py-c01-basic-imports", "claimed-map.json"),
        "--out",
        out,
      ],
      { HOME: fakeHome },
    );
    expect(r.status).toBe(0);
    const jsonText = readFileSync(join(out, "repomapverify-report.json"), "utf8");
    const htmlText = readFileSync(join(out, "repomapverify-report.html"), "utf8");
    for (const text of [jsonText, htmlText]) {
      expect(text).not.toContain("/home/alice");
      expect(text).not.toContain("alice");
      expect(text).not.toContain(repo);
    }
    // Relative paths still present.
    expect(jsonText).toContain("billing/api.py");
  });
});
