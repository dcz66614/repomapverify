import { fetchApi } from "./services/api";
import { helper } from "./util";
export function start(h: string) { return fetchApi(h) + helper(); }
