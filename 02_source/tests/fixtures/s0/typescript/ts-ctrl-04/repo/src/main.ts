import type { Config } from "./types";
import type { L } from "./legacy";
import { run } from "./runner";
export function main(c: Config): L { run(); return c as unknown as L; }
