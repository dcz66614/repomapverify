/**
 * T006 — Comparison engine: claimed map vs ground-truth graph
 * (PROJECT_BOOK §5.1–§5.2, §6.3; IMPLEMENTATION_PLAN T006).
 *
 * `compareMaps` is a pure function: (BuiltGraph, ClaimedMapV1,
 * ComparatorEvidence) -> AuditReportV1. It implements the audit rules
 * in the same order the independent Oracle and the S0 gate implement
 * them (`oracle/python/oracle.py`, `scripts/s0-gate.mjs`
 * `auditFromGT`), so it reproduces the expected audit status +
 * finding sets of all 48 S0 fixture goldens exactly. Where this
 * task's brief adds a rule the gate did not need to state (stale
 * snapshot short-circuit, BuiltGraph passthroughs), the rule is
 * marked DECIDED below with its rationale.
 *
 * Rules, in evaluation order:
 *
 * 1. STALE SNAPSHOT (DECIDED — task brief §2, spec §5.1): the
 *    claimed `repo_snapshot_sha256` is compared with the graph's via
 *    the frozen `checkSnapshot`. On ANY mismatch (including a missing
 *    declared snapshot) the audit short-circuits to INCOMPLETE with
 *    snapshotStatus STALE_SNAPSHOT and NO blame findings: the map
 *    describes a different tree, so no edge/module/entrypoint verdict
 *    in it may be blamed on the agent. Coverage verifiedClaims is 0
 *    (nothing was verified against this tree). This does not affect
 *    the S0 gate — all 48 golden snapshots MATCH.
 * 2. Claimed modules: a claimed path that resolves (through the
 *    spelling map: canonical path + symlink aliases) to a real module
 *    is real; anything else — including an absolute path or a ".."
 *    escape, which is never normalized into the repo — is
 *    HALLUCINATED_MODULE (P1). A claimed path that does not exist is
 *    HALLUCINATED, never UNKNOWN (spec §5.1: ENOENT is hallucination).
 *    A claimed `generated` assertion (T008) that disagrees with ground
 *    truth is a module-level GENERATED_MISMATCH (P2, FIX T013): it
 *    never flips the verdict and never reduces coverage — the module
 *    itself is verified, only the assertion is wrong.
 * 3. Claimed edges: a claimed (from, to) pair that matches a real
 *    core edge (after spelling resolution) is verified. A pair that
 *    matches a generated-code edge (evidence.generatedEdges) is
 *    GENERATED_MISMATCH (P2), not HALLUCINATED_EDGE: the edge exists,
 *    but only in generated code (spec §4.3/§4.4/§4.5 — "声称地图引用
 *    它时仍须核验存在性"). Every other claimed pair is
 *    HALLUCINATED_EDGE (P1).
 * 4. Entrypoints: WRONG_ENTRYPOINT (P1) fires ONLY when
 *    `.repomapverify.toml` explicitly declares entrypoints
 *    (built.declaredEntrypointPaths non-empty) and a claimed
 *    entrypoint is not among them. "Among them" accepts both
 *    spellings of a declared entrypoint: the module path it resolves
 *    to (Go package dir, e.g. "cmd/server") and the toml path as
 *    written (e.g. "cmd/server/main.go"). With no declaration there
 *    is no WRONG_ENTRYPOINT — see informationalFindings instead.
 *    (DECIDED — the S0 gate compares against resolved module paths
 *    only; accepting the literal toml spelling as well is strictly
 *    more lenient, and no golden exercises the difference.)
 * 5. FULL_GRAPH only (contract FULL_GRAPH_ONLY_FINDINGS): MISSING_EDGE
 *    for every real edge no claimed edge covers, and
 *    UNCLAIMED_REACHABLE_MODULE for every reachable module no claimed
 *    module mentions. Under PARTIAL_SUBGRAPH neither is ever emitted:
 *    absence in a clipped map is not an error.
 * 6. NAME_COLLISION_CONFUSION (P1, T004-evidence rule): for a
 *    HALLUCINATED_EDGE whose target is a REAL module, when a
 *    MISSING_EDGE from the same source has a target with the same
 *    basename — the map confused two same-named modules. A
 *    hallucinated target that does not exist at all is plain
 *    HALLUCINATED_EDGE/MODULE, never a collision (py-p08 proves it).
 *    Under PARTIAL_SUBGRAPH there are no MISSING_EDGEs, so no
 *    collision can fire either.
 * 7. UNKNOWN never yields PASS: DYNAMIC_IMPORT_UNKNOWN (P1, one
 *    finding per module, from evidence.dynamicUnknowns plus
 *    evidence.unknownImports with reason "DYNAMIC_IMPORT_UNKNOWN",
 *    deduplicated by path) and SOURCE_NOT_ENUMERATED (P1, one per
 *    module whose parseStatus is not OK: UNREADABLE / TOO_LARGE /
 *    PARSE_ERROR — spec §5.1 "跳过项转 finding") force INCOMPLETE.
 *    Any other unresolvable import (evidence.unknownImports with any
 *    other reason) also forces INCOMPLETE, with no dedicated finding:
 *    no finding type fits a resolved-but-unresolvable import, and the
 *    Oracle + gate agree the status carries it. An unreadable
 *    `.repomapverify.toml` (built.entrypointsDeclarationUnreadable,
 *    FIX P024 R1 P1-01 follow-up) likewise yields its own
 *    SOURCE_NOT_ENUMERATED finding for the toml file and forces
 *    INCOMPLETE: the entrypoint declaration is UNKNOWN, not absent —
 *    the repo must not be audited as if it had declared nothing.
 *    The same holds for a TypeScript resolution config that exists
 *    but could not be read or parsed
 *    (built.typescriptConfigProblems, FIX P024 R2 P1-01): one
 *    SOURCE_NOT_ENUMERATED finding per bad file, INCOMPLETE even
 *    when no import in the repo uses that config — the config is a
 *    promised resolution input, and its content is unknown, not
 *    empty. Imports that may depend on a bad config arrive as
 *    evidence.unknownImports with reason "CONFIG_UNREADABLE" and
 *    force INCOMPLETE through unknownImportsPresent as well.
 *    If a FAIL finding is also present the status is FAIL with the
 *    UNKNOWN findings still listed (FAIL+INCOMPLETE in the brief's
 *    wording — the report status is a single enum, so FAIL wins).
 * 8. BuiltGraph passthroughs (DECIDED — task brief §3, never silent):
 *    - duplicateContent -> DUPLICATE_CONTENT (P2), emitted in the
 *      INFORMATIONAL findings (see informationalFindings), NOT in the
 *      report's main findings. Reason: it is a property of the repo,
 *      not of the agent's claims — and py-p05's fixture deliberately
 *      gives lib/utils.py and shop/utils.py IDENTICAL content while
 *      its frozen golden expects exactly 3 findings (no
 *      DUPLICATE_CONTENT). Emitting it in the main list would break
 *      exact golden reproduction. Groups sharing the EMPTY-content
 *      hash (0-byte files, e.g. two empty __init__.py files, py-c05)
 *      are not reported at all: they share that hash trivially.
 *    - conflicts (same identity key, distinct physical files) ->
 *      NAME_COLLISION_CONFUSION (P1) each: two distinct files folded
 *      to one identity IS a name collision, and the type is FAIL-class
 *      per the frozen FAIL set, so the status follows the standard
 *      rule. The conflict detail is carried verbatim in the finding.
 *    - droppedEdges with reason UNKNOWN_ENDPOINT or
 *      CONFLICT_DROPPED_ENDPOINT -> INCOMPLETE (status only, no
 *      finding: no finding type fits a builder-dropped edge, and
 *      inventing one would misattribute it). SELF_EDGE drops are
 *      benign modelling (a self-import carries no inter-module
 *      information) and do not affect the status.
 *    - unresolvedEntrypoints (declared paths resolving to no module)
 *      -> INCOMPLETE (status only): reachability from them cannot be
 *      established. No WRONG_ENTRYPOINT is emitted for them — that
 *      finding is about the CLAIMED entrypoints, not the declaration.
 * 9. Status precedence (gate-exact): FAIL if any FAIL-class finding
 *    (src/findings FAIL_FINDING_IDS); else INCOMPLETE if any
 *    INCOMPLETE-forcing finding, any unresolvable import, any
 *    non-OK parseStatus, any unknown/conflict-dropped edge, any
 *    unresolved entrypoint, an unreadable entrypoint declaration,
 *    or an unreadable / malformed TypeScript resolution config;
 *    else PASS.
 * 10. Coverage: totalClaims = deduplicated claimed modules + claimed
 *     edges + claimed entrypoints. verifiedClaims = totalClaims minus
 *     the claim items a finding references (HALLUCINATED_MODULE for a
 *     module, HALLUCINATED_EDGE / GENERATED_MISMATCH for an edge,
 *     WRONG_ENTRYPOINT for an entrypoint). Omission findings
 *     (MISSING_EDGE etc.) are not claims, so they do not reduce
 *     coverage; un-verified items are never silently dropped from the
 *     denominator (spec §4.1).
 *
 * INFORMATIONAL findings (ISOLATED_MODULE, ENTRYPOINT_CANDIDATE,
 * DUPLICATE_CONTENT) are deliberately NOT in the report's findings
 * list. They are computed by `informationalFindings` and belong in
 * the report's own sections (spec §7.1: isolated modules get their
 * own section, "不得混进边列表"). The S0 goldens define the audit
 * finding set without them — controls must have exactly 0 findings,
 * the no-toml controls (ts-ctrl-08, go-ctrl-06) have every module
 * isolated and several entrypoint candidates, and py-p05's two utils
 * files deliberately share identical content — so emitting them in
 * the main list would break exact golden reproduction. They are
 * info-only by §5.2 (ISOLATED_MODULE) / repo-property findings
 * (DUPLICATE_CONTENT) and never change the status.
 */
import { checkSnapshot } from "../contracts/snapshot.js";
import { ENTRYPOINTS_TOML_FILENAME } from "../contracts/entrypoints.js";
import {
  isUnsafeRelativePath,
  normalizeRelativePath,
} from "../contracts/module.js";
import {
  FULL_GRAPH_ONLY_FINDINGS,
  type AuditStatus,
  type Finding,
} from "../contracts/findings.js";
import type { ClaimedMapV1 } from "../contracts/claimed-map.js";
import type { AuditReportV1 } from "../contracts/report.js";
import type { BuiltGraph } from "../graph/types.js";
import {
  dedupeFindings,
  duplicateContentFinding,
  dynamicImportUnknownFinding,
  entrypointCandidateFinding,
  generatedMismatchFinding,
  generatedModuleMismatchFinding,
  hallucinatedEdgeFinding,
  hallucinatedModuleFinding,
  isFailFinding,
  isolatedModuleFinding,
  makeFinding,
  missingEdgeFinding,
  nameCollisionConfusionFinding,
  sourceNotEnumeratedFinding,
  unclaimedReachableModuleFinding,
  wrongEntrypointFinding,
} from "../findings/findings.js";
import type { ComparatorEvidence } from "./types.js";

export interface ComparatorResult {
  report: AuditReportV1;
  /** ISOLATED_MODULE + ENTRYPOINT_CANDIDATE + DUPLICATE_CONTENT (info only, see header). */
  infoFindings: Finding[];
}

/** Basename of a repo-relative path (Go package dirs included). */
function basename(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

/** SHA-256 of empty content (0-byte files all share it). */
const EMPTY_CONTENT_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * Normalize a claimed / evidence path for comparison. The frozen
 * `normalizeRelativePath` collapses the Go root-package spelling "."
 * (and "./", "") to "" — the identity path — while the graph's display
 * path for the root package is ".". An empty normalized path can only
 * come from a root spelling, so it is read back as "." here; every
 * other path is unchanged. Without this, a claimed Go root package
 * (go-ctrl-08 claims ".") would never match the real "." module.
 */
function normalizeClaimPath(p: string): string {
  return normalizeRelativePath(p) || ".";
}

interface NormalizedClaim {
  modules: { path: string; jsonIndex: number; generated?: boolean }[];
  edges: { from: string; to: string; jsonIndex: number }[];
  entrypoints: { path: string; jsonIndex: number }[];
}

/** Deduplicate claimed items by normalized path/pair, keeping the first JSON index. */
function normalizeClaimed(claimed: ClaimedMapV1): NormalizedClaim {
  const modules: NormalizedClaim["modules"] = [];
  const seenModules = new Set<string>();
  claimed.modules.forEach((m, i) => {
    const path = normalizeClaimPath(m.path);
    if (seenModules.has(path)) return;
    seenModules.add(path);
    modules.push({
      path,
      jsonIndex: i,
      ...(m.generated !== undefined ? { generated: m.generated } : {}),
    });
  });
  const edges: NormalizedClaim["edges"] = [];
  const seenEdges = new Set<string>();
  claimed.edges.forEach((e, i) => {
    const from = normalizeClaimPath(e.from);
    const to = normalizeClaimPath(e.to);
    const key = `${from}\0${to}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ from, to, jsonIndex: i });
  });
  const entrypoints: NormalizedClaim["entrypoints"] = [];
  const seenEntries = new Set<string>();
  claimed.entrypoints.forEach((p, i) => {
    const path = normalizeClaimPath(p);
    if (seenEntries.has(path)) return;
    seenEntries.add(path);
    entrypoints.push({ path, jsonIndex: i });
  });
  return { modules, edges, entrypoints };
}

/**
 * Audit a claimed map against a built ground-truth graph.
 * Pure and deterministic: the same inputs always yield the same report.
 */
export function compareMaps(
  built: BuiltGraph,
  claimed: ClaimedMapV1,
  evidence: ComparatorEvidence = {},
): AuditReportV1 {
  return compareMapsDetailed(built, claimed, evidence).report;
}

/** Full comparison: the audit report plus the informational findings. */
export function compareMapsDetailed(
  built: BuiltGraph,
  claimed: ClaimedMapV1,
  evidence: ComparatorEvidence = {},
): ComparatorResult {
  const graph = built.graph;
  const normalized = normalizeClaimed(claimed);
  const totalClaims =
    normalized.modules.length +
    normalized.edges.length +
    normalized.entrypoints.length;

  const base = {
    schema: "repomapverify.report/v1" as const,
    mapId: claimed.mapId,
    completeness: claimed.completeness,
    groundTruth: { modules: graph.modules.size, edges: graph.edges.size },
    claimed: {
      modules: normalized.modules.length,
      edges: normalized.edges.length,
    },
  };

  // Rule 1 — stale snapshot short-circuits everything else.
  const snapshotStatus = checkSnapshot(
    {
      repoSnapshotSha256: claimed.repoSnapshotSha256,
      ...(claimed.gitCommit !== undefined ? { gitCommit: claimed.gitCommit } : {}),
    },
    {
      repoSnapshotSha256: graph.repoSnapshotSha256,
      ...(graph.gitCommit !== undefined ? { gitCommit: graph.gitCommit } : {}),
    },
  );
  if (snapshotStatus === "STALE_SNAPSHOT") {
    return {
      report: {
        ...base,
        status: "INCOMPLETE",
        snapshotStatus,
        coverage: { verifiedClaims: 0, totalClaims },
        findings: [],
      },
      infoFindings: [],
    };
  }

  // Spelling map: canonical path + every alias spelling -> module.
  const spellingToModule = new Map<string, { id: string; path: string }>();
  for (const m of graph.modules.values()) {
    spellingToModule.set(m.relativePath, { id: m.moduleId, path: m.relativePath });
    for (const alias of built.aliases.get(m.moduleId) ?? []) {
      spellingToModule.set(alias, { id: m.moduleId, path: m.relativePath });
    }
  }
  const resolve = (p: string) =>
    isUnsafeRelativePath(p) ? undefined : spellingToModule.get(p);
  const realEdges = new Set<string>();
  for (const e of graph.edges.values()) {
    const from = graph.modules.get(e.fromModuleId)?.relativePath;
    const to = graph.modules.get(e.toModuleId)?.relativePath;
    if (from !== undefined && to !== undefined) realEdges.add(`${from}\0${to}`);
  }

  // FIX P024 R1 P1-01 (spec §5.1: ENOENT is hallucination, an
  // unreadable path is not): paths hidden behind an unreadable file
  // or directory are UNKNOWN, not hallucinated. The auditor knows
  // its own enumeration is incomplete there (evidence.unknownImports
  // entries with reason "UNREADABLE", emitted by the extractors and
  // mirrored by the Oracle), so a claimed path that cannot be
  // resolved because it is hidden must not be blamed on the agent as
  // HALLUCINATED_MODULE / HALLUCINATED_EDGE. The SOURCE_NOT_ENUMERATED
  // finding (Rule 7) already records the blindness, and the audit is
  // INCOMPLETE. A path is hidden when it equals an unreadable path,
  // lies under one, or is a parent directory of one (a Go package
  // whose ONLY file is unreadable hides its package directory this
  // way). The repo root (".") hides everything.
  const hiddenPrefixes = (evidence.unknownImports ?? [])
    .filter((u) => u.reason === "UNREADABLE")
    .map((u) => normalizeClaimPath(u.from));
  const isHidden = (p: string): boolean =>
    hiddenPrefixes.some(
      (h) =>
        h === "." ||
        p === h ||
        p.startsWith(`${h}/`) ||
        h.startsWith(`${p}/`),
    );

  const findings: Finding[] = [];
  const unverifiedModules = new Set<string>();
  const unverifiedEdges = new Set<string>();
  const unverifiedEntrypoints = new Set<string>();

  // Rule 2 — claimed modules.
  const claimedCanonicalModules = new Set<string>();
  for (const m of normalized.modules) {
    const hit = resolve(m.path);
    if (hit === undefined) {
      // FIX P024 R1 P1-01: a hidden claimed path stays UNVERIFIED
      // (coverage drops — the claim was not verified) but yields no
      // HALLUCINATED_MODULE finding: the path may well exist behind
      // the unreadable directory or file.
      if (!isHidden(m.path)) {
        findings.push(
          hallucinatedModuleFinding(m.path, `modules[${m.jsonIndex}]`),
        );
      }
      unverifiedModules.add(m.path);
    } else {
      claimedCanonicalModules.add(hit.path);
      // FIX T013 (P2-01) — module-level GENERATED_MISMATCH (spec §5.2,
      // T008 decision record): a claimed `generated` assertion that
      // disagrees with ground truth is a P2 finding. It is deliberately
      // NOT added to unverifiedModules: the module itself is verified
      // to exist, only its generated-ness assertion is wrong — so the
      // finding never flips the verdict and never reduces coverage.
      // Absent assertion means no judgement.
      if (m.generated !== undefined) {
        const truth = graph.modules.get(hit.id);
        if (truth !== undefined && truth.isGenerated !== m.generated) {
          findings.push(
            generatedModuleMismatchFinding(
              hit.path,
              m.generated,
              truth.isGenerated,
              `modules[${m.jsonIndex}]`,
            ),
          );
        }
      }
    }
  }

  // Rule 3 — claimed edges.
  const generatedEdgeSet = new Set(
    (evidence.generatedEdges ?? []).map(
      (e) => `${normalizeClaimPath(e.from)}\0${normalizeClaimPath(e.to)}`,
    ),
  );
  const claimedEdgePairs = new Set<string>();
  const hallucinatedEdges: { from: string; to: string }[] = [];
  for (const e of normalized.edges) {
    const fromHit = resolve(e.from);
    const toHit = resolve(e.to);
    const pairKey =
      fromHit !== undefined && toHit !== undefined
        ? `${fromHit.path}\0${toHit.path}`
        : `${e.from}\0${e.to}`;
    claimedEdgePairs.add(pairKey);
    if (fromHit !== undefined && toHit !== undefined && realEdges.has(pairKey)) {
      continue; // verified
    }
    if (generatedEdgeSet.has(pairKey)) {
      findings.push(generatedMismatchFinding(e.from, e.to));
      unverifiedEdges.add(`${e.from}\0${e.to}`);
      continue;
    }
    // FIX P024 R1 P1-01: an edge touching a hidden endpoint cannot be
    // judged — the endpoint may well exist behind the unreadable
    // path. No HALLUCINATED_EDGE for it (the claim stays unverified
    // and the audit is INCOMPLETE via Rule 7).
    if (!isHidden(e.from) && !isHidden(e.to)) {
      findings.push(
        hallucinatedEdgeFinding(e.from, e.to, `edges[${e.jsonIndex}]`),
      );
      hallucinatedEdges.push({ from: e.from, to: e.to });
    }
    unverifiedEdges.add(`${e.from}\0${e.to}`);
  }

  // Rule 4 — entrypoints (only with an explicit declaration).
  const declaredModulePaths = built.declaredEntrypoints
    .map((id) => graph.modules.get(id)?.relativePath)
    .filter((p): p is string => p !== undefined);
  const acceptedEntrypoints = new Set<string>([
    ...declaredModulePaths,
    ...built.declaredEntrypointPaths,
  ]);
  const hasDeclaration = built.declaredEntrypointPaths.length > 0;
  if (hasDeclaration) {
    for (const ep of normalized.entrypoints) {
      if (!acceptedEntrypoints.has(ep.path)) {
        findings.push(
          wrongEntrypointFinding(
            ep.path,
            [...acceptedEntrypoints].sort(),
            `entrypoints[${ep.jsonIndex}]`,
          ),
        );
        unverifiedEntrypoints.add(ep.path);
      }
    }
  }

  // Rule 5 — FULL_GRAPH-only omissions.
  const missingEdges: { from: string; to: string }[] = [];
  if (claimed.completeness === "FULL_GRAPH") {
    // FULL_GRAPH_ONLY_FINDINGS is the frozen contract set; the two
    // findings below are its members (guarded so a contract change
    // cannot silently re-enable them under PARTIAL_SUBGRAPH).
    if (FULL_GRAPH_ONLY_FINDINGS.has("MISSING_EDGE")) {
      for (const key of [...realEdges].sort()) {
        if (!claimedEdgePairs.has(key)) {
          const [from, to] = key.split("\0") as [string, string];
          findings.push(missingEdgeFinding(from, to));
          missingEdges.push({ from, to });
        }
      }
    }
    if (FULL_GRAPH_ONLY_FINDINGS.has("UNCLAIMED_REACHABLE_MODULE")) {
      const reachablePaths = [...graph.reachableFromEntrypoints]
        .map((id) => graph.modules.get(id)?.relativePath)
        .filter((p): p is string => p !== undefined)
        .sort();
      for (const p of reachablePaths) {
        if (!claimedCanonicalModules.has(p)) {
          findings.push(unclaimedReachableModuleFinding(p));
        }
      }
    }
  }

  // Rule 6 — name-collision confusion (T004-evidence rule).
  for (const h of hallucinatedEdges) {
    const toHit = resolve(h.to);
    if (toHit === undefined) continue; // target is not a real module
    const hBase = basename(toHit.path);
    const fromHit = resolve(h.from);
    const hFromCanonical = fromHit?.path ?? h.from;
    for (const m of missingEdges) {
      if (m.from === hFromCanonical && basename(m.to) === hBase) {
        findings.push(nameCollisionConfusionFinding(h.from, h.to));
        break;
      }
    }
  }

  // Rule 7 — UNKNOWN findings.
  const dynamicPaths = new Map<string, string>();
  for (const d of evidence.dynamicUnknowns ?? []) {
    const p = normalizeClaimPath(d.path);
    if (!dynamicPaths.has(p)) {
      const where =
        d.line !== undefined
          ? ` (line ${d.line}${d.statement !== undefined ? `: ${d.statement}` : ""})`
          : "";
      const kind = d.kind !== undefined ? ` [${d.kind}]` : "";
      dynamicPaths.set(
        p,
        `module ${p} has a dynamic import whose target cannot be determined statically${kind}${where}; the audit is INCOMPLETE, not PASS`,
      );
    }
  }
  for (const u of evidence.unknownImports ?? []) {
    if (u.reason !== "DYNAMIC_IMPORT_UNKNOWN") continue;
    const p = normalizeClaimPath(u.from);
    if (!dynamicPaths.has(p)) {
      dynamicPaths.set(
        p,
        `module ${p} has a dynamic import (${u.specifier}) whose target cannot be determined statically; the audit is INCOMPLETE, not PASS`,
      );
    }
  }
  for (const [p, detail] of [...dynamicPaths.entries()].sort()) {
    findings.push(dynamicImportUnknownFinding(p, detail));
  }
  let hasBadParseStatus = false;
  for (const m of [...graph.modules.values()].sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : 1,
  )) {
    if (m.parseStatus !== "OK") {
      hasBadParseStatus = true;
      findings.push(sourceNotEnumeratedFinding(m.relativePath, m.parseStatus));
    }
  }
  // FIX P024 R1 P1-01 (spec §5.1 "跳过项转 finding"): an unreadable
  // PATH that never became a module — an unlistable directory, or a
  // Go file whose package could not be built around it — arrives as
  // an unknownImports entry with reason "UNREADABLE" (the extractors
  // emit it; the Oracle mirrors it). It gets its own
  // SOURCE_NOT_ENUMERATED finding naming the path, so the audit is
  // INCOMPLETE with the cause visible instead of PASSing over a hole
  // in the tree. (Entries that duplicate a module-loop finding for
  // the same path collapse in dedupeFindings below.)
  for (const u of evidence.unknownImports ?? []) {
    if (u.reason !== "UNREADABLE") continue;
    const path = normalizeClaimPath(u.from);
    findings.push(
      sourceNotEnumeratedFinding(
        path,
        "UNREADABLE",
        `source ${path} could not be enumerated (unreadable file or directory); its contents are unknown, so the audit is INCOMPLETE, not PASS`,
      ),
    );
  }
  // FIX P024 R1 P1-01 follow-up (unreadable .repomapverify.toml):
  // the entrypoint declaration is UNKNOWN, not absent. A repo whose
  // toml exists but cannot be read must not be audited as if it had
  // declared no entrypoints (that path can PASS via
  // ENTRYPOINT_CANDIDATE, with no WRONG_ENTRYPOINT check at all).
  // Its own SOURCE_NOT_ENUMERATED finding names the toml file, so
  // the INCOMPLETE verdict carries the cause instead of passing over
  // an unknown declaration.
  const hasUnreadableEntrypointsDeclaration =
    built.entrypointsDeclarationUnreadable === true;
  if (hasUnreadableEntrypointsDeclaration) {
    findings.push(
      sourceNotEnumeratedFinding(
        ENTRYPOINTS_TOML_FILENAME,
        "UNREADABLE",
        `entrypoint declaration ${ENTRYPOINTS_TOML_FILENAME} exists but could not be read; whether entrypoints are declared is unknown, so entrypoints cannot be verified and the audit is INCOMPLETE, not PASS`,
      ),
    );
  }
  // FIX P024 R2 P1-01 (unreadable / malformed TypeScript resolution
  // config): the config content is UNKNOWN, not absent. A repo whose
  // tsconfig.json or package.json exists but cannot be read or parsed
  // must not be audited as if it had no such config (that path can
  // PASS by classifying alias / self-reference imports as external
  // and silently dropping the edge). Each bad file gets its own
  // SOURCE_NOT_ENUMERATED finding naming it, so the INCOMPLETE
  // verdict carries the cause instead of passing over an unknown
  // resolution input. This fires even when no import uses the
  // config: whether any import depends on it is unknowable while
  // its content is unknown.
  const hasTypescriptConfigProblems =
    (built.typescriptConfigProblems ?? []).length > 0;
  for (const problem of built.typescriptConfigProblems ?? []) {
    findings.push(
      sourceNotEnumeratedFinding(
        problem.file,
        problem.status,
        `TypeScript resolution config ${problem.file} exists but could not be ${
          problem.status === "UNREADABLE" ? "read" : "parsed"
        }; its resolution rules are unknown, so alias and self-reference imports that may depend on it cannot be resolved and the audit is INCOMPLETE, not PASS`,
      ),
    );
  }

  // Rule 8 — BuiltGraph passthroughs (conflicts; duplicate content
  // lives in informationalFindings — see the header note).
  for (const conflict of built.conflicts) {
    // The conflict's verbatim record is the detail: the dropped
    // spelling and the disagreeing physical files must stay visible.
    findings.push(
      makeFinding("NAME_COLLISION_CONFUSION", `identity conflict: ${conflict.detail}`, {
        from: conflict.identityPath,
      }),
    );
  }

  const unknownImportsPresent = (evidence.unknownImports ?? []).some(
    (u) => u.reason !== "DYNAMIC_IMPORT_UNKNOWN",
  );
  const hasDroppedUnknownEdge = built.droppedEdges.some(
    (d) => d.reason === "UNKNOWN_ENDPOINT" || d.reason === "CONFLICT_DROPPED_ENDPOINT",
  );
  const hasUnresolvedEntrypoints = built.unresolvedEntrypoints.length > 0;

  const sortedFindings = dedupeFindings(findings);

  // Rule 9 — status precedence.
  let status: AuditStatus;
  if (sortedFindings.some((f) => isFailFinding(f.id))) {
    status = "FAIL";
  } else if (
    sortedFindings.some((f) => f.id === "DYNAMIC_IMPORT_UNKNOWN") ||
    sortedFindings.some((f) => f.id === "SOURCE_NOT_ENUMERATED") ||
    unknownImportsPresent ||
    hasBadParseStatus ||
    hasDroppedUnknownEdge ||
    hasUnresolvedEntrypoints ||
    // FIX P024 R1 P1-01 follow-up: an unreadable entrypoint
    // declaration forces INCOMPLETE in its own right (the
    // SOURCE_NOT_ENUMERATED finding above already does, via the
    // finding check — this names the cause explicitly, mirroring
    // hasUnresolvedEntrypoints).
    hasUnreadableEntrypointsDeclaration ||
    // FIX P024 R2 P1-01: an unreadable / malformed TypeScript
    // resolution config forces INCOMPLETE in its own right (the
    // SOURCE_NOT_ENUMERATED finding above already does, via the
    // finding check — this names the cause explicitly, mirroring
    // hasUnreadableEntrypointsDeclaration).
    hasTypescriptConfigProblems
  ) {
    status = "INCOMPLETE";
  } else {
    status = "PASS";
  }

  // Rule 10 — coverage.
  const verifiedClaims =
    totalClaims -
    unverifiedModules.size -
    unverifiedEdges.size -
    unverifiedEntrypoints.size;

  return {
    report: {
      ...base,
      status,
      snapshotStatus,
      coverage: { verifiedClaims, totalClaims },
      findings: sortedFindings,
    },
    infoFindings: informationalFindings(built, claimed),
  };
}

/**
 * Informational findings only: ISOLATED_MODULE (isolated AND unclaimed
 * real modules), ENTRYPOINT_CANDIDATE (graph roots, only when no
 * entrypoint is declared), and DUPLICATE_CONTENT (distinct modules
 * sharing non-empty identical content). Info-only — they never change
 * the audit status and are NOT part of the report's findings list
 * (see the header note: the S0 goldens define the audit finding set
 * without them, and py-p05's two utils files deliberately share
 * identical content). A report renderer shows them in their own
 * sections (spec §7.1). Empty files (0-byte content hash) are not
 * reported as duplicates: they share that hash trivially.
 */
export function informationalFindings(
  built: BuiltGraph,
  claimed: ClaimedMapV1,
): Finding[] {
  const findings: Finding[] = [];
  const normalized = normalizeClaimed(claimed);
  const claimedPaths = new Set(normalized.modules.map((m) => m.path));
  const spellingToCanonical = new Map<string, string>();
  for (const m of built.graph.modules.values()) {
    spellingToCanonical.set(m.relativePath, m.relativePath);
    for (const alias of built.aliases.get(m.moduleId) ?? []) {
      spellingToCanonical.set(alias, m.relativePath);
    }
  }
  const claimedCanonical = new Set<string>();
  for (const p of claimedPaths) {
    const hit = spellingToCanonical.get(p);
    if (hit !== undefined) claimedCanonical.add(hit);
  }
  const isolatedPaths = [...built.graph.isolatedModuleIds]
    .map((id) => built.graph.modules.get(id)?.relativePath)
    .filter((p): p is string => p !== undefined)
    .sort();
  for (const p of isolatedPaths) {
    if (!claimedCanonical.has(p)) findings.push(isolatedModuleFinding(p));
  }
  if (built.declaredEntrypointPaths.length === 0) {
    for (const candidate of built.entrypointCandidates) {
      findings.push(entrypointCandidateFinding(candidate));
    }
  }
  for (const group of built.duplicateContent) {
    if (group.contentSha256 === EMPTY_CONTENT_SHA256) continue;
    findings.push(
      duplicateContentFinding(group.relativePaths, group.contentSha256),
    );
  }
  return dedupeFindings(findings);
}
