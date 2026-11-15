/**
 * T012 offline tests (PROJECT_BOOK §9, §10.2 "外部请求 0"; PLAN T012).
 *
 * Method used (stated exactly, per the task): the audit runs inside
 * a Linux network namespace created with `unshare -n`. That
 * namespace contains ONLY the loopback interface, in state DOWN —
 * no interface can carry traffic, so the audit provably completes
 * with NO network available. `unshare -n` was verified permitted on
 * this VM (exit 0, no privileges needed for a user+net namespace
 * pair created this way). No `env -i` fallback is used: the
 * namespace method is stronger (it removes the network itself,
 * not just the proxy variables).
 *
 * Proven here:
 * 1. `unshare -n` is permitted (a probe command exits 0).
 * 2. Inside the namespace there is no usable network: /proc/net/dev
 *    lists only `lo`, and a fetch() to http://example.com/ rejects
 *    (no route / no DNS), i.e. the namespace is really isolated.
 * 3. The demo audit inside the namespace exits 1 (FAIL, the correct
 *    code for the intentionally-wrong demo map) and its report's
 *    canonicalSemanticHash is IDENTICAL to the online run's hash.
 * 4. The control fixture py-c01 audits to PASS (exit 0) inside the
 *    namespace as well.
 * 5. Code-level proof, re-run here (same pattern as the S0 gate's
 *    network grep): no network-call token occurs anywhere in src/
 *    or scripts/ — the product cannot call the network even if one
 *    were present. The grep scans only src/ + scripts/, so the
 *    literal pattern in this test file cannot self-match.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "..", "..");
const CLI = join(SRC_DIR, "dist", "cli.js");
const DEMO_REPO = join(SRC_DIR, "demo", "repo");
const DEMO_MAP = join(SRC_DIR, "demo", "claimed-map.json");
const CONTROL_DIR = join(
  SRC_DIR,
  "tests",
  "fixtures",
  "s0",
  "python",
  "py-c01-basic-imports",
);

// Same network-call token pattern as scripts/s0-gate.mjs (assembled
// from fragments there so the gate file does not self-match; here the
// literal form is safe because grep only scans src/ + scripts/).
const NET_PATTERN =
  "https?://|\\bfetch\\s*\\(|WebSocket|node:http|node:https|node:net|node:dns|XMLHttpRequest|axios|node-fetch|undici";

function tmpOut(): string {
  return mkdtempSync(join(tmpdir(), "repomapverify-t012-offline-"));
}

function run(
  args: string[],
  opts: { env?: Record<string, string>; cwd?: string } = {},
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(args[0], args.slice(1), {
    encoding: "utf8",
    cwd: opts.cwd ?? SRC_DIR,
    env: { ...process.env, ...opts.env },
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function audit(
  repo: string,
  map: string,
  netns: boolean,
): { status: number | null; stdout: string; json: any } {
  const out = tmpOut();
  const cliArgs = ["audit", "--repo", repo, "--map", map, "--out", out];
  const r = netns
    ? run(["unshare", "-n", process.execPath, CLI, ...cliArgs])
    : run([process.execPath, CLI, ...cliArgs]);
  const jsonPath = join(out, "repomapverify-report.json");
  return {
    status: r.status,
    stdout: r.stdout,
    json: existsSync(jsonPath)
      ? JSON.parse(readFileSync(jsonPath, "utf8"))
      : null,
  };
}

describe("T012 offline — network-namespace proof (unshare -n)", () => {
  test("unshare -n is permitted on this VM", () => {
    const r = run(["unshare", "-n", "true"]);
    expect(r.status).toBe(0);
  });

  test("inside the namespace there is no usable network", () => {
    // Only the loopback interface exists, and it is DOWN.
    const dev = run(["unshare", "-n", "cat", "/proc/net/dev"]);
    expect(dev.status).toBe(0);
    const ifaces = dev.stdout
      .split("\n")
      .filter((l) => l.includes(":"))
      .map((l) => l.split(":")[0]?.trim())
      .filter((n): n is string => Boolean(n));
    expect(ifaces).toEqual(["lo"]);
    // A real fetch attempt fails: no route and no DNS in the namespace.
    const fetchProbe = run([
      "unshare",
      "-n",
      process.execPath,
      "-e",
      "fetch('http://example.com/').then(()=>{console.log('REACHABLE');process.exit(1)}).catch(e=>{console.log('UNREACHABLE:'+(e.cause?.code||e.message))})",
    ]);
    expect(fetchProbe.status).toBe(0);
    expect(fetchProbe.stdout).toMatch(/^UNREACHABLE:/);
    expect(fetchProbe.stdout).not.toContain("REACHABLE\n");
  });

  test("demo audit offline exits 1 with the identical report hash", () => {
    const online = audit(DEMO_REPO, DEMO_MAP, false);
    expect(online.status).toBe(1);
    expect(online.json.status).toBe("FAIL");
    expect(typeof online.json.canonicalSemanticHash).toBe("string");

    const offline = audit(DEMO_REPO, DEMO_MAP, true);
    expect(offline.status).toBe(1);
    expect(offline.json.status).toBe("FAIL");
    expect(offline.json.canonicalSemanticHash).toBe(
      online.json.canonicalSemanticHash,
    );
    expect(offline.json.findings).toEqual(online.json.findings);
  });

  test("control fixture audits to PASS (exit 0) inside the namespace", () => {
    const offline = audit(
      join(CONTROL_DIR, "repo"),
      join(CONTROL_DIR, "claimed-map.json"),
      true,
    );
    expect(offline.status).toBe(0);
    expect(offline.json.status).toBe("PASS");
    expect(offline.json.findings).toEqual([]);
  });

  test("code-level proof: no network-call token in src/ or scripts/", () => {
    const grep = run(["grep", "-rn", "-E", NET_PATTERN, "src", "scripts"]);
    expect(grep.status).toBe(1); // grep exit 1 = no matches
    expect(grep.stdout.trim()).toBe("");
  });
});
