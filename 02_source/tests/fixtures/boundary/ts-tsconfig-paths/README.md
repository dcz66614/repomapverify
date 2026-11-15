# ts-tsconfig-paths — tsconfig paths + baseUrl boundary (§4.4)

- Wildcard `@/*`: the first target (missing/*) misses, the second
  (lib/*) hits — targets are tried in order.
- Exact (star-less) pattern `@exact` resolves via its single target.
- Bare `lib/plain` matches no pattern, so the baseUrl fallback
  (src + lib/plain) resolves it.
- `@/gone` matches the wildcard pattern but no target file exists:
  ALIAS_NOT_RESOLVED, never a guessed edge and never external.
- Audit over the exact core graph is INCOMPLETE (unresolvable import
  forces INCOMPLETE with no invented finding).
