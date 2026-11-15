/**
 * T006 — Finding construction and status predicates
 * (PROJECT_BOOK §5.1–§5.2; IMPLEMENTATION_PLAN T006).
 *
 * This module owns the 12 finding types as values: every type has a
 * builder here that stamps the spec-default severity from the frozen
 * contract (`FINDING_DEFAULT_SEVERITY`) and a deterministic sort order.
 * It does NOT decide audit policy (which findings fire, or the final
 * status) — that is the comparator's job (`src/comparator/compare.ts`).
 *
 * Severity / status rules carried from the frozen contract and the
 * S0 gate (`scripts/s0-gate.mjs`, FAIL_FINDING_IDS):
 *
 * - FAIL-class findings (confirmed fabrication / omission):
 *   HALLUCINATED_EDGE, HALLUCINATED_MODULE, WRONG_ENTRYPOINT,
 *   MISSING_EDGE, UNCLAIMED_REACHABLE_MODULE, NAME_COLLISION_CONFUSION.
 *   Any one of these makes the audit FAIL (PROJECT_BOOK §5.1).
 * - INCOMPLETE-forcing findings: DYNAMIC_IMPORT_UNKNOWN,
 *   SOURCE_NOT_ENUMERATED (contract INCOMPLETE_FORCING_FINDINGS).
 *   They never yield PASS; with a FAIL finding also present the
 *   report is FAIL carrying the UNKNOWN findings alongside it
 *   ("FAIL+INCOMPLETE" in the task's wording — the report status is
 *   a single enum, so FAIL wins and the UNKNOWN findings stay listed).
 * - P2 report findings that do NOT by themselves flip the status:
 *   DUPLICATE_CONTENT, GENERATED_MISMATCH, ISOLATED_MODULE. Per
 *   §5.1 FAIL is exactly "a confirmed hallucinated edge, wrong
 *   entrypoint, missing edge (FULL_GRAPH only) or unclaimed reachable
 *   module (FULL_GRAPH only)" (plus the gate's NAME_COLLISION_CONFUSION);
 *   DUPLICATE_CONTENT / GENERATED_MISMATCH are real defects of the
 *   repo / map that the report must list, but they are not in that
 *   enumeration. ISOLATED_MODULE is info-only by §5.2 ("does NOT by
 *   itself trigger FAIL").
 * - ENTRYPOINT_CANDIDATE is INFO: a hint, never WRONG_ENTRYPOINT
 *   evidence.
 */
import {
  FINDING_DEFAULT_SEVERITY,
  INCOMPLETE_FORCING_FINDINGS,
  type Finding,
  type FindingId,
  type FindingSeverity,
} from "../contracts/findings.js";

/**
 * Finding types that make the audit FAIL. This mirrors the S0 gate's
 * FAIL_FINDING_IDS exactly (`scripts/s0-gate.mjs`) and PROJECT_BOOK
 * §5.1's FAIL enumeration (plus NAME_COLLISION_CONFUSION, a confirmed
 * misattribution between two real modules).
 */
export const FAIL_FINDING_IDS: ReadonlySet<FindingId> = new Set([
  "HALLUCINATED_EDGE",
  "HALLUCINATED_MODULE",
  "WRONG_ENTRYPOINT",
  "MISSING_EDGE",
  "UNCLAIMED_REACHABLE_MODULE",
  "NAME_COLLISION_CONFUSION",
]);

/** True when a finding of this type makes the audit FAIL. */
export function isFailFinding(id: FindingId): boolean {
  return FAIL_FINDING_IDS.has(id);
}

/** True when a finding of this type forces INCOMPLETE (unless FAIL also applies). */
export function forcesIncomplete(id: FindingId): boolean {
  return INCOMPLETE_FORCING_FINDINGS.has(id);
}

/** The spec-default severity of a finding type (frozen contract). */
export function defaultSeverity(id: FindingId): FindingSeverity {
  return FINDING_DEFAULT_SEVERITY[id];
}

export interface FindingOpts {
  from?: string;
  to?: string;
  claimedJsonPath?: string;
}

/** Build one finding with its spec-default severity. */
export function makeFinding(
  id: FindingId,
  detail: string,
  opts: FindingOpts = {},
): Finding {
  return {
    id,
    severity: FINDING_DEFAULT_SEVERITY[id],
    ...(opts.from !== undefined ? { from: opts.from } : {}),
    ...(opts.to !== undefined ? { to: opts.to } : {}),
    detail,
    ...(opts.claimedJsonPath !== undefined
      ? { claimedJsonPath: opts.claimedJsonPath }
      : {}),
  };
}

/** Deterministic finding order: (id, from, to). Matches the S0 gate sort. */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) ||
    ((a.from ?? "") < (b.from ?? "") ? -1 : (a.from ?? "") > (b.from ?? "") ? 1 : 0) ||
    ((a.to ?? "") < (b.to ?? "") ? -1 : (a.to ?? "") > (b.to ?? "") ? 1 : 0)
  );
}

/** Sort findings deterministically (returns a new array). */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(compareFindings);
}

/** Deduplicate findings by (id, from, to), keeping the first, then sort. */
export function dedupeFindings(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const key = `${f.id}\0${f.from ?? ""}\0${f.to ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return sortFindings(out);
}

// ---------------------------------------------------------------------------
// One builder per finding type. Each states the firing condition in its
// doc comment; the comparator decides WHEN to call it.
// ---------------------------------------------------------------------------

export function hallucinatedEdgeFinding(
  from: string,
  to: string,
  claimedJsonPath?: string,
): Finding {
  return makeFinding(
    "HALLUCINATED_EDGE",
    `claimed edge ${from} -> ${to} does not exist in the ground-truth graph`,
    { from, to, ...(claimedJsonPath !== undefined ? { claimedJsonPath } : {}) },
  );
}

export function hallucinatedModuleFinding(
  path: string,
  claimedJsonPath?: string,
): Finding {
  return makeFinding(
    "HALLUCINATED_MODULE",
    `claimed module ${path} does not exist in the repository`,
    { from: path, ...(claimedJsonPath !== undefined ? { claimedJsonPath } : {}) },
  );
}

export function wrongEntrypointFinding(
  claimed: string,
  declared: string[],
  claimedJsonPath?: string,
): Finding {
  const declaredText =
    declared.length > 0 ? declared.join(", ") : "(none declared)";
  return makeFinding(
    "WRONG_ENTRYPOINT",
    `claimed entrypoint ${claimed} is not a declared entrypoint; declared: ${declaredText}`,
    { from: claimed, ...(claimedJsonPath !== undefined ? { claimedJsonPath } : {}) },
  );
}

export function missingEdgeFinding(from: string, to: string): Finding {
  return makeFinding(
    "MISSING_EDGE",
    `real edge ${from} -> ${to} is present in the ground-truth graph but unclaimed (FULL_GRAPH only)`,
    { from, to },
  );
}

export function unclaimedReachableModuleFinding(path: string): Finding {
  return makeFinding(
    "UNCLAIMED_REACHABLE_MODULE",
    `module ${path} is reachable from a declared entrypoint but unclaimed (FULL_GRAPH only)`,
    { from: path },
  );
}

export function isolatedModuleFinding(path: string): Finding {
  return makeFinding(
    "ISOLATED_MODULE",
    `module ${path} is reachable from no declared entrypoint and unclaimed; report information only, does not trigger FAIL`,
    { from: path },
  );
}

export function entrypointCandidateFinding(path: string): Finding {
  return makeFinding(
    "ENTRYPOINT_CANDIDATE",
    `no entrypoint is declared in .repomapverify.toml; ${path} is a graph root (in-degree 0) and a candidate entrypoint only — never WRONG_ENTRYPOINT evidence`,
    { from: path },
  );
}

export function nameCollisionConfusionFinding(from: string, to: string): Finding {
  return makeFinding(
    "NAME_COLLISION_CONFUSION",
    `claimed edge ${from} -> ${to} points at a real module with the same basename as the real target of a missing edge from the same source; the claimed map confused two same-named modules`,
    { from, to },
  );
}

export function dynamicImportUnknownFinding(
  path: string,
  detail?: string,
): Finding {
  return makeFinding(
    "DYNAMIC_IMPORT_UNKNOWN",
    detail ??
      `module ${path} has a dynamic import whose target cannot be determined statically; the audit is INCOMPLETE, not PASS`,
    { from: path },
  );
}

export function sourceNotEnumeratedFinding(
  path: string,
  parseStatus: string,
  detail?: string,
): Finding {
  return makeFinding(
    "SOURCE_NOT_ENUMERATED",
    detail ??
      `source ${path} could not be enumerated (parse status ${parseStatus}); its imports are unknown, so the audit is INCOMPLETE, not PASS`,
    { from: path },
  );
}

export function duplicateContentFinding(
  paths: readonly string[],
  contentSha256: string,
): Finding {
  const sorted = [...paths].sort();
  const first = sorted[0] as string;
  const second = sorted[1];
  return makeFinding(
    "DUPLICATE_CONTENT",
    `content_sha256 ${contentSha256} is shared by ${sorted.length} distinct modules (${sorted.join(", ")}); same content does not imply same module or same semantics`,
    {
      from: first,
      ...(second !== undefined ? { to: second } : {}),
    },
  );
}

export function generatedMismatchFinding(from: string, to: string): Finding {
  return makeFinding(
    "GENERATED_MISMATCH",
    `claimed edge ${from} -> ${to} exists only in generated code, not in the core (hand-written) graph; the map treats generated code as a hand-written module edge`,
    { from, to },
  );
}

/**
 * FIX T013 (P2-01) — module-level GENERATED_MISMATCH (spec §5.2,
 * T008 decision record 03_evidence/T008/GENERATED_MISMATCH_DECISION.md).
 * The agent asserted generated true/false for a module whose
 * ground-truth isGenerated disagrees. P2, never flips the verdict
 * (same stance as the edge-level rule). Absent assertion means no
 * judgement and never produces this finding.
 */
export function generatedModuleMismatchFinding(
  path: string,
  assertedGenerated: boolean,
  actualGenerated: boolean,
  claimedJsonPath?: string,
): Finding {
  return makeFinding(
    "GENERATED_MISMATCH",
    `claimed module ${path} asserts generated=${assertedGenerated} but ground truth says isGenerated=${actualGenerated}; the generated-ness assertion disagrees with the repo`,
    {
      from: path,
      ...(claimedJsonPath !== undefined ? { claimedJsonPath } : {}),
    },
  );
}
