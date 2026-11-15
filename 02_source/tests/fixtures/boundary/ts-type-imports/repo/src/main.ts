import type { Foo } from "./foo";
import { type Baz } from "./foo";
import { type Qux, bar } from "./foo";
export type { Foo } from "./foo";
export { type Baz } from "./foo";
const f: Foo = 1;
const b: Baz = "x";
const q: Qux = true;
console.log(bar, f, b, q);
