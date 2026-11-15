/**
 * T005 — Identity module barrel.
 *
 * The frozen contract identity functions (module_id / content_sha256
 * separation, Go package combination hash) live in contracts/module.ts
 * and are the authority; this module only adds behaviour the contracts
 * deliberately leave to the builder (case adapters, symlink merging,
 * duplicate-content detection). They are NOT re-exported here, so the
 * package barrel (src/index.ts) keeps exactly one export for each
 * contract name.
 */
export * from "./normalize.js";
export * from "./symlinks.js";
export * from "./registry.js";
