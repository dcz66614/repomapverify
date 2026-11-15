/**
 * Claimed-map I/O (T008; PROJECT_BOOK §6.1, §6.4; PLAN §4.1).
 *
 * The I/O boundary for claimed-map/v1 JSON: strict schema validation
 * (validateClaimedMap / parseClaimedMapJson) and the input-error
 * exit-code class (3). Invalid input is never a silent pass.
 */
export {
  CLAIMED_MAP_INPUT_EXIT_CODE,
  parseClaimedMapJson,
  validateClaimedMap,
} from "./validate-claimed-map.js";
export type {
  ClaimedMapValidationResult,
  ValidationIssue,
} from "./validate-claimed-map.js";
