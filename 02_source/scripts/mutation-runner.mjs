#!/usr/bin/env node
/**
 * P024 T011 — standalone mutation runner (CLI level).
 *
 *   TMPDIR=~/workspace/p024-repomapverify/.tmp npm run build && node scripts/mutation-runner.mjs
 *
 * Reads the same hand-written case table as the vitest mutation
 * suite (02_source/tests/mutation/mutations.json), copies each
 * base control fixture to a fresh temp dir under TMPDIR, applies
 * the single mutation to the COPY's claimed-map.json only, and
 * runs the BUILT CLI (`node dist/cli.js audit`) against the copy.
 * A mutation is DETECTED when the CLI exits with the expected
 * code (FAIL = 1, INCOMPLETE = 2) and the report JSON carries the
 * expected finding (flip-snapshot: INCOMPLETE + STALE_SNAPSHOT +
 * zero findings).
 *
 * This is an independent second layer over tests/mutation: it
 * exercises the shipped CLI end-to-end (map loading, snapshot
 * check, comparator, report writing) rather than the src APIs.
 * Committed fixtures are never written to; temp dirs are removed
 * afterwards. Results go to
 * 03_evidence/T011/MUTATION_RUNNER_RESULTS.json. Exit 0 = all
 * detected, 1 = any undetected (or a runner error).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_DIR, "..");
const CLI = join(PKG_DIR, "dist", "cli.js");
const CASES_PATH = join(PKG_DIR, "tests", "mutation", "mutations.json");
const OUT_PATH = join(REPO_ROOT, "03_evidence", "T011", "MUTATION_RUNNER_RESULTS.json");

const EXIT_BY_STATUS = { PASS: 0, FAIL: 1, INCOMPLETE: 2 };

function findingKey(f) {
  return `${f.id}\0${f.from ?? ""}\0${f.to ?? ""}`;
}

function applyMutation(claimed, c) {
  const out = JSON.parse(JSON.stringify(claimed));
  const edges = out.edges;
  const modules = out.modules;
  switch (c.type) {
    case "add-hallucinated-edge": {
      if (edges.some((e) => e.from === c.mutation.from && e.to === c.mutation.to)) {
        throw new Error(`precondition failed: edge ${c.mutation.from} -> ${c.mutation.to} already claimed`);
      }
      edges.push({ from: c.mutation.from, to: c.mutation.to });
      return out;
    }
    case "delete-real-edge": {
      const idx = edges.findIndex((e) => e.from === c.mutation.from && e.to === c.mutation.to);
      if (idx === -1) throw new Error(`precondition failed: edge ${c.mutation.from} -> ${c.mutation.to} not claimed`);
      edges.splice(idx, 1);
      return out;
    }
    case "change-entrypoint":
      out.entrypoints = c.mutation.entrypoints;
      return out;
    case "rename-module-path": {
      const mod = modules.find((m) => m.path === c.mutation.oldPath);
      if (mod === undefined) throw new Error(`precondition failed: module ${c.mutation.oldPath} not claimed`);
      mod.path = c.mutation.newPath;
      return out;
    }
    case "flip-snapshot-hash":
      out.repoSnapshotSha256 = c.mutation.repoSnapshotSha256;
      return out;
    default:
      throw new Error(`unknown mutation type ${c.type}`);
  }
}

function main() {
  if (!existsSync(CLI)) {
    console.error(`mutation-runner: ${CLI} missing — run 'npm run build' first.`);
    process.exit(1);
  }
  const { cases } = JSON.parse(readFileSync(CASES_PATH, "utf8"));
  const results = [];
  for (const c of cases) {
    const fixtureDir = join(PKG_DIR, "tests", "fixtures", "s0", c.langDir, c.base);
    const tempDir = mkdtempSync(join(tmpdir(), "repomapverify-t011-runner-"));
    try {
      cpSync(fixtureDir, tempDir, { recursive: true });
      const claimedPath = join(tempDir, "claimed-map.json");
      const mutated = applyMutation(JSON.parse(readFileSync(claimedPath, "utf8")), c);
      writeFileSync(claimedPath, JSON.stringify(mutated, null, 2), "utf8");
      const outDir = join(tempDir, "out");
      const res = spawnSync(
        "node",
        [CLI, "audit", "--repo", join(tempDir, "repo"), "--map", claimedPath, "--out", outDir],
        { encoding: "utf8" },
      );
      const reportPath = join(outDir, "repomapverify-report.json");
      let report = null;
      let problems = [];
      if (!existsSync(reportPath)) {
        problems.push(`no report written (cli exit ${res.status}, stderr: ${(res.stderr ?? "").slice(0, 500)})`);
      } else {
        report = JSON.parse(readFileSync(reportPath, "utf8"));
        if (res.status !== EXIT_BY_STATUS[c.expectedStatus]) {
          problems.push(`exit code: got ${res.status}, want ${EXIT_BY_STATUS[c.expectedStatus]} (${c.expectedStatus})`);
        }
        if (report.status !== c.expectedStatus) {
          problems.push(`status: got ${report.status}, want ${c.expectedStatus}`);
        }
        if (c.expectedSnapshotStatus !== undefined) {
          if (report.snapshotStatus !== c.expectedSnapshotStatus) {
            problems.push(`snapshotStatus: got ${report.snapshotStatus}, want ${c.expectedSnapshotStatus}`);
          }
          if ((report.findings ?? []).length !== 0) {
            problems.push(`stale snapshot must carry no blame findings, got ${JSON.stringify(report.findings)}`);
          }
        } else if (c.expectedFinding !== null) {
          const want = findingKey(c.expectedFinding);
          const got = (report.findings ?? []).map(findingKey);
          if (!got.includes(want)) problems.push(`expected finding ${want} absent; got ${JSON.stringify(got)}`);
        }
      }
      const detected = problems.length === 0;
      console.log(`${detected ? "DETECTED  " : "UNDETECTED"} ${c.id} [${c.type}] ${c.base} -> ${report?.status ?? "?"} (exit ${res.status})`);
      results.push({
        id: c.id,
        base: c.base,
        language: c.language,
        type: c.type,
        expectedStatus: c.expectedStatus,
        gotStatus: report?.status ?? null,
        gotExitCode: res.status,
        expectedFinding: c.expectedFinding,
        gotFindings: (report?.findings ?? []).map((f) => ({ id: f.id, ...(f.from !== undefined ? { from: f.from } : {}), ...(f.to !== undefined ? { to: f.to } : {}) })),
        snapshotStatus: report?.snapshotStatus ?? null,
        detected,
        problems,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
  const detected = results.filter((r) => r.detected).length;
  writeFileSync(
    OUT_PATH,
    JSON.stringify({ suite: "T011 mutation runner (built CLI)", total: results.length, detected, undetected: results.length - detected, results }, null, 2),
    "utf8",
  );
  console.log(`mutation-runner: ${detected}/${results.length} detected -> ${OUT_PATH}`);
  process.exit(detected === results.length ? 0 : 1);
}

main();
