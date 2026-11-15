/**
 * CLI layer (T009; PROJECT_BOOK §6.4). `audit` + `ground-truth`
 * commands, exit codes PASS 0 / FAIL 1 / INCOMPLETE 2 / usage 3.
 */
export { main } from "./main.js";
export { runAudit, resolveDefaultOutDir, JSON_REPORT_FILENAME, HTML_REPORT_FILENAME } from "./audit.js";
export type { Writers } from "./audit.js";
export { runGroundTruth, filterCanonicalGraphByLang } from "./ground-truth.js";
export { collectEvidence } from "./evidence.js";
export type { CollectedEvidence, EdgeEvidence } from "./evidence.js";
export { parseArgs, USAGE, UsageError } from "./parse.js";
export type { AuditOptions, CliCommand, GroundTruthOptions } from "./parse.js";
