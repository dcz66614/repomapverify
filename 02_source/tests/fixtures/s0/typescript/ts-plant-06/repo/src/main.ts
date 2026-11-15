import { real } from "./real";
const modName = "./other";
const m = await import(modName);
console.log(real, m);
