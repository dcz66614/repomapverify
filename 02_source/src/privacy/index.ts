/**
 * Privacy redaction (T008; PROJECT_BOOK §4.2 rule 5, §9; PLAN §7.3).
 *
 * Absolute paths and usernames never appear in report / JSON output.
 * Redaction is applied at the I/O boundary: validator error messages,
 * adapter notes and anything handed to the report layer go through
 * here first.
 */
export {
  ABSOLUTE_PATH_PLACEHOLDER,
  USER_PLACEHOLDER,
  findLeaks,
  redactForOutput,
  redactText,
  redactValue,
} from "./redact.js";
export type { LeakFinding, RedactionOptions } from "./redact.js";
