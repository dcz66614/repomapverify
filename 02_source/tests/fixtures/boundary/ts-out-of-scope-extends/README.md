# ts-out-of-scope-extends — tsconfig `extends` is out of scope (§4.4)

- The frozen scope covers tsconfig paths/baseUrl in the repo-root
  tsconfig itself; `extends` chains are NOT followed, so the alias
  defined only in base.json is ALIAS_NOT_RESOLVED (UNKNOWN, never
  guessed). The relative import in the same file still resolves.
- Audit over the exact core graph is INCOMPLETE, findings [].
