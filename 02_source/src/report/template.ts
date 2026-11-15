/**
 * T009 — Static HTML report template (PROJECT_BOOK §7.4; PLAN T009).
 *
 * The template is inline in the repo and embedded at build time: the
 * renderer below is compiled into `dist/` together with this file, so
 * the emitted report needs nothing at runtime. The report is a SINGLE
 * self-contained file, readable offline, with ZERO external requests:
 * no external scripts, fonts or images — the stylesheet lives in
 * `REPORT_CSS`, there is no JavaScript at all (disclosure uses
 * native `<details>` elements), and every link is a same-page
 * fragment (`#...`). Nothing in this file may contain an external
 * URL: the S0 gate greps `src/` for network-call tokens, and the
 * offline proof greps the emitted HTML the same way.
 */
export const REPORT_CSS = [
  "body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;margin:2em auto;max-width:1100px;padding:0 1em;color:#1a1a1a;background:#fff;line-height:1.5}",
  "h1{font-size:1.6em}h2{font-size:1.25em;margin-top:2em;border-bottom:1px solid #ddd;padding-bottom:.2em}h3{font-size:1.05em;margin-top:1.5em}",
  "table{border-collapse:collapse;width:100%;margin:.5em 0}",
  "th,td{border:1px solid #ccc;padding:.35em .6em;text-align:left;vertical-align:top;font-size:.92em}",
  "th{background:#f2f2f2}",
  "code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em;word-break:break-all}",
  ".badge{display:inline-block;padding:.15em .7em;border-radius:1em;color:#fff;font-weight:700}",
  ".status-PASS{background:#2e7d32}.status-FAIL{background:#c62828}.status-INCOMPLETE{background:#e65100}",
  ".sev-P1{background:#c62828;color:#fff;padding:.05em .5em;border-radius:.8em}",
  ".sev-P2{background:#ef6c00;color:#fff;padding:.05em .5em;border-radius:.8em}",
  ".sev-INFO{background:#1565c0;color:#fff;padding:.05em .5em;border-radius:.8em}",
  ".verified{color:#2e7d32;font-weight:700}",
  ".hallucinated{color:#c62828;font-weight:700}",
  ".missing{color:#c62828;font-weight:700}",
  ".unknown{color:#e65100;font-weight:700}",
  ".gen-mismatch{color:#e65100;font-weight:700}",
  ".ok{color:#2e7d32}.bad{color:#c62828}.warn{color:#e65100}",
  "tr.verified-row{background:#e8f5e9}tr.hallucinated-row{background:#ffebee}tr.missing-row{background:#ffebee}tr.unknown-row{background:#fff8e1}tr.gen-row{background:#fff8e1}",
  "details{margin:.2em 0}summary{cursor:pointer;font-weight:600}",
  ".detail{margin:.4em 0 .4em 1.2em;font-size:.92em}",
  ".muted{color:#666;font-size:.9em}",
  "nav{margin:1em 0}nav a{margin-right:1em}",
].join("\n");

/** Escape text for safe interpolation into HTML (paths, statements, details). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
