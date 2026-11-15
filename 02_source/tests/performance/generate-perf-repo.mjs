/**
 * T012 performance-repo generator (PROJECT_BOOK §10.3, PLAN T012).
 *
 * Generates a deterministic synthetic repo of exactly 1,000 modules /
 * 5,000 import edges, split across the three supported languages:
 *
 *   Python:      400 modules (main.py + m0000..m0398), 2,000 edges
 *   TypeScript:  300 modules (ts/main.ts + ts/m0000..m0298), 1,500 edges
 *   Go:          300 packages (cmd/main + gopkg/p0000..p0298), 1,500 edges
 *
 * The Go module path MUST contain a dot in its first segment
 * (`example.com/perfrepo`): the frozen extractor rule treats a
 * dot-less first segment as stdlib (PROJECT_BOOK §4.5 / T003), so a
 * bare `perfrepo/...` import would be counted external, not an edge.
 * The Go entrypoint is declared as the main.go FILE path
 * (`cmd/main/main.go`): the extractor matches a declared entrypoint
 * to its package by directory, exactly as the S0 Go fixtures do.
 * Construction is fully deterministic (fixed offsets, no RNG, no clock):
 * every library module imports exactly 5 targets at offsets
 * (1, 7, 13, 29, 61) mod N from its own index; each entrypoint module
 * imports targets 0..4. Offsets are non-zero and distinct mod N
 * (N = 399 / 299 / 299, all > 61), so every module has exactly 5
 * distinct targets and no self-edge. Total edges:
 *   (399 + 299 + 299) * 5 + 3 * 5 = 4,985 + 15 = 5,000.
 *
 * Every file's content differs from every other file's (distinct import
 * lists + distinct exported names), so no DUPLICATE_CONTENT finding is
 * expected. No dynamic imports, no generated code, no external imports
 * beyond the Go standard library (fmt is NOT imported; only intra-repo
 * packages are, so externalImportCount stays 0 for Go).
 *
 * Usage:
 *   node tests/performance/generate-perf-repo.mjs [outDir]
 * Defaults to $TMPDIR/perf-repo (TMPDIR defaults to the repo .tmp dir
 * when run through the T012 scripts). Prints the expected counts as
 * JSON on stdout: {"modules":1000,"edges":5000,"perLanguage":{...}}.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const EXPECTED = {
  modules: 1000,
  edges: 5000,
  perLanguage: {
    python: { modules: 400, edges: 2000 },
    typescript: { modules: 300, edges: 1500 },
    go: { modules: 300, edges: 1500 },
  },
};

const OFFSETS = [1, 7, 13, 29, 61];

function targets(index, count) {
  return OFFSETS.map((o) => (index + o) % count);
}

function pad(n, width = 4) {
  return String(n).padStart(width, "0");
}

export function generatePerfRepo(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // ---- Python: main.py + m0000..m0398 (399 lib modules) ----
  const PY_N = 399;
  for (let i = 0; i < PY_N; i++) {
    const lines = targets(i, PY_N).map((t) => `import m${pad(t)}`);
    lines.push("", `VALUE = ${i}`);
    writeFileSync(join(outDir, `m${pad(i)}.py`), lines.join("\n") + "\n");
  }
  writeFileSync(
    join(outDir, "main.py"),
    [0, 1, 2, 3, 4].map((t) => `import m${pad(t)}`).join("\n") +
      "\n\nVALUE = -1\n",
  );

  // ---- TypeScript: ts/main.ts + ts/m0000..m0298 (299 lib modules) ----
  const TS_N = 299;
  const tsDir = join(outDir, "ts");
  mkdirSync(tsDir, { recursive: true });
  for (let i = 0; i < TS_N; i++) {
    const lines = targets(i, TS_N).map(
      (t) => `import { v${pad(t)} } from "./m${pad(t)}";`,
    );
    lines.push(`export const v${pad(i)} = ${i};`);
    writeFileSync(join(tsDir, `m${pad(i)}.ts`), lines.join("\n") + "\n");
  }
  writeFileSync(
    join(tsDir, "main.ts"),
    [0, 1, 2, 3, 4]
      .map((t) => `import { v${pad(t)} } from "./m${pad(t)}";`)
      .join("\n") + "\nexport const entry = true;\n",
  );

  // ---- Go: cmd/main + gopkg/p0000..p0298 (299 lib packages) ----
  const GO_N = 299;
  const goDir = join(outDir, "gopkg");
  mkdirSync(goDir, { recursive: true });
  for (let i = 0; i < GO_N; i++) {
    const dir = join(goDir, `p${pad(i)}`);
    mkdirSync(dir, { recursive: true });
    const imports = targets(i, GO_N)
      .map((t) => `\t"example.com/perfrepo/gopkg/p${pad(t)}"`)
      .join("\n");
    const uses = targets(i, GO_N)
      .map((t) => `var _ = p${pad(t)}.Name`)
      .join("\n");
    writeFileSync(
      join(dir, "p.go"),
      `package p${pad(i)}\n\nimport (\n${imports}\n)\n\nconst Name = "p${pad(i)}"\n\n${uses}\n`,
    );
  }
  const cmdDir = join(outDir, "cmd", "main");
  mkdirSync(cmdDir, { recursive: true });
  const mainImports = [0, 1, 2, 3, 4]
    .map((t) => `\t"example.com/perfrepo/gopkg/p${pad(t)}"`)
    .join("\n");
  const mainUses = [0, 1, 2, 3, 4]
    .map((t) => `\t_ = p${pad(t)}.Name`)
    .join("\n");
  writeFileSync(
    join(cmdDir, "main.go"),
    `package main\n\nimport (\n${mainImports}\n)\n\nfunc main() {\n${mainUses}\n}\n`,
  );
  writeFileSync(join(outDir, "go.mod"), "module example.com/perfrepo\n\ngo 1.25\n");

  // ---- Entrypoint declaration (one per language) ----
  writeFileSync(
    join(outDir, ".repomapverify.toml"),
    '[entrypoints]\npaths = ["main.py", "ts/main.ts", "cmd/main/main.go"]\n',
  );

  return EXPECTED;
}

// CLI entry: node generate-perf-repo.mjs [outDir]
import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir =
    process.argv[2] ||
    join(process.env.TMPDIR || "/tmp", "perf-repo");
  const expected = generatePerfRepo(outDir);
  console.log(JSON.stringify({ outDir, ...expected }));
}
