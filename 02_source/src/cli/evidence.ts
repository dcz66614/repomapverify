/**
 * T009 — Comparator + edge evidence collection for the CLI
 * (PROJECT_BOOK §6.4; PLAN T009).
 *
 * The ground-truth builder (`buildGroundTruthGraphFromRepo`) returns
 * the graph but not the per-edge source evidence (file, line, import
 * statement) or the extractor-level unknowns the comparator needs.
 * This module re-runs the three frozen extractors — read-only, in
 * the same order and with the same field mapping the T006 golden
 * tests use — and assembles:
 *
 * - `ComparatorEvidence` (dynamicUnknowns / unknownImports /
 *   generatedEdges) for `compareMapsDetailed`;
 * - `edgeEvidence`: one entry per real edge, keyed by
 *   `${fromPath}\0${toPath}`, with the source file, 1-based line
 *   and import statement, so the HTML report can show them when an
 *   edge is clicked (§7.1). Python carries the exact statement;
 *   TypeScript carries the specifier (reconstructed in its written
 *   import form from the edge kind); Go carries the import path.
 *
 * The extractors are run sequentially: their tree-sitter parsers
 * are process-global singletons in places, so they must not run in
 * parallel (same rule as `fromRepo.ts`).
 */
import { extractPythonRepo } from "../extractors/python/index.js";
import { extractTypeScriptRepo } from "../extractors/typescript/index.js";
import { extractGoRepo } from "../extractors/go/index.js";
import type { ComparatorEvidence } from "../comparator/types.js";

/** Source evidence for one real import edge (§7.1 click detail). */
export interface EdgeEvidence {
  /** Repo-relative source file containing the import. */
  file: string;
  /** 1-based line number of the import. */
  line: number;
  /** The import statement (Python: exact text; TS/Go: written form). */
  statement: string;
}

export interface CollectedEvidence {
  evidence: ComparatorEvidence;
  edgeEvidence: Map<string, EdgeEvidence>;
}

function tsStatement(kind: string, specifier: string): string {
  switch (kind) {
    case "export-from":
      return `export ... from "${specifier}"`;
    case "require":
      return `require("${specifier}")`;
    case "dynamic-import":
      return `import("${specifier}")`;
    case "import-equals":
      return `import ... = require("${specifier}")`;
    default:
      return `import ... from "${specifier}"`;
  }
}

export async function collectEvidence(repoRoot: string): Promise<CollectedEvidence> {
  const edgeEvidence = new Map<string, EdgeEvidence>();
  const dynamicUnknowns: NonNullable<ComparatorEvidence["dynamicUnknowns"]> = [];
  const unknownImports: NonNullable<ComparatorEvidence["unknownImports"]> = [];
  const generatedEdges: NonNullable<ComparatorEvidence["generatedEdges"]> = [];

  // Python.
  const py = await extractPythonRepo(repoRoot);
  for (const e of py.edges) {
    edgeEvidence.set(`${e.from}\0${e.to}`, {
      file: e.from,
      line: e.evidence.line,
      statement: e.evidence.statement,
    });
  }
  for (const e of py.generatedExcludedEdges) {
    generatedEdges.push({ from: e.from, to: e.to });
  }
  for (const d of py.dynamicUnknown) {
    dynamicUnknowns.push({
      path: d.path,
      line: d.line,
      statement: d.statement,
      kind: d.kind,
    });
  }
  for (const u of py.unknownImports) {
    unknownImports.push({
      from: u.from,
      specifier: u.specifier,
      reason: u.reason,
      line: u.line,
      statement: u.statement,
    });
  }

  // TypeScript.
  const ts = await extractTypeScriptRepo(repoRoot);
  for (const e of ts.edges) {
    edgeEvidence.set(`${e.from}\0${e.to}`, {
      file: e.evidence.file,
      line: e.evidence.line,
      statement: tsStatement(e.kind, e.evidence.specifier),
    });
  }
  for (const e of ts.generatedEdges) {
    generatedEdges.push({ from: e.from, to: e.to });
  }
  for (const u of ts.unknowns) {
    unknownImports.push({
      from: u.from,
      specifier: u.specifier,
      reason: u.reason,
      line: u.line,
    });
  }

  // Go.
  const go = await extractGoRepo(repoRoot);
  for (const e of go.edges) {
    edgeEvidence.set(`${e.from}\0${e.to}`, {
      file: e.evidence.file,
      line: e.evidence.line,
      statement: `import "${e.evidence.importPath}"`,
    });
  }
  for (const e of go.generatedEdges) {
    generatedEdges.push({ from: e.from, to: e.to });
  }
  for (const u of go.unknowns) {
    unknownImports.push({
      from: u.from,
      specifier: u.importPath,
      reason: u.reason,
      line: u.line,
    });
  }

  return {
    evidence: { dynamicUnknowns, unknownImports, generatedEdges },
    edgeEvidence,
  };
}
