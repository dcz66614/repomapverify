/**
 * T005 identity tests (PROJECT_BOOK §4.2; PLAN T005).
 *
 * Covers: same-name separation, content-change-only-sha separation,
 * symlink merge + outside-symlink refusal, duplicate-content
 * separation, NFC normalization, per-platform case adapters, and the
 * Go root-package identity. All assertions are computed here from
 * node:crypto / the frozen contracts — never taken from the code
 * under test as its own oracle.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  computeContentSha256,
  computeModuleId,
  normalizeRelativePath,
} from "../../src/contracts/module.js";
import {
  caseOnlyDiffers,
  classifyRepoPath,
  compareNormalizedPaths,
  detectPlatformAdapter,
  groupByRealPath,
  IdentityRegistry,
  macosCaseAdapter,
  normalizeIdentityPath,
  posixCaseAdapter,
  probeCaseSensitivity,
  resolveRealPathInsideRepo,
  scanRepoFiles,
  unknownCaseAdapter,
  windowsCaseAdapter,
} from "../../src/identity/index.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function mkRepo(): string {
  return mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "t005-identity-"));
}

describe("module_id / content_sha256 separation", () => {
  test("same-name different-path modules stay separate", () => {
    const reg = new IdentityRegistry();
    const a = reg.register({
      language: "python",
      relativePath: "lib/utils.py",
      contentSha256: computeContentSha256("x = 1\n"),
    });
    const b = reg.register({
      language: "python",
      relativePath: "shop/utils.py",
      contentSha256: computeContentSha256("x = 1\n"),
    });
    expect(a.moduleId).not.toBe(b.moduleId);
    expect(a.moduleId).toBe(computeModuleId("python", "lib/utils.py"));
    expect(b.moduleId).toBe(computeModuleId("python", "shop/utils.py"));
    // Same language+path in another language is a different module.
    const c = reg.register({
      language: "typescript",
      relativePath: "lib/utils.py",
      contentSha256: computeContentSha256("x = 1\n"),
    });
    expect(c.moduleId).not.toBe(a.moduleId);
    expect(reg.all()).toHaveLength(3);
  });

  test("changing file content changes ONLY content_sha256, never module_id", () => {
    const reg = new IdentityRegistry();
    const before = reg.register({
      language: "python",
      relativePath: "billing/api.py",
      contentSha256: computeContentSha256("v1"),
    });
    // Capture the values: register() returns the (mutated) record itself.
    const beforeId = before.moduleId;
    const beforeHash = before.contentSha256;
    const after = reg.register({
      language: "python",
      relativePath: "billing/api.py",
      contentSha256: computeContentSha256("v2 — changed"),
    });
    expect(after.moduleId).toBe(beforeId);
    expect(after.contentSha256).toBe(sha256("v2 — changed"));
    expect(after.contentSha256).not.toBe(beforeHash);
    // updateContent has the same contract.
    const updated = reg.updateContent(before.moduleId, sha256("v3"));
    expect(updated?.moduleId).toBe(before.moduleId);
    expect(updated?.contentSha256).toBe(sha256("v3"));
    expect(reg.updateContent("0".repeat(64), sha256("x"))).toBeUndefined();
  });

  test("identical content in different paths is still two modules (+ DUPLICATE_CONTENT signal)", () => {
    const reg = new IdentityRegistry();
    const content = computeContentSha256("same bytes\n");
    const a = reg.register({ language: "python", relativePath: "a/one.py", contentSha256: content });
    const b = reg.register({ language: "python", relativePath: "b/two.py", contentSha256: content });
    expect(a.moduleId).not.toBe(b.moduleId);
    const groups = reg.findDuplicateContent();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.contentSha256).toBe(content);
    expect(groups[0]?.moduleIds).toEqual([a.moduleId, b.moduleId].sort());
    expect(groups[0]?.relativePaths).toEqual(["a/one.py", "b/two.py"]);
    // A unique-content module never appears in a group.
    reg.register({ language: "python", relativePath: "c/three.py", contentSha256: computeContentSha256("other") });
    expect(reg.findDuplicateContent()).toHaveLength(1);
  });

  test("Go root package: relativePath '.' has module_id over ''", () => {
    const reg = new IdentityRegistry();
    const root = reg.register({
      language: "go",
      relativePath: ".",
      contentSha256: computeContentSha256("pkg"),
      nodeKind: "package",
    });
    expect(root.identityPath).toBe("");
    expect(root.relativePath).toBe(".");
    expect(root.moduleId).toBe(computeModuleId("go", ""));
    expect(root.moduleId).toBe(sha256("go\0"));
  });
});

describe("path normalization", () => {
  test("Unicode NFC first: NFD and NFC spellings are one identity", () => {
    const nfd = "cafe\u0301.py"; // e + combining acute
    const nfc = "café.py";
    expect(nfd).not.toBe(nfc);
    expect(normalizeRelativePath(nfd)).toBe(nfc);
    expect(normalizeIdentityPath(nfd)).toBe(nfc);
    expect(compareNormalizedPaths(nfd, nfc)).toBe(0);
    const reg = new IdentityRegistry();
    const a = reg.register({
      language: "python",
      relativePath: nfd,
      contentSha256: computeContentSha256("x"),
    });
    const b = reg.getByPath("python", nfc);
    expect(b?.moduleId).toBe(a.moduleId);
    expect(reg.all()).toHaveLength(1);
    expect(reg.all()[0]?.relativePath).toBe(nfc);
  });

  test("normalization is idempotent and order-independent (property-style sweep)", () => {
    const dirs = ["a", "A", "pkg", "café", "x.y", "deep/nest"];
    const names = ["mod.py", "Util.py", "util.py", "a-b_c.py", "café.py", "cafe\u0301.py"];
    const seen = new Map<string, string>();
    for (const d of dirs) {
      for (const n of names) {
        const raw = `./${d}\\${n}`;
        const norm = normalizeRelativePath(raw);
        expect(normalizeRelativePath(norm)).toBe(norm); // idempotent
        expect(normalizeRelativePath(`.${"/"}${norm}`)).toBe(norm);
        const id = computeModuleId("python", norm);
        const prev = seen.get(norm);
        if (prev !== undefined) expect(prev).toBe(id);
        else seen.set(norm, id);
      }
    }
    // Distinct normalized paths => distinct module_ids (posix adapter).
    expect(new Set(seen.values()).size).toBe(seen.size);
  });

  test("case handling comes only from the adapter, never guessed", () => {
    // Windows adapter folds: two case spellings are ONE module.
    const win = new IdentityRegistry(windowsCaseAdapter());
    win.register({ language: "python", relativePath: "Foo/Bar.py", contentSha256: sha256("1") });
    const folded = win.register({ language: "python", relativePath: "foo/bar.py", contentSha256: sha256("1") });
    expect(win.all()).toHaveLength(1);
    expect(folded.moduleId).toBe(win.moduleIdFor("python", "Foo/Bar.py"));
    expect(folded.moduleId).toBe(win.moduleIdFor("python", "foo/bar.py"));
    expect(win.all()[0]?.aliases).toEqual(["foo/bar.py"]);

    // POSIX adapter: the same two spellings are TWO modules.
    const posix = new IdentityRegistry(posixCaseAdapter());
    posix.register({ language: "python", relativePath: "Foo/Bar.py", contentSha256: sha256("1") });
    posix.register({ language: "python", relativePath: "foo/bar.py", contentSha256: sha256("1") });
    expect(posix.all()).toHaveLength(2);

    // Unknown adapter: never folds, reports the ambiguity instead.
    const unknown = new IdentityRegistry(unknownCaseAdapter());
    expect(unknown.caseAdapter.caseSensitivity).toBe("unknown");
    unknown.register({ language: "python", relativePath: "Foo/Bar.py", contentSha256: sha256("1") });
    unknown.register({ language: "python", relativePath: "foo/bar.py", contentSha256: sha256("1") });
    expect(unknown.all()).toHaveLength(2);
    expect(caseOnlyDiffers("Foo/Bar.py", "foo/bar.py")).toBe(true);
    expect(caseOnlyDiffers("Foo/Bar.py", "Foo/Baz.py")).toBe(false);
  });

  test("platform detection + live probe agree on this Linux VM", () => {
    expect(detectPlatformAdapter("linux").caseSensitivity).toBe("sensitive");
    expect(detectPlatformAdapter("win32").caseSensitivity).toBe("insensitive");
    expect(detectPlatformAdapter("darwin").caseSensitivity).toBe("insensitive");
    expect(macosCaseAdapter().fold("Ab/Cd.py")).toBe("ab/cd.py");
    expect(probeCaseSensitivity(process.env.TMPDIR ?? tmpdir())).toBe("sensitive");
  });
});

describe("symlinks", () => {
  test("same physical file via multiple in-repo paths merges to ONE module, alias retained", () => {
    const repo = mkRepo();
    try {
      mkdirSync(join(repo, "pkg"), { recursive: true });
      writeFileSync(join(repo, "pkg", "mod.py"), "x = 1\n");
      symlinkSync(join(repo, "pkg", "mod.py"), join(repo, "linkmod.py"));
      expect(classifyRepoPath(repo, "linkmod.py")).toBe("symlink-inside");
      expect(readlinkSync(join(repo, "linkmod.py"))).toBe(join(repo, "pkg", "mod.py"));

      const real = realpathSync(join(repo, "pkg", "mod.py"));
      const content = computeContentSha256("x = 1\n");

      // Order 1: real path first, then symlink.
      const r1 = new IdentityRegistry();
      r1.register({ language: "python", relativePath: "pkg/mod.py", contentSha256: content, realPath: real });
      const merged1 = r1.register({ language: "python", relativePath: "linkmod.py", contentSha256: content, realPath: real });
      expect(r1.all()).toHaveLength(1);
      // Canonical = smallest path ("linkmod.py" < "pkg/mod.py").
      expect(merged1.relativePath).toBe("linkmod.py");
      expect(merged1.aliases).toEqual(["pkg/mod.py"]);
      expect(merged1.moduleId).toBe(r1.moduleIdFor("python", "linkmod.py"));

      // Order 2: symlink first, then real path — same final module_id.
      const r2 = new IdentityRegistry();
      r2.register({ language: "python", relativePath: "linkmod.py", contentSha256: content, realPath: real });
      const merged2 = r2.register({ language: "python", relativePath: "pkg/mod.py", contentSha256: content, realPath: real });
      expect(r2.all()).toHaveLength(1);
      expect(merged2.moduleId).toBe(merged1.moduleId);
      expect(merged2.relativePath).toBe("linkmod.py");
      expect(merged2.aliases).toEqual(["pkg/mod.py"]);

      // registerAlias path: register the real file only, then attach the alias.
      const r3 = new IdentityRegistry();
      r3.register({ language: "python", relativePath: "pkg/mod.py", contentSha256: content, realPath: real });
      const aliased = r3.registerAlias("python", "linkmod.py", real);
      expect(aliased?.moduleId).toBe(merged1.moduleId);
      expect(r3.all()).toHaveLength(1);
      expect(r3.registerAlias("python", "ghost.py", join(repo, "no-such-file.py"))).toBeUndefined();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("symlinks pointing OUTSIDE the repo are never followed; the link is not a module", () => {
    const repo = mkRepo();
    const outside = mkRepo();
    try {
      writeFileSync(join(outside, "secret.py"), "x = 1\n");
      symlinkSync(join(outside, "secret.py"), join(repo, "ext.py"));
      expect(classifyRepoPath(repo, "ext.py")).toBe("symlink-outside");
      expect(resolveRealPathInsideRepo(repo, "ext.py")).toBeUndefined();
      const entries = scanRepoFiles(repo);
      const ext = entries.find((e) => e.relativePath === "ext.py");
      expect(ext?.symlinkClass).toBe("symlink-outside");
      expect(ext?.realPath).toBeUndefined();
      // No physical group contains the outside file.
      const groups = groupByRealPath(entries);
      expect(groups.flatMap((g) => g.paths)).not.toContain("ext.py");
      // A directory symlink out of the repo is classified, never descended.
      mkdirSync(join(outside, "pkgdir"));
      writeFileSync(join(outside, "pkgdir", "a.py"), "x = 1\n");
      symlinkSync(join(outside, "pkgdir"), join(repo, "extdir"));
      expect(classifyRepoPath(repo, "extdir")).toBe("symlink-dir-outside");
      const entries2 = scanRepoFiles(repo);
      expect(entries2.map((e) => e.relativePath)).not.toContain("extdir/a.py");
      expect(existsSync(join(repo, "extdir", "a.py"))).toBe(true); // the OS resolves it; we do not scan it
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("broken symlinks are reported, not silently dropped", () => {
    const repo = mkRepo();
    try {
      symlinkSync(join(repo, "missing.py"), join(repo, "broken.py"));
      expect(classifyRepoPath(repo, "broken.py")).toBe("symlink-broken");
      expect(resolveRealPathInsideRepo(repo, "broken.py")).toBeUndefined();
      const entries = scanRepoFiles(repo);
      expect(entries.find((e) => e.relativePath === "broken.py")?.symlinkClass).toBe(
        "symlink-broken",
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
