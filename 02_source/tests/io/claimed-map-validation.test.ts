/**
 * T008 — claimed-map/v1 strict schema validation tests
 * (PROJECT_BOOK §6.1, §6.4; IMPLEMENTATION_PLAN §4.1; PLAN T008).
 *
 * Rules under test: exact schema value; required mapId / repo /
 * completeness / repoSnapshotSha256 / modules / entrypoints / edges;
 * missing completeness/snapshot is an error, never guessed; unknown
 * or mistyped fields are errors NAMING the offending field; invalid
 * input is exit-code class 3 (CLAIMED_MAP_INPUT_EXIT_CODE); the
 * OPTIONAL `generated` boolean (T008 GENERATED_MISMATCH decision) is
 * accepted, a non-boolean is rejected; all 48 S0 fixture claimed
 * maps validate (Python fixtures use the documented snake_case
 * `map_id` alias and therefore carry exactly one warning each).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  CLAIMED_MAP_INPUT_EXIT_CODE,
  parseClaimedMapJson,
  validateClaimedMap,
} from "../../src/io/validate-claimed-map.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(HERE, "..", "fixtures", "s0");

const SNAP = "a".repeat(64);

function validMap(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "repomapverify.claimed-map/v1",
    mapId: "agent-run-1",
    repo: "billing-service",
    agent: "rea-0.9.1",
    completeness: "FULL_GRAPH",
    repoSnapshotSha256: SNAP,
    modules: [
      { id: "m1", path: "billing/api.py", kind: "module" },
      { id: "m2", path: "billing/auth.py", kind: "module" },
    ],
    entrypoints: ["billing/main.py"],
    edges: [{ from: "billing/api.py", to: "billing/auth.py" }],
    ...overrides,
  };
}

function errorFields(
  r: ReturnType<typeof validateClaimedMap>,
): string[] {
  return r.ok ? [] : r.errors.map((e) => e.field);
}

describe("claimed-map/v1 strict validation", () => {
  test("a valid map passes with no errors and no warnings", () => {
    const r = validateClaimedMap(validMap());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.map.mapId).toBe("agent-run-1");
      expect(r.map.completeness).toBe("FULL_GRAPH");
      expect(r.map.modules).toHaveLength(2);
    }
  });

  test("exit-code class for input errors is 3", () => {
    expect(CLAIMED_MAP_INPUT_EXIT_CODE).toBe(3);
  });

  test("wrong schema value is an error naming schema, never a silent pass", () => {
    const r = validateClaimedMap(validMap({ schema: "repomapverify.claimed-map/v2" }));
    expect(r.ok).toBe(false);
    expect(errorFields(r)).toContain("schema");
  });

  test("missing schema is an error naming schema", () => {
    const m = validMap();
    delete m["schema"];
    expect(errorFields(validateClaimedMap(m))).toContain("schema");
  });

  test("non-object input is an error at $", () => {
    expect(errorFields(validateClaimedMap("not a map"))).toEqual(["$"]);
    expect(errorFields(validateClaimedMap(null))).toEqual(["$"]);
    expect(errorFields(validateClaimedMap([1, 2]))).toEqual(["$"]);
  });

  test("missing completeness is an error, never guessed", () => {
    const m = validMap();
    delete m["completeness"];
    const r = validateClaimedMap(m);
    expect(r.ok).toBe(false);
    expect(errorFields(r)).toContain("completeness");
    if (!r.ok) {
      expect(r.errors.find((e) => e.field === "completeness")?.message).toMatch(
        /never guessed/,
      );
    }
  });

  test("unknown completeness value is an error naming completeness", () => {
    const r = validateClaimedMap(validMap({ completeness: "COMPLETE" }));
    expect(r.ok).toBe(false);
    expect(errorFields(r)).toContain("completeness");
  });

  test("missing snapshot is an error, never guessed", () => {
    const m = validMap();
    delete m["repoSnapshotSha256"];
    const r = validateClaimedMap(m);
    expect(r.ok).toBe(false);
    expect(errorFields(r)).toContain("repoSnapshotSha256");
  });

  test("malformed snapshot (not 64-hex) is an error naming repoSnapshotSha256", () => {
    for (const bad of ["abc", "A".repeat(64), "g".repeat(64), "a".repeat(63)]) {
      const r = validateClaimedMap(validMap({ repoSnapshotSha256: bad }));
      expect(r.ok).toBe(false);
      expect(errorFields(r)).toContain("repoSnapshotSha256");
    }
  });

  test("missing mapId / repo / modules / entrypoints / edges are errors naming the field", () => {
    for (const field of ["mapId", "repo", "modules", "entrypoints", "edges"]) {
      const m = validMap();
      delete m[field];
      expect(errorFields(validateClaimedMap(m))).toContain(field);
    }
  });

  test("unknown top-level field is an error listing the offending field", () => {
    const r = validateClaimedMap(validMap({ bogusField: 1 }));
    expect(r.ok).toBe(false);
    expect(errorFields(r)).toContain("bogusField");
  });

  test("unknown module / edge fields are errors listing the offending field", () => {
    const badModule = validMap({
      modules: [{ id: "m1", path: "a.py", kind: "module", weight: 3 }],
    });
    expect(errorFields(validateClaimedMap(badModule))).toContain("modules[0].weight");
    const badEdge = validMap({
      edges: [{ from: "a.py", to: "b.py", weight: 1 }],
    });
    expect(errorFields(validateClaimedMap(badEdge))).toContain("edges[0].weight");
  });

  test("mistyped fields are errors naming the field", () => {
    expect(errorFields(validateClaimedMap(validMap({ mapId: 42 })))).toContain("mapId");
    expect(errorFields(validateClaimedMap(validMap({ modules: "x" })))).toContain("modules");
    expect(
      errorFields(
        validateClaimedMap(validMap({ modules: [{ id: "m1", path: "a.py", kind: "file" }] })),
      ),
    ).toContain("modules[0].kind");
    expect(
      errorFields(
        validateClaimedMap(validMap({ edges: [{ from: "a.py", to: 7 }] })),
      ),
    ).toContain("edges[0].to");
    expect(
      errorFields(validateClaimedMap(validMap({ entrypoints: [null] }))),
    ).toContain("entrypoints[0]");
  });

  test("absolute and ..-escaping paths are errors, never normalized into the repo", () => {
    for (const bad of ["/home/alice/billing/api.py", "../escape.py", "C:\\Users\\alice\\a.py"]) {
      const r = validateClaimedMap(
        validMap({ modules: [{ id: "m1", path: bad, kind: "module" }] }),
      );
      expect(r.ok).toBe(false);
      expect(errorFields(r)).toContain("modules[0].path");
      // The error message must not echo the absolute path back.
      if (!r.ok) {
        expect(JSON.stringify(r.errors)).not.toContain("/home/alice");
        expect(JSON.stringify(r.errors)).not.toContain("alice");
      }
    }
    const r = validateClaimedMap(validMap({ edges: [{ from: "/tmp/x.py", to: "b.py" }] }));
    expect(errorFields(r)).toContain("edges[0].from");
  });

  test("duplicate module id / path are errors naming the field", () => {
    const dupId = validMap({
      modules: [
        { id: "m1", path: "a.py", kind: "module" },
        { id: "m1", path: "b.py", kind: "module" },
      ],
    });
    expect(errorFields(validateClaimedMap(dupId))).toContain("modules[1].id");
    const dupPath = validMap({
      modules: [
        { id: "m1", path: "a.py", kind: "module" },
        { id: "m2", path: "a.py", kind: "module" },
      ],
    });
    expect(errorFields(validateClaimedMap(dupPath))).toContain("modules[1].path");
  });

  test("duplicate edge is a warning + dedupe, not a silent misread", () => {
    const r = validateClaimedMap(
      validMap({
        edges: [
          { from: "billing/api.py", to: "billing/auth.py" },
          { from: "billing/api.py", to: "billing/auth.py" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.map.edges).toHaveLength(1);
      expect(r.warnings.map((w) => w.field)).toContain("edges[1]");
    }
  });

  test("Go root package '.' is accepted as an entrypoint / module path", () => {
    const r = validateClaimedMap(
      validMap({
        modules: [{ id: "m1", path: ".", kind: "package" }],
        entrypoints: ["."],
        edges: [],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.map.modules[0]?.path).toBe(".");
  });

  test("gitCommit, when present, must be 40- or 64-hex", () => {
    expect(validateClaimedMap(validMap({ gitCommit: "b".repeat(40) })).ok).toBe(true);
    expect(validateClaimedMap(validMap({ gitCommit: "b".repeat(64) })).ok).toBe(true);
    expect(errorFields(validateClaimedMap(validMap({ gitCommit: "xyz" })))).toContain(
      "gitCommit",
    );
  });

  test("optional generated boolean is accepted; non-boolean is an error naming the field", () => {
    const yes = validateClaimedMap(
      validMap({
        modules: [
          { id: "m1", path: "gen/pb.py", kind: "module", generated: true },
          { id: "m2", path: "hand.py", kind: "module", generated: false },
        ],
      }),
    );
    expect(yes.ok).toBe(true);
    if (yes.ok) {
      expect(yes.map.modules[0]?.generated).toBe(true);
      expect(yes.map.modules[1]?.generated).toBe(false);
    }
    const bad = validateClaimedMap(
      validMap({
        modules: [{ id: "m1", path: "a.py", kind: "module", generated: "yes" }],
      }),
    );
    expect(errorFields(bad)).toContain("modules[0].generated");
    // Absent generated means "no assertion" — the key is simply missing.
    const absent = validateClaimedMap(validMap());
    expect(absent.ok).toBe(true);
    if (absent.ok) expect("generated" in (absent.map.modules[0] ?? {})).toBe(false);
  });

  test("snake_case aliases are accepted with an explicit warning, never silently", () => {
    const r = validateClaimedMap(
      validMap({ mapId: undefined, map_id: "agent-run-1" } as Record<string, unknown>),
    );
    // validMap() already sets mapId; remove it first.
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.map.mapId).toBe("agent-run-1");
      expect(r.warnings.map((w) => w.field)).toContain("map_id");
    }
  });

  test("conflicting camelCase + snake_case spellings are an error naming both fields", () => {
    const m = validMap();
    (m as Record<string, unknown>)["map_id"] = "different-id";
    const r = validateClaimedMap(m);
    expect(r.ok).toBe(false);
    expect(errorFields(r)).toContain("mapId / map_id");
  });

  test("parseClaimedMapJson: invalid JSON is an input error, not a silent pass", () => {
    const r = parseClaimedMapJson("{ not json");
    expect(r.ok).toBe(false);
    expect(errorFields(r)).toEqual(["$"]);
    const ok = parseClaimedMapJson(JSON.stringify(validMap()));
    expect(ok.ok).toBe(true);
  });

  test("NFD path spelling is normalized to NFC with a warning", () => {
    const r = validateClaimedMap(
      validMap({
        // NFD spelling: e + combining acute (U+0301), not the NFC é.
        modules: [{ id: "m1", path: "pkg/cafe\u0301.py", kind: "module" }],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.map.modules[0]?.path).toBe("pkg/caf\u00e9.py");
      expect(r.warnings.map((w) => w.field)).toContain("modules[0].path");
    }
  });
});

describe("all 48 S0 fixture claimed maps validate", () => {
  test("every fixture claimed-map.json passes strict validation", () => {
    const failures: string[] = [];
    let snakeWarnings = 0;
    let total = 0;
    for (const lang of ["python", "typescript", "go"]) {
      const dir = join(FIXTURES_ROOT, lang);
      for (const name of readdirSync(dir).sort()) {
        const file = join(dir, name, "claimed-map.json");
        let raw: string;
        try {
          raw = readFileSync(file, "utf8");
        } catch {
          continue;
        }
        total++;
        const r = parseClaimedMapJson(raw);
        if (!r.ok) {
          failures.push(`${name}: ${r.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`);
        } else {
          snakeWarnings += r.warnings.filter((w) => w.field === "map_id").length;
        }
      }
    }
    expect(total).toBe(48);
    expect(failures).toEqual([]);
    // The 16 Python fixtures use the documented snake_case `map_id`
    // alias (PROJECT_BOOK §6.1 spelling); TS/Go use camelCase `mapId`.
    expect(snakeWarnings).toBe(16);
  });
});
