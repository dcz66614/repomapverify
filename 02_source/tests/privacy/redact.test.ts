/**
 * T008 — privacy redaction tests (PROJECT_BOOK §4.2 rule 5, §9;
 * PLAN §7.3).
 *
 * The guarantee under test: an absolute path + username in the input
 * NEVER leaks into the output. The realistic test path is
 * /home/alice/... — `alice` is the username and must not appear
 * anywhere in redacted output, not even inside a longer path.
 */
import { describe, expect, test } from "vitest";
import {
  findLeaks,
  redactForOutput,
  redactText,
  redactValue,
} from "../../src/privacy/redact.js";

const HOME = "/home/alice";
const REPO = "/home/alice/work/billing-service";

describe("privacy redaction", () => {
  test("absolute path + username in the input never leaks into the output", () => {
    const input = {
      schema: "repomapverify.report/v1",
      map_id: "agent-run-1",
      repo: "billing-service",
      repoRoot: `${REPO}`,
      findings: [
        {
          id: "HALLUCINATED_EDGE",
          from: `${REPO}/billing/api.py`,
          to: `${REPO}/billing/refunds.py`,
          evidence: `imported at ${REPO}/billing/api.py:12 by alice`,
        },
      ],
      modules: [`${REPO}/billing/api.py`, `${HOME}/.cache/other.py`],
      note: "run by alice on her machine",
    };
    const out = redactForOutput(input, { repoRoot: REPO, homeDir: HOME }) as Record<
      string,
      unknown
    >;
    const text = JSON.stringify(out);
    // No absolute path and no username anywhere in the output.
    expect(text).not.toContain("/home/alice");
    expect(text).not.toContain("alice");
    expect(text).not.toContain(REPO);
    expect(findLeaks(out, { repoRoot: REPO, homeDir: HOME })).toEqual([]);
    // Relative paths survive: repo files become repo-relative.
    expect((out["findings"] as { from: string }[])[0]?.from).toBe("billing/api.py");
    expect((out["modules"] as string[])[0]).toBe("billing/api.py");
    // A non-repo home path keeps its shape under ~, without the name.
    expect((out["modules"] as string[])[1]).toBe("~/.cache/other.py");
    // The username token is replaced by the stated placeholder.
    expect(out["note"]).toBe("run by <user> on her machine");
  });

  test("redactText: repo-root paths become relative, other absolute paths become the placeholder", () => {
    expect(
      redactText(`see ${REPO}/billing/api.py`, { repoRoot: REPO, homeDir: HOME }),
    ).toBe("see billing/api.py");
    expect(redactText("failed at /tmp/worker-7/out.log", { homeDir: HOME })).toBe(
      "failed at <redacted-absolute-path>",
    );
    expect(redactText("relative/billing/api.py stays", { homeDir: HOME })).toBe(
      "relative/billing/api.py stays",
    );
    expect(redactText(`home is ${HOME}`, { homeDir: HOME })).toBe("home is ~");
  });

  test("redactText: Windows absolute paths and usernames are redacted", () => {
    const out = redactText(
      String.raw`traceback at C:\Users\alice\work\billing-service\api.py, user alice`,
      { homeDir: "C:\\Users\\alice" },
    );
    expect(out).not.toContain("alice");
    expect(out).not.toContain("C:\\Users");
    // Under the home dir -> ~/... shape, without the name.
    expect(out).toBe(String.raw`traceback at ~/work\billing-service\api.py, user <user>`);
    // A Windows path outside any known root becomes the placeholder.
    expect(redactText(String.raw`see D:\data\secret.txt`, { homeDir: HOME })).toBe(
      "see <redacted-absolute-path>",
    );
    expect(redactText("see C:/Users/alice/x.py", { homeDir: "C:\\Users\\alice" })).not.toContain(
      "alice",
    );
  });

  test("redactText: https URLs are left untouched; file URLs are redacted", () => {
    const url = "https://example.com/api/v1/docs";
    expect(redactText(`see ${url}`, { homeDir: HOME })).toBe(`see ${url}`);
    expect(redactText(`file://${REPO}/billing/api.py`, { repoRoot: REPO })).toBe(
      "file://billing/api.py",
    );
  });

  test("redactText: a username inside an ordinary word is not touched", () => {
    // \b<username>\b only: "sample" never matches user "sam".
    expect(redactText("a sample of sampling", { username: "sam" })).toBe(
      "a sample of sampling",
    );
    expect(redactText("sam ran it", { username: "sam" })).toBe("<user> ran it");
  });

  test("redactValue: deep walk redacts keys and nested values without mutating input", () => {
    const input = { [`${REPO}/billing/api.py`]: { path: `${REPO}/x.py`, list: ["/etc/passwd"] } };
    const out = redactValue(input, { repoRoot: REPO, homeDir: HOME }) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(["billing/api.py"]);
    expect(JSON.stringify(out)).not.toContain("/home/alice");
    expect(JSON.stringify(input)).toContain(REPO); // input untouched
    expect(findLeaks(out, { repoRoot: REPO, homeDir: HOME })).toEqual([]);
  });

  test("findLeaks: reports kind + JSON path, never the sensitive text", () => {
    const leaks = findLeaks(
      { modules: [`${REPO}/billing/api.py`], note: "by alice" },
      { homeDir: HOME },
    );
    expect(leaks).toHaveLength(2);
    expect(leaks.map((l) => l.kind).sort()).toEqual(["home-dir", "username"]);
    expect(JSON.stringify(leaks)).not.toContain("alice");
    expect(JSON.stringify(leaks)).not.toContain("/home/alice");
    expect(findLeaks({ modules: ["billing/api.py"] }, { homeDir: HOME })).toEqual([]);
  });

  test("a clean relative-path report has no leaks and is unchanged", () => {
    const report = {
      schema: "repomapverify.report/v1",
      status: "FAIL",
      findings: [{ id: "HALLUCINATED_EDGE", from: "billing/api.py", to: "billing/refunds.py" }],
    };
    expect(redactForOutput(report, { homeDir: HOME })).toEqual(report);
    expect(findLeaks(report, { homeDir: HOME })).toEqual([]);
  });
});
