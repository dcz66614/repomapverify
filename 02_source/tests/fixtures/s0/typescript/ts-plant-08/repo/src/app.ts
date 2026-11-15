import { util } from "@/lib/util";
import { User } from "./models/user";
export function run(u: string) { return u + User.name; }
