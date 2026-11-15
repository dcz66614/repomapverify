/**
 * Input adapters (T002 PoC; PROJECT_BOOK §6.5, IMPLEMENTATION_PLAN §4.5).
 *
 * v1 accepts four input shapes, all normalized to ClaimedMapV1:
 * - claimed-map/v1 JSON (native; no mapping needed — validated by T008)
 * - Graphify graph.json        -> mapGraphify
 * - Understand-Anything .ua    -> mapUnderstandAnything
 * - Aider Repo Map             -> mapAiderRepoMap (FORCED PARTIAL_SUBGRAPH)
 */
import type { AdapterKind } from "../contracts/adapters.js";
import { validateClaimedMap } from "../io/validate-claimed-map.js";
import { mapGraphify } from "./graphify.js";
import { mapUnderstandAnything } from "./understand-anything.js";
import { mapAiderRepoMap } from "./aider.js";
import type { AdapterOptions, AdapterResult } from "./shared.js";

export { mapGraphify } from "./graphify.js";
export { mapUnderstandAnything } from "./understand-anything.js";
export { mapAiderRepoMap, parseAiderRepoMapText } from "./aider.js";
export type { AdapterOptions, AdapterResult } from "./shared.js";

/** Dispatch one input to its adapter by kind. */
export function mapInput(
  kind: AdapterKind,
  input: unknown,
  opts?: AdapterOptions,
): AdapterResult {
  switch (kind) {
    case "graphify":
      return mapGraphify(input, opts);
    case "understand-anything":
      return mapUnderstandAnything(input, opts);
    case "aider-repo-map":
      return mapAiderRepoMap(input, opts);
    case "claimed-map-v1": {
      // Native format: no mapping — strict schema validation (T008).
      const checked = validateClaimedMap(input);
      if (!checked.ok) {
        return {
          ok: false,
          error: `claimed-map/v1 validation failed: ${checked.errors
            .map((e) => `${e.field}: ${e.message}`)
            .join("; ")}`,
          droppedEdges: 0,
          notes: [],
        };
      }
      return {
        ok: true,
        map: checked.map,
        droppedEdges: 0,
        notes: checked.warnings.map((w) => `warning ${w.field}: ${w.message}`),
      };
    }
  }
}
