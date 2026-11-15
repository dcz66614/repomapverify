import { lazy } from "./lazy";
import("./ondemand").then(() => {});
const name = "./lazy";
import(name).then(() => {});
import(`./${name}`).then(() => {});
console.log(lazy);
