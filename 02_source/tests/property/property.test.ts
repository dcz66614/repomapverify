/**
 * T011 property tests (PROJECT_BOOK §10.2; PLAN T011, §7.1).
 *
 * Four properties over the pure graph builder + canonical hash
 * (src/graph/build.ts, src/canonical/index.ts), each with
 * randomized/generative inputs from a SEEDED PRNG so runs are
 * reproducible:
 *
 *   PROPERTY_SEED = 20261114 (mulberry32). The seed and the
 *   per-property case counts are recorded in
 *   03_evidence/T011/PROPERTY_RESULTS.json (written by afterAll).
 *
 *   (a) edge direction is preserved: an import A->B never appears
 *       as B->A in the ground truth unless the input also had B->A.
 *       (Stronger check: every output edge is an input edge, same
 *       direction.)
 *   (b) duplicate-edge normalization is idempotent: normalizing
 *       twice == normalizing once (build -> rebuild from the built
 *       graph's own modules/edges -> same canonical hash and JSON;
 *       and tripling every input edge changes nothing).
 *   (c) input file order does not change the normalized result:
 *       shuffling modules, edges and entrypoints yields the same
 *       canonical hash and canonical JSON.
 *   (d) no auto-generated reverse edges: the graph never contains
 *       an edge that is the reverse of a real import edge unless
 *       the source actually imports it.
 *
 * Each property runs 120 generated cases (480 total). Generated
 * graphs are small synthetic module sets (2–8 modules) in one
 * language per case (python / typescript / go, rotating); module
 * contents are deterministic (`<path>\n`), so module_id /
 * content_sha256 are fixed by construction. Self-edges are excluded
 * from generation: buildGraph drops them by design (recorded in
 * droppedEdges), which is not a property under test here.
 *
 * These tests are independent of the Oracle: they use only the
 * production graph/canonical modules and a test-side generator.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { buildGraph } from "../../src/graph/build.js";
import { canonicalGraphHash, canonicalizeGraph, canonicalJson } from "../../src/canonical/index.js";
import { computeContentSha256, computeModuleId } from "../../src/contracts/module.js";
import type { BuildGraphInput, GraphModuleInput } from "../../src/graph/types.js";
import type { Language, ModuleV1 } from "../../src/contracts/module.js";

export const PROPERTY_SEED = 20261114;
const CASES_PER_PROPERTY = 120;

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(HERE, "..", "..", "..", "03_evidence", "T011");

/** mulberry32 — small deterministic PRNG (seeded, reproducible). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const LANGUAGES: Language[] = ["python", "typescript", "go"];

/** One generated synthetic graph input. */
interface GeneratedCase {
  language: Language;
  input: BuildGraphInput;
  /** Module paths in generation order. */
  paths: string[];
  /** Input edges as (fromPath, toPath) pairs. */
  edges: [string, string][];
}

function moduleFor(language: Language, relativePath: string, isEntrypoint: boolean): ModuleV1 {
  const normalized = language === "go" && relativePath === "." ? "" : relativePath;
  return {
    moduleId: computeModuleId(language, normalized),
    language,
    nodeKind: language === "go" ? "package" : "module",
    relativePath,
    contentSha256: computeContentSha256(`${relativePath}\n`),
    isGenerated: false,
    isEntrypoint,
    parseStatus: "OK",
    evidenceLevel: "STATIC_RULE",
  };
}

/**
 * Generate one random graph: 2–8 modules, a random subset of the
 * possible directed edges (no self-edges), a random entrypoint
 * subset. Path pools keep module names distinct per language so no
 * two modules share a path; Go paths are package directories.
 */
function generateCase(rng: () => number, index: number): GeneratedCase {
  const language = LANGUAGES[index % LANGUAGES.length] as Language;
  const n = 2 + Math.floor(rng() * 7); // 2..8 modules
  const ext = language === "python" ? ".py" : language === "typescript" ? ".ts" : "";
  const pool =
    language === "go"
      ? ["cmd/server", "internal/app", "internal/store", "internal/util", "pkg/a", "pkg/b", "third_party/x", "."]
      : ["a", "b", "c", "d", "e", "f", "g", "h"].map((s) =>
          language === "python" ? `pkg/${s}${ext}` : `src/${s}${ext}`,
        );
  const shuffledPool = shuffle(rng, pool);
  const paths = shuffledPool.slice(0, n);
  // Random entrypoints: 0..2 of the modules (Go: file inside the package dir).
  const entryCount = Math.floor(rng() * 3);
  const entryModules = shuffle(rng, paths).slice(0, entryCount);
  const entrypointPaths =
    language === "go"
      ? entryModules.map((p) => (p === "." ? "main.go" : `${p}/main.go`))
      : entryModules;
  const modules: GraphModuleInput[] = paths.map((p) => ({
    module: moduleFor(language, p, entryModules.includes(p)),
  }));
  // Random edges: each ordered pair (no self) with p = 0.35.
  const edges: [string, string][] = [];
  const edgeInputs: BuildGraphInput["edges"] = [];
  const idOf = new Map(paths.map((p) => [p, computeModuleId(language, language === "go" && p === "." ? "" : p)]));
  for (const from of paths) {
    for (const to of paths) {
      if (from === to) continue;
      if (rng() < 0.35) {
        edges.push([from, to]);
        edgeInputs.push({
          fromModuleId: idOf.get(from) as string,
          toModuleId: idOf.get(to) as string,
          conditional: rng() < 0.25,
          typeOnly: rng() < 0.2,
        });
      }
    }
  }
  return {
    language,
    input: { modules, edges: edgeInputs, entrypointPaths },
    paths,
    edges,
  };
}

function pathOf(built: ReturnType<typeof buildGraph>, moduleId: string): string {
  return built.graph.modules.get(moduleId)?.relativePath ?? moduleId;
}

function outputEdgePairs(built: ReturnType<typeof buildGraph>): [string, string][] {
  return [...built.graph.edges.values()].map((e) => [
    pathOf(built, e.fromModuleId),
    pathOf(built, e.toModuleId),
  ]);
}

interface PropertyResult {
  property: string;
  seed: number;
  cases: number;
  passed: number;
  failed: number;
}

const propertyResults: PropertyResult[] = [];

function recordProperty(property: string, cases: number, passed: number): void {
  propertyResults.push({ property, seed: PROPERTY_SEED, cases, passed, failed: cases - passed });
}

afterAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    join(EVIDENCE_DIR, "PROPERTY_RESULTS.json"),
    JSON.stringify(
      {
        suite: "T011 property tests",
        seed: PROPERTY_SEED,
        prng: "mulberry32",
        casesPerProperty: CASES_PER_PROPERTY,
        totalCases: propertyResults.reduce((n, r) => n + r.cases, 0),
        totalPassed: propertyResults.reduce((n, r) => n + r.passed, 0),
        properties: propertyResults,
      },
      null,
      2,
    ),
    "utf8",
  );
});

describe("T011 property tests (seed 20261114, mulberry32)", () => {
  test("(a) edge direction is preserved: every output edge is an input edge, same direction", () => {
    const rng = mulberry32(PROPERTY_SEED);
    let passed = 0;
    for (let i = 0; i < CASES_PER_PROPERTY; i++) {
      const c = generateCase(rng, i);
      const built = buildGraph(c.input);
      const outPairs = outputEdgePairs(built);
      const inputSet = new Set(c.edges.map(([f, t]) => `${f}\0${t}`));
      // Every output edge must be an input edge in the same direction.
      for (const [f, t] of outPairs) {
        expect(inputSet.has(`${f}\0${t}`), `case ${i} (${c.language}): output edge ${f} -> ${t} is not an input edge`).toBe(true);
      }
      // No output edge may be the reverse of an input-only edge.
      for (const [f, t] of outPairs) {
        if (!inputSet.has(`${t}\0${f}`)) {
          expect(inputSet.has(`${f}\0${t}`), `case ${i}: reversed edge ${f} -> ${t}`).toBe(true);
        }
      }
      passed++;
    }
    recordProperty("a-edge-direction-preserved", CASES_PER_PROPERTY, passed);
  });

  test("(b) duplicate-edge normalization is idempotent: normalize twice == normalize once", () => {
    const rng = mulberry32(PROPERTY_SEED + 1);
    let passed = 0;
    for (let i = 0; i < CASES_PER_PROPERTY; i++) {
      const c = generateCase(rng, i);
      // Normalize once, with every input edge tripled (duplicates must collapse).
      const tripled: BuildGraphInput = {
        ...c.input,
        edges: [...c.input.edges, ...c.input.edges, ...c.input.edges],
      };
      const once = buildGraph(tripled);
      const hashOnce = canonicalGraphHash(once);
      // Normalize a second time: feed the built graph's own modules/edges back in.
      const rebuiltInput: BuildGraphInput = {
        modules: [...once.graph.modules.values()].map((m) => ({ module: { ...m } })),
        edges: [...once.graph.edges.values()].map((e) => ({
          fromModuleId: e.fromModuleId,
          toModuleId: e.toModuleId,
          conditional: e.conditional,
          typeOnly: e.typeOnly,
        })),
        entrypointPaths: [...once.declaredEntrypointPaths],
        externalImportCount: once.graph.externalImportCount,
        repoSnapshotSha256: once.graph.repoSnapshotSha256,
      };
      const twice = buildGraph(rebuiltInput);
      expect(canonicalGraphHash(twice), `case ${i} (${c.language}): second normalization changed the canonical hash`).toBe(hashOnce);
      expect(
        canonicalJson(canonicalizeGraph(twice)),
        `case ${i} (${c.language}): second normalization changed the canonical JSON`,
      ).toBe(canonicalJson(canonicalizeGraph(once)));
      // And the tripled input must equal the plain input.
      const plain = buildGraph(c.input);
      expect(canonicalGraphHash(plain), `case ${i} (${c.language}): tripling edges changed the canonical hash`).toBe(hashOnce);
      passed++;
    }
    recordProperty("b-duplicate-normalization-idempotent", CASES_PER_PROPERTY, passed);
  });

  test("(c) input file order does not change the normalized result", () => {
    const rng = mulberry32(PROPERTY_SEED + 2);
    let passed = 0;
    for (let i = 0; i < CASES_PER_PROPERTY; i++) {
      const c = generateCase(rng, i);
      const base = buildGraph(c.input);
      const baseHash = canonicalGraphHash(base);
      const baseJson = canonicalJson(canonicalizeGraph(base));
      for (let s = 0; s < 3; s++) {
        const shuffled: BuildGraphInput = {
          modules: shuffle(rng, c.input.modules),
          edges: shuffle(rng, c.input.edges),
          entrypointPaths: shuffle(rng, c.input.entrypointPaths),
        };
        const other = buildGraph(shuffled);
        expect(canonicalGraphHash(other), `case ${i} shuffle ${s} (${c.language}): canonical hash changed under reordering`).toBe(baseHash);
        expect(canonicalJson(canonicalizeGraph(other)), `case ${i} shuffle ${s} (${c.language}): canonical JSON changed under reordering`).toBe(baseJson);
      }
      passed++;
    }
    recordProperty("c-input-order-independent", CASES_PER_PROPERTY, passed);
  });

  test("(d) no auto-generated reverse edges", () => {
    const rng = mulberry32(PROPERTY_SEED + 3);
    let passed = 0;
    for (let i = 0; i < CASES_PER_PROPERTY; i++) {
      const c = generateCase(rng, i);
      const built = buildGraph(c.input);
      const outSet = new Set(outputEdgePairs(built).map(([f, t]) => `${f}\0${t}`));
      const inputSet = new Set(c.edges.map(([f, t]) => `${f}\0${t}`));
      for (const [f, t] of c.edges) {
        if (!inputSet.has(`${t}\0${f}`)) {
          expect(
            outSet.has(`${t}\0${f}`),
            `case ${i} (${c.language}): reverse edge ${t} -> ${f} was auto-generated for real import ${f} -> ${t}`,
          ).toBe(false);
        }
      }
      // Output must contain no edge at all that is not an input edge.
      for (const pair of outSet) {
        expect(inputSet.has(pair), `case ${i} (${c.language}): output contains non-input edge ${pair}`).toBe(true);
      }
      passed++;
    }
    recordProperty("d-no-auto-reverse-edges", CASES_PER_PROPERTY, passed);
  });

  test("seed reproducibility: the same seed generates the same first case", () => {
    const first = generateCase(mulberry32(PROPERTY_SEED), 0);
    const again = generateCase(mulberry32(PROPERTY_SEED), 0);
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
  });
});
