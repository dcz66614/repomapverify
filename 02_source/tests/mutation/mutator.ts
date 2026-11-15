/**
 * T011 mutation runner (PROJECT_BOOK §10.2; PLAN T011, §7.1).
 *
 * Applies single mutations to COPIES of control fixtures and
 * asserts the audit detects each one. The runner is shared by:
 *   - tests/mutation/mutation.test.ts (vitest, production src APIs)
 *   - scripts/mutation-runner.mjs (standalone, built CLI audit)
 *
 * Discipline:
 *   - The committed fixture tree is NEVER written to. A case copies
 *     the fixture (repo + claimed-map.json) into a fresh temp dir
 *     under os.tmpdir() — which honours TMPDIR (set to the
 *     persistent ~/workspace/p024-repomapverify/.tmp for heavy
 *     runs) — and mutates ONLY the copy's claimed-map.json.
 *   - The test records the SHA-256 of every base fixture's
 *     claimed-map.json before the suite and re-checks it after, so
 *     any accidental write to a committed fixture fails the suite.
 *   - A mutation is DETECTED when the audit returns the expected
 *     status (FAIL, or INCOMPLETE for a flipped snapshot hash) AND
 *     the expected finding is present (flip-snapshot: status
 *     INCOMPLETE + snapshotStatus STALE_SNAPSHOT + zero findings,
 *     per the frozen T006 short-circuit — the map describes a
 *     different tree, so no blame findings may be emitted).
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGroundTruthGraphFromRepo } from "../../src/graph/fromRepo.js";
import { compareMapsDetailed } from "../../src/comparator/compare.js";
import { evidenceFor, loadClaimedFromObject } from "../golden/helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const S0_ROOT = join(HERE, "..", "fixtures", "s0");

export type MutationType =
  | "add-hallucinated-edge"
  | "delete-real-edge"
  | "change-entrypoint"
  | "rename-module-path"
  | "flip-snapshot-hash";

export interface MutationCase {
  id: string;
  base: string;
  langDir: string;
  language: string;
  type: MutationType;
  mutation: Record<string, unknown>;
  expectedStatus: string;
  expectedFinding: { id: string; from?: string; to?: string } | null;
  expectedSnapshotStatus?: string;
}

export interface MutationResult {
  id: string;
  base: string;
  language: string;
  type: MutationType;
  expectedStatus: string;
  gotStatus: string;
  expectedFinding: MutationCase["expectedFinding"];
  gotFindings: { id: string; from?: string; to?: string }[];
  snapshotStatus: string;
  detected: boolean;
  problems: string[];
  tempDir: string;
}

export function loadMutationCases(): MutationCase[] {
  const raw = JSON.parse(readFileSync(join(HERE, "mutations.json"), "utf8")) as {
    cases: MutationCase[];
  };
  return raw.cases;
}

export function sha256File(absPath: string): string {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

/**
 * Pure JSON transform: apply one mutation to a parsed claimed map.
 * Throws when the mutation's precondition is not met (e.g. the
 * edge to delete is not in the map) — a case whose precondition
 * fails is a broken case, not a passed detection.
 */
export function applyMutation(
  claimedRaw: Record<string, unknown>,
  mutationCase: MutationCase,
): Record<string, unknown> {
  const claimed = JSON.parse(JSON.stringify(claimedRaw)) as Record<string, unknown>;
  const edges = claimed.edges as { from: string; to: string }[];
  const modules = claimed.modules as { id: string; path: string; kind: string }[];
  switch (mutationCase.type) {
    case "add-hallucinated-edge": {
      const { from, to } = mutationCase.mutation as { from: string; to: string };
      if (edges.some((e) => e.from === from && e.to === to)) {
        throw new Error(`precondition failed: edge ${from} -> ${to} already claimed`);
      }
      edges.push({ from, to });
      return claimed;
    }
    case "delete-real-edge": {
      const { from, to } = mutationCase.mutation as { from: string; to: string };
      const idx = edges.findIndex((e) => e.from === from && e.to === to);
      if (idx === -1) throw new Error(`precondition failed: edge ${from} -> ${to} not in claimed map`);
      edges.splice(idx, 1);
      return claimed;
    }
    case "change-entrypoint": {
      claimed.entrypoints = mutationCase.mutation.entrypoints as string[];
      return claimed;
    }
    case "rename-module-path": {
      const { oldPath, newPath } = mutationCase.mutation as { oldPath: string; newPath: string };
      const mod = modules.find((m) => m.path === oldPath);
      if (mod === undefined) throw new Error(`precondition failed: module ${oldPath} not in claimed map`);
      if (modules.some((m) => m.path === newPath)) {
        throw new Error(`precondition failed: module ${newPath} already claimed`);
      }
      mod.path = newPath;
      return claimed;
    }
    case "flip-snapshot-hash": {
      claimed.repoSnapshotSha256 = mutationCase.mutation.repoSnapshotSha256 as string;
      return claimed;
    }
  }
}

function findingKey(f: { id: string; from?: string; to?: string }): string {
  return `${f.id}\0${f.from ?? ""}\0${f.to ?? ""}`;
}

/**
 * Run one mutation case end-to-end over the production APIs:
 * copy the fixture to a temp dir, mutate the copy, build the
 * ground truth from the copied repo, audit the mutated map.
 * The temp dir is removed afterwards (the result record keeps its
 * path for the evidence table).
 */
export async function runMutationCase(mutationCase: MutationCase): Promise<MutationResult> {
  const fixtureDir = join(S0_ROOT, mutationCase.langDir, mutationCase.base);
  const tempDir = mkdtempSync(join(tmpdir(), "repomapverify-t011-mut-"));
  try {
    cpSync(fixtureDir, tempDir, { recursive: true });
    const claimedPath = join(tempDir, "claimed-map.json");
    if (!existsSync(claimedPath)) throw new Error(`fixture ${mutationCase.base} has no claimed-map.json`);
    const original = JSON.parse(readFileSync(claimedPath, "utf8")) as Record<string, unknown>;
    const mutated = applyMutation(original, mutationCase);
    writeFileSync(claimedPath, JSON.stringify(mutated, null, 2), "utf8");

    const repoDir = join(tempDir, "repo");
    const built = await buildGroundTruthGraphFromRepo(repoDir);
    const evidence = await evidenceFor(mutationCase.language, repoDir);
    const claimed = loadClaimedFromObject(mutated);
    const { report } = compareMapsDetailed(built, claimed, evidence);

    const gotFindings = report.findings.map((f) => ({
      id: f.id,
      ...(f.from !== undefined ? { from: f.from } : {}),
      ...(f.to !== undefined ? { to: f.to } : {}),
    }));
    const problems: string[] = [];
    let detected = true;
    if (report.status !== mutationCase.expectedStatus) {
      detected = false;
      problems.push(`status: got ${report.status}, want ${mutationCase.expectedStatus}`);
    }
    if (mutationCase.expectedSnapshotStatus !== undefined) {
      if (report.snapshotStatus !== mutationCase.expectedSnapshotStatus) {
        detected = false;
        problems.push(`snapshotStatus: got ${report.snapshotStatus}, want ${mutationCase.expectedSnapshotStatus}`);
      }
      if (report.findings.length !== 0) {
        detected = false;
        problems.push(`stale snapshot must carry no blame findings, got ${JSON.stringify(gotFindings)}`);
      }
    } else if (mutationCase.expectedFinding !== null) {
      const want = findingKey(mutationCase.expectedFinding);
      if (!gotFindings.some((f) => findingKey(f) === want)) {
        detected = false;
        problems.push(`expected finding ${want} absent; got ${JSON.stringify(gotFindings.map(findingKey))}`);
      }
    }
    return {
      id: mutationCase.id,
      base: mutationCase.base,
      language: mutationCase.language,
      type: mutationCase.type,
      expectedStatus: mutationCase.expectedStatus,
      gotStatus: report.status,
      expectedFinding: mutationCase.expectedFinding,
      gotFindings,
      snapshotStatus: report.snapshotStatus,
      detected,
      problems,
      tempDir,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
