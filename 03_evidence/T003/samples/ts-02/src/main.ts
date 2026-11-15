import def, { type T } from "./a";
import foo = require("./b");
import "./side";
export * as ns from "./c";
export type { E } from "./d";
const v: T = def as unknown as T;
console.log(foo, v, ns);
