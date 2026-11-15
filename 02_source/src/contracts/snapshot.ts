/**
 * Repo-snapshot binding contract (P0 fix #2, PROJECT_BOOK §4.2 rule 8,
 * §5.1 STALE_SNAPSHOT; IMPLEMENTATION_PLAN §4.1).
 *
 * A claimed map is bound to the exact working tree it was built against:
 * a full working-tree snapshot SHA-256 plus the git commit when one
 * exists. A git commit alone is NOT sufficient — uncommitted changes are
 * not in HEAD. When the snapshot does not match the repo under audit,
 * the result is STALE_SNAPSHOT (an INCOMPLETE outcome): the old map's
 * errors must never be blamed on the agent.
 */

export interface RepoSnapshot {
  /** SHA-256 of the full working-tree snapshot (canonical, deterministic). */
  repoSnapshotSha256: string;
  /** Git commit (HEAD) when the repo is a git checkout; undefined otherwise. */
  gitCommit?: string;
}

export type SnapshotStatus = "MATCH" | "STALE_SNAPSHOT";

/**
 * Compare the snapshot a claimed map declares against the snapshot of
 * the repo actually being audited. Any mismatch — including a missing
 * declared snapshot — is STALE_SNAPSHOT, never a silent pass.
 */
export function checkSnapshot(
  claimed: RepoSnapshot,
  actual: RepoSnapshot,
): SnapshotStatus {
  if (!claimed.repoSnapshotSha256) return "STALE_SNAPSHOT";
  if (claimed.repoSnapshotSha256 !== actual.repoSnapshotSha256) return "STALE_SNAPSHOT";
  // A declared git commit that disagrees is also stale; an absent declared
  // commit is not, by itself, a mismatch (non-git repos have none).
  if (
    claimed.gitCommit !== undefined &&
    actual.gitCommit !== undefined &&
    claimed.gitCommit !== actual.gitCommit
  ) {
    return "STALE_SNAPSHOT";
  }
  return "MATCH";
}
