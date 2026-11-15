/**
 * T003 deterministic parse samples runner.
 *
 * Runs the TS + Go extractors over the fixed sample repos in
 * 03_evidence/T003/samples/ (ts-01..ts-06, go-01..go-06, go-05-nomod),
 * twice each, and:
 *   - asserts the two runs are byte-identical (determinism),
 *   - asserts the hand-reasoned expected outcome per sample (module /
 *     edge / unknown / excluded counts recorded below — authored by
 *     reasoning about the sample sources, not by running the extractor),
 *   - writes a slim JSON output per sample next to its input.
 *
 * Usage: node scripts/poc-samples-t003.mjs
 * Exit 0 = all samples match expectations and are deterministic.
 */
import { createHash } from "node:crypto";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractTypeScriptRepo } from "../dist/extractors/typescript/index.js";
import { extractGoRepo } from "../dist/extractors/go/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SAMPLES_DIR = join(ROOT, "03_evidence", "T003", "samples");

function slim(lang, r) {
  const modules = (r.modules ?? r.packages ?? []).map((d) => ({
    path: d.module.relativePath,
    moduleId: d.module.moduleId,
    contentSha256: d.module.contentSha256,
    nodeKind: d.module.nodeKind,
    isGenerated: d.module.isGenerated,
    isEntrypoint: d.module.isEntrypoint,
    parseStatus: d.module.parseStatus,
    ...(lang === "typescript"
      ? { isDeclarationFile: d.isDeclarationFile }
      : { packageName: d.packageName, hasCgo: d.hasCgo, files: d.files }),
  }));
  return {
    language: lang,
    modules,
    edges: r.edges,
    generatedEdges: r.generatedEdges,
    externalImportCount: r.externalImportCount,
    unknowns: r.unknowns,
    ...(lang === "go" ? { excludedFiles: r.excludedFiles, modulePath: r.modulePath } : {}),
  };
}

// Hand-reasoned expectations per sample (see sample sources).
const EXPECTED = {
  "ts-01": { modules: 11, edges: 9, typeOnlyEdges: 1, generatedEdges: 0, external: 1, unknowns: 1, unknownReasons: ["DYNAMIC_IMPORT_UNKNOWN"] },
  "ts-02": { modules: 8, edges: 6, typeOnlyEdges: 1, generatedEdges: 0, external: 0, unknowns: 0, unknownReasons: [] },
  "ts-03": { modules: 4, edges: 3, typeOnlyEdges: 0, generatedEdges: 0, external: 0, unknowns: 0, unknownReasons: [] },
  "ts-04": { modules: 3, edges: 2, typeOnlyEdges: 0, generatedEdges: 0, external: 0, unknowns: 0, unknownReasons: [] },
  "ts-05": { modules: 2, edges: 1, typeOnlyEdges: 0, generatedEdges: 0, external: 0, unknowns: 2, unknownReasons: ["ALIAS_NOT_RESOLVED", "TARGET_NOT_FOUND"] },
  "ts-06": { modules: 4, edges: 2, typeOnlyEdges: 0, generatedEdges: 0, external: 0, unknowns: 0, unknownReasons: [] },
  "go-01": { modules: 9, edges: 6, typeOnlyEdges: 0, generatedEdges: 2, external: 8, unknowns: 0, unknownReasons: [], excluded: 2 },
  "go-02": { modules: 3, edges: 2, typeOnlyEdges: 0, generatedEdges: 0, external: 1, unknowns: 0, unknownReasons: [], excluded: 1 },
  "go-03": { modules: 2, edges: 1, typeOnlyEdges: 0, generatedEdges: 0, external: 2, unknowns: 0, unknownReasons: [], excluded: 0 },
  "go-04": { modules: 2, edges: 1, typeOnlyEdges: 0, generatedEdges: 0, external: 2, unknowns: 0, unknownReasons: [], excluded: 1 },
  "go-05": { modules: 2, edges: 1, typeOnlyEdges: 0, generatedEdges: 0, external: 0, unknowns: 2, unknownReasons: ["TARGET_PACKAGE_NOT_FOUND", "UNDECIDABLE_BUILD_CONSTRAINT"], excluded: 1 },
  "go-05-nomod": { modules: 1, edges: 0, typeOnlyEdges: 0, generatedEdges: 0, external: 0, unknowns: 1, unknownReasons: ["NO_GO_MOD"], excluded: 0 },
  "go-06": { modules: 3, edges: 2, typeOnlyEdges: 0, generatedEdges: 1, external: 0, unknowns: 0, unknownReasons: [], excluded: 1 },
};

async function main() {
  const names = readdirSync(SAMPLES_DIR).filter((n) => {
    try {
      return statSync(join(SAMPLES_DIR, n)).isDirectory();
    } catch {
      return false;
    }
  }).sort();
  let failures = 0;
  for (const name of names) {
    const lang = name.startsWith("ts-") ? "typescript" : "go";
    const dir = join(SAMPLES_DIR, name);
    const run = async () =>
      lang === "typescript" ? extractTypeScriptRepo(dir) : extractGoRepo(dir);
    const first = slim(lang, await run());
    const second = slim(lang, await run());
    const json1 = JSON.stringify(first);
    const json2 = JSON.stringify(second);
    const deterministic = json1 === json2;
    const exp = EXPECTED[name];
    const problems = [];
    if (!deterministic) problems.push("non-deterministic: two runs differ");
    if (exp === undefined) {
      problems.push("no hand-written expectation for this sample");
    } else {
      const check = (label, got, want) => {
        if (got !== want) problems.push(`${label} expected ${want} got ${got}`);
      };
      check("modules", first.modules.length, exp.modules);
      check("edges", first.edges.length, exp.edges);
      check("typeOnlyEdges", first.edges.filter((e) => e.typeOnly).length, exp.typeOnlyEdges);
      check("generatedEdges", first.generatedEdges.length, exp.generatedEdges);
      check("externalImportCount", first.externalImportCount, exp.external);
      check("unknowns", first.unknowns.length, exp.unknowns);
      const reasons = [...first.unknowns.map((u) => u.reason)].sort().join(",");
      if (reasons !== [...exp.unknownReasons].sort().join(",")) {
        problems.push(`unknown reasons expected [${exp.unknownReasons.join(", ")}] got [${reasons}]`);
      }
      if (exp.excluded !== undefined) {
        check("excludedFiles", (first.excludedFiles ?? []).length, exp.excluded);
      }
    }
    const outPath = join(SAMPLES_DIR, `${name}-output.json`);
    writeFileSync(outPath, JSON.stringify(first, null, 2) + "\n");
    const hash = createHash("sha256").update(json1).digest("hex").slice(0, 16);
    const ok = problems.length === 0;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name} (${lang}) modules=${first.modules.length} edges=${first.edges.length} genEdges=${first.generatedEdges.length} external=${first.externalImportCount} unknowns=${first.unknowns.length} deterministic=${deterministic} outHash=${hash}`);
    for (const p of problems) console.log(`        - ${p}`);
  }
  console.log(`\nSAMPLES: ${names.length} samples, ${names.length - failures} pass, ${failures} fail`);
  if (failures > 0) process.exitCode = 1;
}

await main();
