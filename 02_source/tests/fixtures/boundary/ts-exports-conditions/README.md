# ts-exports-conditions — package.json exports condition objects (§4.4)

- Self-reference via package.json name + exports. A value import
  resolves through the `import` condition (never `types`, even though
  `types` is listed first in the object), and the `./lib/*` wildcard
  subpath resolves with `*` substitution.
- Audit over the exact graph is PASS.
