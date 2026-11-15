/**
 * T008 — canonical hash freeze tests (PROJECT_BOOK §4.2, §10.1;
 * PLAN T008; 03_evidence/T008/SNAPSHOT_FREEZE.md).
 *
 * Under test:
 * 1. The FROZEN snapshot algorithm (sorted `path + NUL +
 *    contentSha256` lines): the canonical snapshot equals the Python
 *    extractor's snapshot AND the graph snapshot on ALL 16 Python S0
 *    fixtures (symlink-free repos), computed from an independent file
 *    walk — never from the extractor's own file list.
 * 2. Symlink behavior (T005 note, frozen by T008): the graph
 *    snapshot collapses alias spellings to the canonical path (one
 *    line per physical file); the extractor snapshot lists every
 *    spelling, so the two DIFFER on a repo with an in-repo symlink.
 * 3. Canonical semantic hash stability: same semantic graph -> same
 *    hash under shuffled input order and NFD-vs-NFC spellings;
 *    content change moves the hash, never any module_id; volatile
 *    fields (time, durations, absolute paths, temp dirs, random ids)
 *    never move the hash; the same semantic result produced under a
 *    different absolute repo location hashes identically once
 *    redacted.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { computeContentSha256, normalizeRelativePath } from "../../src/contracts/module.js";
import { extractPythonRepo } from "../../src/extractors/python/index.js";
import { buildGroundTruthGraphFromRepo } from "../../src/graph/fromRepo.js";
import {
  CANONICAL_SNAPSHOT_ALGORITHM,
  canonicalSemanticHash,
  canonicalSnapshotLines,
  canonicalizeGraph,
  computeCanonicalSnapshotSha256,
  stripVolatileFields,
} from "../../src/canonical/index.js";
import { buildGraph } from "../../src/graph/build.js";
import type { BuildGraphInput } from "../../src/graph/types.js";
import type { Language, ModuleV1 } from "../../src/contracts/module.js";
import { computeModuleId } from "../../src/contracts/module.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PY_FIXTURES = join(HERE, "..", "fixtures", "s0", "python");

function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Independent file walk: every file under `dir`, repo-relative POSIX paths. */
function walkFiles(dir: string, rel = ""): { relativePath: string; contentSha256: string }[] {
  const out: { relativePath: string; contentSha256: string }[] = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if ([".git", "node_modules", "__pycache__", ".venv", "venv"].includes(entry.name)) continue;
      out.push(...walkFiles(dir, r));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      out.push({
        relativePath: normalizeRelativePath(r),
        contentSha256: computeContentSha256(readFileSync(join(dir, r))),
      });
    }
  }
  return out;
}

function mod(language: Language, relativePath: string, content: string): ModuleV1 {
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

describe("frozen snapshot algorithm", () => {
  test("algorithm statement is the frozen sorted-lines formula", () => {
    expect(CANONICAL_SNAPSHOT_ALGORITHM).toBe(
      "sha256 over sorted lines: relativePath + NUL + contentSha256 + '\\n'",
    );
  });

  test("snapshot lines are NFC-first sorted path + NUL + sha lines", () => {
    const lines = canonicalSnapshotLines([
      { relativePath: "b.py", contentSha256: sha256("b") },
      { relativePath: "pkg/cafe\u0301.py", contentSha256: sha256("c") },
      { relativePath: "a.py", contentSha256: sha256("a") },
    ]);
    expect(lines).toEqual([
      `a.py\0${sha256("a")}\n`,
      `b.py\0${sha256("b")}\n`,
      `pkg/caf\u00e9.py\0${sha256("c")}\n`,
    ]);
  });

  test("canonical snapshot == extractor snapshot == graph snapshot on all 16 Python fixtures", async () => {
    const names = readdirSync(PY_FIXTURES)
      .filter((d) => d.startsWith("py-") && existsSync(join(PY_FIXTURES, d, "repo")))
      .sort();
    expect(names).toHaveLength(16);
    const mismatches: string[] = [];
    for (const name of names) {
      const repoDir = join(PY_FIXTURES, name, "repo");
      // Independent walk — never the extractor's own file list.
      const files = walkFiles(repoDir);
      const canonical = computeCanonicalSnapshotSha256(files);
      const truth = await extractPythonRepo(repoDir);
      const built = await buildGroundTruthGraphFromRepo(repoDir);
      if (canonical !== truth.repoSnapshotSha256) {
        mismatches.push(`${name}: canonical != extractor`);
      }
      if (canonical !== built.graph.repoSnapshotSha256) {
        mismatches.push(`${name}: canonical != graph`);
      }
      // The fixture's claimed map is bound to the same snapshot.
      const claimed = JSON.parse(
        readFileSync(join(PY_FIXTURES, name, "claimed-map.json"), "utf8"),
      ) as { repoSnapshotSha256: string };
      if (canonical !== claimed.repoSnapshotSha256) {
        mismatches.push(`${name}: canonical != claimed-map snapshot`);
      }
    }
    expect(mismatches).toEqual([]);
  }, 120_000);

  test("symlink: graph snapshot collapses aliases, extractor snapshot lists every spelling", async () => {
    const base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "t008-canonical-"));
    const repo = join(base, "repo");
    try {
      mkdirSync(join(repo, "pkg"), { recursive: true });
      writeFileSync(join(repo, ".repomapverify.toml"), '[entrypoints]\npaths = ["main.py"]\n');
      writeFileSync(join(repo, "main.py"), "from pkg.mod import run\n");
      writeFileSync(join(repo, "pkg", "__init__.py"), "");
      writeFileSync(join(repo, "pkg", "mod.py"), "def run():\n    pass\n");
      symlinkSync(join(repo, "pkg", "mod.py"), join(repo, "aliasmod.py"));

      const built = await buildGroundTruthGraphFromRepo(repo);
      const truth = await extractPythonRepo(repo);
      // Graph snapshot: one line for the physical file, under the
      // CANONICAL (smallest) spelling only.
      const canonicalPath = [...built.graph.modules.values()]
        .map((m) => m.relativePath)
        .find((p) => p === "pkg/mod.py" || p === "aliasmod.py") as string;
      const otherSpelling =
        canonicalPath === "pkg/mod.py" ? "aliasmod.py" : "pkg/mod.py";
      const collapsed = walkFiles(repo).filter(
        (f) => f.relativePath !== otherSpelling,
      );
      expect(computeCanonicalSnapshotSha256(collapsed)).toBe(
        built.graph.repoSnapshotSha256,
      );
      const graphLines = canonicalSnapshotLines(collapsed);
      expect(graphLines.some((l) => l.startsWith(`${canonicalPath}\0`))).toBe(true);
      expect(graphLines.some((l) => l.startsWith(`${otherSpelling}\0`))).toBe(false);
      // Extractor snapshot: both spellings listed, so it DIFFERS.
      expect(truth.repoSnapshotSha256).not.toBe(built.graph.repoSnapshotSha256);
      const extractorLines = canonicalSnapshotLines(walkFiles(repo));
      expect(computeCanonicalSnapshotSha256(walkFiles(repo))).toBe(
        truth.repoSnapshotSha256,
      );
      expect(extractorLines.some((l) => l.startsWith("aliasmod.py\0"))).toBe(true);
      expect(extractorLines.some((l) => l.startsWith("pkg/mod.py\0"))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("canonical semantic hash", () => {
  function semanticInput(): BuildGraphInput {
    const main = mod("python", "main.py", "import a\n");
    const a = mod("python", "pkg/a.py", "x = 1\n");
    return {
      modules: [{ module: main }, { module: a }],
      edges: [{ fromModuleId: main.moduleId, toModuleId: a.moduleId }],
      entrypointPaths: ["main.py"],
    };
  }

  test("same semantic graph -> same hash under shuffled order and NFD-vs-NFC spellings", () => {
    const base = buildGraph(semanticInput());
    const shuffled = buildGraph({
      ...semanticInput(),
      modules: [...semanticInput().modules].reverse(),
      edges: [...semanticInput().edges].reverse(),
    });
    expect(canonicalSemanticHash(canonicalizeGraph(base))).toBe(
      canonicalSemanticHash(canonicalizeGraph(shuffled)),
    );
    const nfd = buildGraph({
      modules: [
        { module: mod("python", "main.py", "import cafe\n") },
        { module: mod("python", "pkg/cafe\u0301.py", "x = 1\n") },
      ],
      edges: [],
      entrypointPaths: ["main.py"],
    });
    const nfc = buildGraph({
      modules: [
        { module: mod("python", "main.py", "import cafe\n") },
        { module: mod("python", "pkg/caf\u00e9.py", "x = 1\n") },
      ],
      edges: [],
      entrypointPaths: ["main.py"],
    });
    expect(canonicalSemanticHash(canonicalizeGraph(nfd))).toBe(
      canonicalSemanticHash(canonicalizeGraph(nfc)),
    );
  });

  test("volatile fields never move the hash; content change does, never any module_id", () => {
    const result = {
      schema: "repomapverify.report/v1",
      status: "FAIL",
      timestamp: "2026-11-14T15:00:00Z",
      durationMs: 1234,
      elapsedMs: 999,
      tempDir: "/tmp/worker-7",
      runId: "run-abc-123",
      repoRoot: "/home/alice/work/repo",
      absolutePath: "/home/alice/work/repo/billing/api.py",
      findings: [{ id: "HALLUCINATED_EDGE", from: "billing/api.py", to: "billing/refunds.py" }],
    };
    const rerun = {
      ...result,
      timestamp: "2026-11-14T16:30:00Z",
      durationMs: 42,
      elapsedMs: 7,
      tempDir: "/tmp/worker-9",
      runId: "run-xyz-999",
      repoRoot: "/home/bob/other/repo",
      absolutePath: "/home/bob/other/repo/billing/api.py",
    };
    expect(canonicalSemanticHash(result)).toBe(canonicalSemanticHash(rerun));
    expect(stripVolatileFields(result)).not.toHaveProperty("timestamp");
    expect(stripVolatileFields(result)).not.toHaveProperty("durationMs");
    expect(stripVolatileFields(result)).not.toHaveProperty("tempDir");
    expect(stripVolatileFields(result)).not.toHaveProperty("runId");
    expect(stripVolatileFields(result)).not.toHaveProperty("repoRoot");
    expect(stripVolatileFields(result)).not.toHaveProperty("absolutePath");
    // Semantic keys are never stripped.
    expect(stripVolatileFields(result)).toHaveProperty("findings");
    expect(stripVolatileFields(result)).toHaveProperty("schema");
    // A content change moves the hash.
    const changed = {
      ...result,
      findings: [{ id: "HALLUCINATED_EDGE", from: "billing/api.py", to: "billing/auth.py" }],
    };
    expect(canonicalSemanticHash(changed)).not.toBe(canonicalSemanticHash(result));
  });

  test("same semantic result under a different absolute repo location hashes identically once redacted", () => {
    const underAlice = {
      schema: "repomapverify.report/v1",
      modules: ["/home/alice/work/repo/billing/api.py"],
      note: "checked by alice",
    };
    const underBob = {
      schema: "repomapverify.report/v1",
      modules: ["/home/bob/work/repo/billing/api.py"],
      note: "checked by bob",
    };
    const optsAlice = { repoRoot: "/home/alice/work/repo", homeDir: "/home/alice" };
    const optsBob = { repoRoot: "/home/bob/work/repo", homeDir: "/home/bob" };
    expect(canonicalSemanticHash(underAlice, optsAlice)).toBe(
      canonicalSemanticHash(underBob, optsBob),
    );
    // Without redaction options the raw absolute paths are hashed as-is
    // (documented precondition: callers must normalize first).
    expect(canonicalSemanticHash(underAlice)).not.toBe(canonicalSemanticHash(underBob));
  });
});
