/**
 * T012 performance tests (PROJECT_BOOK §10.3; PLAN T012 item 3).
 *
 * Synthetic repo: exactly 1,000 modules / 5,000 edges, three-language
 * split (Python 400 / TypeScript 300 / Go 300), generated at test
 * time from the seeded deterministic generator — only the generator
 * is committed, never the generated repo (it lives under TMPDIR).
 *
 * Targets (VM-measured, recorded honestly — a miss is reported, the
 * repo is NOT shrunk to pass):
 *   ground-truth extraction ≤ 30 s
 *   full audit              ≤ 60 s
 *   peak RSS                ≤ 512 MB (sampled VmRSS / VmHWM via
 *   tests/performance/measure.mjs; this VM has no /usr/bin/time)
 *
 * The audit uses a perfect claimed map built from the ground truth
 * itself (build-perf-map.mjs), so it must PASS with 0 findings; the
 * run measures timing, not detection. Results are written to
 * 03_evidence/T012/PERF_RESULTS.json (machine facts included) and
 * formatted into PERFORMANCE.md by tests/performance/run-performance.sh.
 */
import { cpus, totalmem } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { buildPerfMap } from "./build-perf-map.mjs";
import {
  EXPECTED,
  generatePerfRepo,
} from "./generate-perf-repo.mjs";
import { measure } from "./measure.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "..", "..");
const REPO_ROOT = join(SRC_DIR, "..");
const CLI = join(SRC_DIR, "dist", "cli.js");
const EVIDENCE_DIR = join(REPO_ROOT, "03_evidence", "T012");

const EXTRACTION_TARGET_SEC = 30;
const AUDIT_TARGET_SEC = 60;
const RSS_TARGET_MB = 512;

function machineFacts() {
  return {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model ?? "unknown",
    totalMemMb: Math.round(totalmem() / 1024 / 1024),
  };
}

describe("T012 performance — 1,000 modules / 5,000 edges", () => {
  test(
    "extraction ≤ 30 s, audit ≤ 60 s, peak RSS ≤ 512 MB",
    async () => {
      const perfRepo = join(tmpdir(), "perf-repo");
      const expected = generatePerfRepo(perfRepo);
      expect(expected).toEqual(EXPECTED);

      // 1. Ground-truth extraction (timed).
      const gt = await measure(process.execPath, [
        CLI,
        "ground-truth",
        "--repo",
        perfRepo,
      ]);
      expect(gt.exitCode).toBe(0);
      const groundTruth = JSON.parse(gt.stdout);
      expect(groundTruth.modules).toHaveLength(EXPECTED.modules);
      expect(groundTruth.edges).toHaveLength(EXPECTED.edges);
      const perLang: Record<string, number> = {};
      for (const m of groundTruth.modules) {
        perLang[m.language] = (perLang[m.language] ?? 0) + 1;
      }
      expect(perLang).toEqual({ python: 400, typescript: 300, go: 300 });

      // 2. Perfect claimed map from the ground truth itself.
      const mapPath = join(tmpdir(), "perf-map.json");
      writeFileSync(
        mapPath,
        JSON.stringify(buildPerfMap(groundTruth), null, 2) + "\n",
      );

      // 3. Full audit (timed).
      const outDir = join(tmpdir(), "perf-out");
      const audit = await measure(process.execPath, [
        CLI,
        "audit",
        "--repo",
        perfRepo,
        "--map",
        mapPath,
        "--out",
        outDir,
      ]);
      expect(audit.exitCode).toBe(0);
      const report = JSON.parse(
        readFileSync(join(outDir, "repomapverify-report.json"), "utf8"),
      );
      expect(report.status).toBe("PASS");
      expect(report.findings).toEqual([]);
      expect(report.groundTruth).toEqual({ modules: 1000, edges: 5000 });

      // 4. Record + assert against the §10.3 targets.
      const results = {
        repo: "synthetic 1,000 modules / 5,000 edges (py 400 / ts 300 / go 300)",
        generator: "tests/performance/generate-perf-repo.mjs (deterministic, fixed offsets)",
        machine: machineFacts(),
        groundTruth: {
          modules: groundTruth.modules.length,
          edges: groundTruth.edges.length,
          wallSec: gt.wallSec,
          peakRssMb: gt.peakRssMb,
          peakRssSource: gt.peakRssSource,
          targetSec: EXTRACTION_TARGET_SEC,
          withinTarget: gt.wallSec <= EXTRACTION_TARGET_SEC,
        },
        audit: {
          status: report.status,
          findings: report.findings.length,
          wallSec: audit.wallSec,
          peakRssMb: audit.peakRssMb,
          peakRssSource: audit.peakRssSource,
          targetSec: AUDIT_TARGET_SEC,
          withinTarget: audit.wallSec <= AUDIT_TARGET_SEC,
        },
        rssTargetMb: RSS_TARGET_MB,
        rssWithinTarget:
          gt.peakRssMb <= RSS_TARGET_MB && audit.peakRssMb <= RSS_TARGET_MB,
      };
      mkdirSync(EVIDENCE_DIR, { recursive: true });
      writeFileSync(
        join(EVIDENCE_DIR, "PERF_RESULTS.json"),
        JSON.stringify(results, null, 2) + "\n",
      );

      expect(gt.wallSec).toBeLessThanOrEqual(EXTRACTION_TARGET_SEC);
      expect(audit.wallSec).toBeLessThanOrEqual(AUDIT_TARGET_SEC);
      expect(gt.peakRssMb).toBeLessThanOrEqual(RSS_TARGET_MB);
      expect(audit.peakRssMb).toBeLessThanOrEqual(RSS_TARGET_MB);
      expect(existsSync(join(EVIDENCE_DIR, "PERF_RESULTS.json"))).toBe(true);
    },
    180_000,
  );
});
