/**
 * T009 — Static HTML report renderer (PROJECT_BOOK §7; PLAN T009).
 *
 * Single self-contained file, readable offline, zero external
 * requests: inline stylesheet only (see `template.ts`), no scripts,
 * no images, no external links. Layout per §7.1:
 *
 * - Header summary: real scale, claimed scale, coverage, finding
 *   counts by severity, completeness mode (FULL_GRAPH /
 *   PARTIAL_SUBGRAPH), snapshot status.
 * - Aligned comparison tables: the same module / edge on one row,
 *   claimed on the left, ground truth on the right. Colors: green =
 *   verified, red = fabricated / wrong, yellow = undetermined
 *   (dynamic / unknown / generated-mismatch).
 * - Clicking an edge (a native `<details>` disclosure) shows the
 *   source file path, line number and import statement; clicking a
 *   module shows §7.2 detail (normalized path, content SHA,
 *   language, generated flag, in/out edges real-vs-claimed, parse
 *   status).
 * - Wrong entrypoints, unclaimed reachable modules and isolated
 *   modules each have their OWN section, never mixed into the edge
 *   list. Informational findings (ISOLATED_MODULE /
 *   ENTRYPOINT_CANDIDATE / DUPLICATE_CONTENT) have their own
 *   clearly-labeled section too — they are never dropped silently.
 */
import type { FullReport, ReportEdgeDetail, ReportModuleDetail } from "./build-report.js";
import { REPORT_CSS, escapeHtml } from "./template.js";

function findingCounts(report: FullReport): { P1: number; P2: number; INFO: number } {
  const counts = { P1: 0, P2: 0, INFO: 0 };
  for (const f of [...report.findings, ...report.infoFindings]) {
    counts[f.severity] += 1;
  }
  return counts;
}

function coverageText(report: FullReport): string {
  const { verifiedClaims, totalClaims } = report.coverage;
  if (totalClaims === 0) return "n/a (0 claims)";
  const pct = ((verifiedClaims / totalClaims) * 100).toFixed(1);
  return `${verifiedClaims} / ${totalClaims} (${pct}%)`;
}

function statusWord(s: ReportEdgeDetail["status"]): { label: string; cls: string } {
  switch (s) {
    case "verified":
      return { label: "verified", cls: "verified" };
    case "hallucinated":
      return { label: "fabricated", cls: "hallucinated" };
    case "missing":
      return { label: "missing (unclaimed)", cls: "missing" };
    case "generated-mismatch":
      return { label: "generated-code only", cls: "gen-mismatch" };
  }
}

function moduleRowClass(m: ReportModuleDetail): string {
  if (!m.inGroundTruth) return "hallucinated-row";
  if (!m.claimed && m.isolated) return "unknown-row";
  if (!m.claimed && m.reachable) return "missing-row";
  if (m.claimed) return "verified-row";
  return "";
}

function edgeRowClass(e: ReportEdgeDetail): string {
  switch (e.status) {
    case "verified":
      return "verified-row";
    case "hallucinated":
      return "hallucinated-row";
    case "missing":
      return "missing-row";
    case "generated-mismatch":
      return "gen-row";
  }
}

function edgeDetail(e: ReportEdgeDetail): string {
  const parts: string[] = [];
  if (e.evidence !== undefined) {
    parts.push(`<p>Source file: <code>${escapeHtml(e.evidence.file)}</code></p>`);
    parts.push(`<p>Line: <code>${e.evidence.line}</code></p>`);
    parts.push(`<p>Import statement: <code>${escapeHtml(e.evidence.statement)}</code></p>`);
  } else if (e.real) {
    parts.push(`<p class="muted">Real edge in the ground-truth graph; no source-line evidence was collected for it.</p>`);
  } else {
    parts.push(`<p>No such import exists in the ground-truth graph — this edge is claimed but not real.</p>`);
  }
  if (e.claimedJsonPath !== undefined) {
    parts.push(`<p>Claimed-map evidence: <code>${escapeHtml(e.claimedJsonPath)}</code></p>`);
  }
  return parts.join("\n");
}

function moduleDetail(m: ReportModuleDetail): string {
  const rows: string[] = [];
  rows.push(`<p>Normalized path: <code>${escapeHtml(m.path)}</code></p>`);
  rows.push(`<p>Content SHA-256: <code>${escapeHtml(m.contentSha256 ?? "(not in ground truth)")}</code></p>`);
  rows.push(`<p>Language: <code>${escapeHtml(m.language ?? "(unknown)")}</code></p>`);
  rows.push(`<p>Node kind: <code>${escapeHtml(m.nodeKind ?? "(unknown)")}</code></p>`);
  rows.push(
    `<p>Generated code: <code>${m.isGenerated === null ? "(unknown)" : m.isGenerated ? "yes" : "no"}</code></p>`,
  );
  rows.push(`<p>Parse status: <code>${escapeHtml(m.parseStatus ?? "(unknown)")}</code></p>`);
  if (m.aliases.length > 0) {
    rows.push(`<p>Aliases: <code>${m.aliases.map(escapeHtml).join("</code>, <code>")}</code></p>`);
  }
  const fmt = (xs: string[]): string =>
    xs.length === 0 ? "(none)" : xs.map((x) => `<code>${escapeHtml(x)}</code>`).join(", ");
  rows.push(`<p>In-edges (real): ${fmt(m.inEdgesReal)}</p>`);
  rows.push(`<p>In-edges (claimed): ${fmt(m.inEdgesClaimed)}</p>`);
  rows.push(`<p>Out-edges (real): ${fmt(m.outEdgesReal)}</p>`);
  rows.push(`<p>Out-edges (claimed): ${fmt(m.outEdgesClaimed)}</p>`);
  rows.push(
    `<p>Reachable from entrypoint: ${m.reachable ? "yes" : "no"}; isolated: ${m.isolated ? "yes" : "no"}; claimed: ${m.claimed ? "yes" : "no"}</p>`,
  );
  return rows.join("\n");
}

function sectionList(title: string, id: string, items: string[], note: string): string {
  const body =
    items.length === 0
      ? `<p class="muted">None.</p>`
      : `<ul>${items.map((i) => `<li><code>${escapeHtml(i)}</code></li>`).join("\n")}</ul>`;
  return `<section id="${id}"><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(note)}</p>${body}</section>`;
}

/** Render the full report as one self-contained offline HTML document. */
export function renderHtmlReport(report: FullReport): string {
  const counts = findingCounts(report);
  const esc = escapeHtml;

  const findingsRows =
    report.findings.length === 0
      ? `<tr><td colspan="5" class="ok">No findings — every claim verified.</td></tr>`
      : report.findings
          .map(
            (f) =>
              `<tr><td><code>${esc(f.id)}</code></td><td><span class="sev-${f.severity}">${f.severity}</span></td>` +
              `<td><code>${esc(f.from ?? "")}</code></td><td><code>${esc(f.to ?? "")}</code></td>` +
              `<td>${esc(f.detail)}${f.claimedJsonPath !== undefined ? ` <span class="muted">(${esc(f.claimedJsonPath)})</span>` : ""}</td></tr>`,
          )
          .join("\n");

  const infoRows =
    report.infoFindings.length === 0
      ? `<tr><td colspan="5" class="muted">No informational findings.</td></tr>`
      : report.infoFindings
          .map(
            (f) =>
              `<tr><td><code>${esc(f.id)}</code></td><td><span class="sev-${f.severity}">${f.severity}</span></td>` +
              `<td><code>${esc(f.from ?? "")}</code></td><td><code>${esc(f.to ?? "")}</code></td>` +
              `<td>${esc(f.detail)}</td></tr>`,
          )
          .join("\n");

  const moduleRows = report.modules
    .map((m) => {
      const claimedMark = m.claimed ? `<span class="ok">claimed</span>` : `<span class="muted">not claimed</span>`;
      const realMark = m.inGroundTruth ? `<span class="ok">real</span>` : `<span class="bad">not in repo</span>`;
      const state = !m.inGroundTruth
        ? `<span class="hallucinated">fabricated module</span>`
        : !m.claimed && m.reachable
          ? `<span class="missing">unclaimed reachable</span>`
          : !m.claimed && m.isolated
            ? `<span class="unknown">isolated</span>`
            : `<span class="verified">verified</span>`;
      return (
        `<tr class="${moduleRowClass(m)}"><td><details><summary><code>${esc(m.path)}</code></summary>` +
        `<div class="detail">${moduleDetail(m)}</div></details></td>` +
        `<td>${claimedMark}</td><td>${realMark}</td><td>${state}</td></tr>`
      );
    })
    .join("\n");

  const edgeRows =
    report.edges.length === 0
      ? `<tr><td colspan="4" class="muted">No edges in either graph.</td></tr>`
      : report.edges
          .map((e) => {
            const w = statusWord(e.status);
            const claimedMark = e.claimed ? `<span class="ok">claimed</span>` : `<span class="muted">not claimed</span>`;
            const realMark = e.real ? `<span class="ok">real</span>` : `<span class="bad">not real</span>`;
            return (
              `<tr class="${edgeRowClass(e)}"><td><details><summary><code>${esc(e.from)} → ${esc(e.to)}</code></summary>` +
              `<div class="detail">${edgeDetail(e)}</div></details></td>` +
              `<td>${claimedMark}</td><td>${realMark}</td><td><span class="${w.cls}">${w.label}</span></td></tr>`
            );
          })
          .join("\n");

  const duplicateBody =
    report.sections.duplicateContent.length === 0
      ? `<p class="muted">None.</p>`
      : `<ul>${report.sections.duplicateContent
          .map(
            (g) =>
              `<li>Content SHA-256 <code>${esc(g.contentSha256)}</code> shared by ` +
              g.paths.map((p) => `<code>${esc(p)}</code>`).join(", ") +
              ` — same content does not imply the same module.</li>`,
          )
          .join("\n")}</ul>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>RepoMapVerify report — ${esc(report.mapId)} — ${esc(report.status)}</title>
<style>
${REPORT_CSS}
</style>
</head>
<body>
<h1>RepoMapVerify audit report</h1>
<p><span class="badge status-${report.status}">${report.status}</span> &nbsp; map <code>${esc(report.mapId)}</code></p>
<nav>
<a href="#summary">Summary</a><a href="#findings">Findings</a><a href="#info-findings">Informational findings</a><a href="#modules">Modules</a><a href="#edges">Edges</a><a href="#wrong-entrypoints">Wrong entrypoints</a><a href="#unclaimed-reachable">Unclaimed reachable</a><a href="#isolated">Isolated modules</a><a href="#evidence">Evidence</a>
</nav>

<section id="summary">
<h2>Summary</h2>
<table>
<tr><th>Ground-truth graph (real)</th><td>${report.groundTruth.modules} modules, ${report.groundTruth.edges} import edges</td></tr>
<tr><th>Claimed map</th><td>${report.claimed.modules} modules, ${report.claimed.edges} edges</td></tr>
<tr><th>Coverage</th><td>${coverageText(report)}</td></tr>
<tr><th>Findings by severity</th><td>P1: ${counts.P1}, P2: ${counts.P2}, INFO: ${counts.INFO} (main findings: ${report.findings.length}, informational: ${report.infoFindings.length})</td></tr>
<tr><th>Completeness mode</th><td>${esc(report.completeness)}</td></tr>
<tr><th>Snapshot status</th><td>${esc(report.snapshotStatus)}${report.snapshotStatus === "STALE_SNAPSHOT" ? " — the map describes a different tree; no blame findings are reported" : ""}</td></tr>
<tr><th>Canonical semantic hash</th><td><code>${esc(report.canonicalSemanticHash)}</code></td></tr>
</table>
<p class="muted">Colors: green = verified, red = fabricated or wrong, yellow = undetermined (dynamic import, unknown, or generated-code only). Click a module or an edge to see its detail.</p>
</section>

<section id="findings">
<h2>Findings</h2>
<table>
<tr><th>Type</th><th>Severity</th><th>From</th><th>To</th><th>Detail</th></tr>
${findingsRows}
</table>
</section>

<section id="info-findings">
<h2>Informational findings</h2>
<p class="muted">These findings never change the audit status and are never mixed into the findings list above: isolated modules, entrypoint candidates, and duplicate content are properties of the repo, reported here in their own clearly-labeled section.</p>
<table>
<tr><th>Type</th><th>Severity</th><th>From</th><th>To</th><th>Detail</th></tr>
${infoRows}
</table>
</section>

<section id="modules">
<h2>Modules — claimed (left) vs ground truth (right), aligned</h2>
<table>
<tr><th>Module</th><th>Claimed</th><th>Ground truth</th><th>Status</th></tr>
${moduleRows}
</table>
</section>

<section id="edges">
<h2>Edges — claimed (left) vs ground truth (right), aligned</h2>
<table>
<tr><th>Edge</th><th>Claimed</th><th>Ground truth</th><th>Status</th></tr>
${edgeRows}
</table>
</section>

${sectionList("Wrong entrypoints", "wrong-entrypoints", report.sections.wrongEntrypoints, "Claimed entrypoints that are not declared entrypoints. Shown here only — never mixed into the edge list.")}
${sectionList("Unclaimed reachable modules", "unclaimed-reachable", report.sections.unclaimedReachableModules, "Real modules reachable from a declared entrypoint that the claimed map never mentions (FULL_GRAPH only). Shown here only — never mixed into the edge list.")}
${sectionList("Isolated modules", "isolated", report.sections.isolatedModules, "Real modules reachable from no declared entrypoint and unclaimed. Report information only; does not trigger FAIL. Shown here only — never mixed into the edge list.")}
${sectionList("Entrypoint candidates", "entrypoint-candidates", report.sections.entrypointCandidates, "Graph roots (in-degree 0) when no entrypoint is declared. Hints only — never WRONG_ENTRYPOINT evidence.")}
<section id="duplicate-content">
<h2>Duplicate content</h2>
<p class="muted">Distinct modules sharing one content SHA-256. Same content does not imply the same module or the same semantics.</p>
${duplicateBody}
</section>

<section id="evidence">
<h2>SHA-256 evidence</h2>
<p>Repo snapshot SHA-256: <code>${esc(report.evidenceSha256.repoSnapshotSha256)}</code></p>
<table>
<tr><th>Module</th><th>Module ID</th><th>Content SHA-256</th></tr>
${report.evidenceSha256.modules.map((m) => `<tr><td><code>${esc(m.path)}</code></td><td><code>${esc(m.moduleId)}</code></td><td><code>${esc(m.contentSha256)}</code></td></tr>`).join("\n")}
</table>
</section>

<footer><p class="muted">RepoMapVerify — local static report. This file is self-contained and readable offline; it makes no external requests. Canonical semantic hash: <code>${esc(report.canonicalSemanticHash)}</code></p></footer>
</body>
</html>
`;
}
