/**
 * §4 interface contracts — single barrel. Everything the extractors,
 * graph builder, comparator, adapters and CLI agree on lives here and
 * is frozen by T001 (spec v1.1.0 SPEC_FROZEN).
 */
export * from "./claimed-map.js";
export * from "./module.js";
export * from "./snapshot.js";
export * from "./entrypoints.js";
export * from "./findings.js";
export * from "./report.js";
export * from "./adapters.js";
export * from "./frozen-scope.js";
