#!/usr/bin/env node
/**
 * P024 T004 -- production probe (S0 gate scaffolding, NOT the Oracle).
 *
 * Runs the production extractors (dist/) over the S0 fixtures and dumps
 * their output in the SAME canonical schema the independent Oracle emits
 * (see oracle/python/oracle.py), so the gate can compare the three sides
 * field-by-field:
 *
 *   oracle canonical  vs  golden canonical  vs  production canonical
 *
 * Canonical schema per fixture:
 *   { fixture, language, seed, groundTruth: {
 *       modules: [{relativePath, moduleId, contentSha256, language,
 *                  nodeKind, isGenerated, isEntrypoint, parseStatus,
 *                  files: [{relativePath, contentSha256, isGenerated,
 *                           isCgo}],
 *                  isDeclarationFile?, packageName?, hasCgo?}],
 *       edges: [{from, to, conditional, typeOnly,
 *                evidence: {line, statement, specifier, file}, kind}],
 *       generatedEdges: [<same>],
 *       entrypoints: [str], reachableFromEntrypoints: [str],
 *       isolatedModules: [str], externalImportCount: int,
 *       externalImports: [{from, specifier, line, conditional}],
 *       unknownImports: [{from, specifier, reason, line}],
 *       dynamicUnknown: [{path, line, statement, kind}],
 *       excludedFiles: [{relativePath, reason}],
 *       repoSnapshotSha256: str|null },
 *     }
 *
 * Notes on fields the production extractors do not expose:
 * - TypeScript/Go extractors expose no reachable/isolated sets and no
 *   snapshot hash. Reachable/isolated are DERIVED here by BFS over the
 *   production edges from the production entrypoints (same rule the
 *   Oracle uses: all core edges, no package-init closure outside
 *   Python). repoSnapshotSha256 is null for TS/Go (Oracle-only there);
 *   the Python extractor does expose it and it is compared.
 * - TypeScript edges have no `conditional` in production (no conditional
 *   import construct exists in the frozen TS scope); canonical false.
 *
 * Usage:
 *   node scripts/prod-probe.mjs --fixtures-root <dir> --out <file>
 *   node scripts/prod-probe.mjs --fixtures-root <dir> --replay 100 --out <file>
 *     (replay: extract all fixtures N times in-process, emit per-replay
 *      SHA-256 hashes of the canonical results; --out holds
 *      {replays, distinct, hash, replayCount, fixtureCount})
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extractPythonRepo } from "../dist/extractors/python/index.js";
import { extractTypeScriptRepo } from "../dist/extractors/typescript/index.js";
import { extractGoRepo } from "../dist/extractors/go/index.js";

const SEED = "P024-REPOMAPVERIFY-S0-2026-11-14";
const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES_ROOT = join(SRC_DIR, "tests", "fixtures", "s0");

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Deterministic JSON: recursively sort object keys.
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortDeep(value[k]);
    return out;
  }
  return value;
}

function canonStr(s) {
  return JSON.stringify(sortDeep(s));
}

// FIX P024 R1 P1-01 follow-up: the production extractors do not expose
// whether `.repomapverify.toml` was unreadable, so the probe checks it
// itself -- the file exists but readFileSync throws => unreadable.
// Recorded ONLY when true, mirroring the Oracle and BuiltGraph
// omission rule, so the S0 gate hash is unchanged on readable fixtures.
function entrypointsDeclarationUnreadable(repo) {
  const tomlPath = join(repo, ".repomapverify.toml");
  if (!existsSync(tomlPath)) return false;
  try {
    readFileSync(tomlPath);
    return false;
  } catch {
    return true;
  }
}

function bfsReachable(modules, edges, entrypoints) {
  const byPath = new Set(modules.map((m) => m.relativePath));
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
  }
  const reachable = new Set();
  const stack = [...entrypoints];
  while (stack.length) {
    const cur = stack.pop();
    if (reachable.has(cur) || !byPath.has(cur)) continue;
    reachable.add(cur);
    for (const nxt of out.get(cur) ?? []) {
      if (!reachable.has(nxt)) stack.push(nxt);
    }
  }
  return [
    [...reachable].sort(),
    [...byPath].filter((p) => !reachable.has(p)).sort(),
  ];
}

function normEdge(e, language) {
  // Evidence: python {line, statement}; TS {line, specifier};
  // Go {file, line, importPath -> specifier}.
  const ev = e.evidence ?? {};
  return {
    from: e.from,
    to: e.to,
    conditional: e.conditional ?? false,
    typeOnly: e.typeOnly ?? false,
    evidence: {
      line: ev.line ?? null,
      statement: ev.statement ?? null,
      specifier: ev.specifier ?? ev.importPath ?? null,
      file: ev.file ?? null,
    },
    kind: e.kind ?? null,
  };
}

function sortEdges(list) {
  return [...list]
    .map((e) => normEdge(e))
    .sort((a, b) =>
      a.from.localeCompare(b.from) || a.to.localeCompare(b.to) ||
      (a.evidence.line ?? 0) - (b.evidence.line ?? 0));
}

async function runFixture(dirName, langDir) {
  const fixtureDir = join(FIXTURES_ROOT, langDir, dirName);
  const repo = join(fixtureDir, "repo");
  let gt;
  if (dirName.startsWith("py-")) {
    const r = await extractPythonRepo(repo);
    const modules = r.modules.map((m) => ({
      relativePath: m.relativePath,
      moduleId: m.moduleId,
      contentSha256: m.contentSha256,
      language: "python",
      nodeKind: m.nodeKind,
      isGenerated: m.isGenerated,
      isEntrypoint: m.isEntrypoint,
      parseStatus: m.parseStatus,
      files: [{ relativePath: m.relativePath,
                contentSha256: m.contentSha256,
                isGenerated: m.isGenerated, isCgo: false }],
    }));
    gt = {
      modules: modules.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
      edges: sortEdges(r.edges),
      generatedEdges: sortEdges(r.generatedExcludedEdges ?? []),
      entrypoints: [...r.entrypoints].sort(),
      reachableFromEntrypoints: [...r.reachableFromEntrypoints].sort(),
      isolatedModules: [...r.isolatedModules].sort(),
      externalImportCount: r.externalImports.length,
      externalImports: [...r.externalImports]
        .map((x) => ({ from: x.from, specifier: x.specifier, line: x.line,
                       conditional: x.conditional }))
        .sort((a, b) => a.from.localeCompare(b.from) ||
          a.specifier.localeCompare(b.specifier) || a.line - b.line),
      unknownImports: [...r.unknownImports]
        .map((x) => ({ from: x.from, specifier: x.specifier,
                       reason: x.reason, line: x.line,
                       statement: x.statement ?? null }))
        .sort((a, b) => a.from.localeCompare(b.from) ||
          a.specifier.localeCompare(b.specifier) || a.line - b.line),
      dynamicUnknown: [...r.dynamicUnknown]
        .map((x) => ({ path: x.path, line: x.line, statement: x.statement,
                       kind: x.kind }))
        .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line),
      excludedFiles: [],
      repoSnapshotSha256: r.repoSnapshotSha256,
    };
    if (entrypointsDeclarationUnreadable(repo)) {
      gt.entrypointsDeclarationUnreadable = true;
    }
    return { fixture: dirName, language: "python", seed: SEED, groundTruth: gt };
  }
  if (dirName.startsWith("ts-")) {
    const r = await extractTypeScriptRepo(repo);
    const modules = r.modules.map((d) => ({
      relativePath: d.module.relativePath,
      moduleId: d.module.moduleId,
      contentSha256: d.module.contentSha256,
      language: "typescript",
      nodeKind: d.module.nodeKind,
      isGenerated: d.module.isGenerated,
      isEntrypoint: d.module.isEntrypoint,
      parseStatus: d.module.parseStatus,
      isDeclarationFile: d.isDeclarationFile,
      files: [{ relativePath: d.module.relativePath,
                contentSha256: d.module.contentSha256,
                isGenerated: d.module.isGenerated, isCgo: false }],
    })).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const edges = sortEdges(r.edges);
    const [reachable, isolated] = bfsReachable(
      modules, edges, [...r.declaredEntrypoints].sort());
    gt = {
      modules,
      edges,
      generatedEdges: sortEdges(r.generatedEdges),
      entrypoints: [...r.declaredEntrypoints].sort(),
      reachableFromEntrypoints: reachable,
      isolatedModules: isolated,
      externalImportCount: r.externalImportCount,
      externalImports: [],
      unknownImports: [...r.unknowns]
        .map((x) => ({ from: x.from, specifier: x.specifier,
                       reason: x.reason, line: x.line }))
        .sort((a, b) => a.from.localeCompare(b.from) ||
          a.specifier.localeCompare(b.specifier) || a.line - b.line),
      dynamicUnknown: [],
      excludedFiles: [],
      repoSnapshotSha256: null,
    };
    if (entrypointsDeclarationUnreadable(repo)) {
      gt.entrypointsDeclarationUnreadable = true;
    }
    return { fixture: dirName, language: "typescript", seed: SEED, groundTruth: gt };
  }
  // Go
  const r = await extractGoRepo(repo);
  const modules = r.packages.map((d) => ({
    relativePath: d.module.relativePath,
    moduleId: d.module.moduleId,
    contentSha256: d.module.contentSha256,
    language: "go",
    nodeKind: d.module.nodeKind,
    isGenerated: d.module.isGenerated,
    isEntrypoint: d.module.isEntrypoint,
    parseStatus: d.module.parseStatus,
    packageName: d.packageName,
    hasCgo: d.hasCgo,
    files: [...d.files]
      .map((f) => ({ relativePath: f.relativePath,
                     contentSha256: f.contentSha256,
                     isGenerated: f.isGenerated, isCgo: f.isCgo }))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  })).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const edges = sortEdges(r.edges);
  const declaredPkgDirs = [...new Set(
    r.declaredEntrypoints.map((p) => {
      const parts = p.split("/");
      parts.pop();
      return parts.join("/") || ".";
    }))].sort();
  const [reachable, isolated] = bfsReachable(modules, edges, declaredPkgDirs);
  gt = {
    modules,
    edges,
    generatedEdges: sortEdges(r.generatedEdges),
    entrypoints: declaredPkgDirs,
    reachableFromEntrypoints: reachable,
    isolatedModules: isolated,
    externalImportCount: r.externalImportCount,
    externalImports: [],
    unknownImports: [...r.unknowns]
      .map((x) => ({ from: x.from, specifier: x.importPath,
                     reason: x.reason, line: x.line }))
      .sort((a, b) => a.from.localeCompare(b.from) ||
        a.specifier.localeCompare(b.specifier) || a.line - b.line),
    dynamicUnknown: [],
    excludedFiles: [...r.excludedFiles]
      .map((x) => ({ relativePath: x.relativePath, reason: x.reason }))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    repoSnapshotSha256: null,
  };
  if (entrypointsDeclarationUnreadable(repo)) {
    gt.entrypointsDeclarationUnreadable = true;
  }
  return { fixture: dirName, language: "go", seed: SEED, groundTruth: gt };
}

function listFixtures() {
  const out = [];
  for (const langDir of ["python", "typescript", "go"]) {
    const dir = join(FIXTURES_ROOT, langDir);
    for (const name of readdirSync(dir).sort()) {
      if (!/^(py|ts|go)-/.test(name)) continue;
      if (!statSync(join(dir, name)).isDirectory()) continue;
      out.push([name, langDir]);
    }
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

function parseArgs(argv) {
  const args = { replay: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--fixtures-root") args.fixturesRoot = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--replay") args.replay = Number(argv[++i]);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.out) {
  console.error("prod-probe: --out <file> required");
  process.exit(3);
}
const fixtures = listFixtures();
if (args.replay > 0) {
  const hashes = [];
  for (let i = 0; i < args.replay; i++) {
    const results = [];
    for (const [name, langDir] of fixtures) {
      results.push(await runFixture(name, langDir));
    }
    hashes.push(sha256Hex(canonStr(results)));
  }
  const out = { replays: hashes, distinct: new Set(hashes).size,
                hash: new Set(hashes).size === 1 ? hashes[0] : null,
                replayCount: args.replay, fixtureCount: fixtures.length };
  writeFileSync(args.out, canonStr(out) + "\n");
} else {
  const results = [];
  for (const [name, langDir] of fixtures) {
    results.push(await runFixture(name, langDir));
  }
  writeFileSync(args.out, canonStr({ fixtures: results }) + "\n");
}
