# ts-ext-completion — relative extension completion (§4.4)

- `./a` -> a.ts; `./b.js` -> b.ts (a .js specifier maps to the .ts
  source); `./c.jsx` -> c.tsx; `./d` -> d/index.ts; `./e` ->
  e/index.tsx (index files).
- `./nope` resolves to nothing: TARGET_NOT_FOUND, never guessed.
- Audit over the exact core graph is INCOMPLETE (missing target),
  findings [].
