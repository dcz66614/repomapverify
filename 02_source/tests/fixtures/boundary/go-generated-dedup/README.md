# go-generated-dedup — generated/hand dedup regression (§4.5)

REGRESSION (T007): a package pair imported by both a generated file
and a hand-written file must yield BOTH a core edge and a generated
edge. The old shared dedup set kept only the alphabetically-first
file's edge and silently lost the real hand-written edge from the
ground truth. Claiming the edge verifies against the core edge: PASS.
