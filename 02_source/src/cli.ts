#!/usr/bin/env node
/**
 * RepoMapVerify CLI entry (T009; PROJECT_BOOK §6.4).
 * `node dist/cli.js audit ...` / `node dist/cli.js ground-truth ...`.
 * Exit codes: PASS 0, FAIL 1, INCOMPLETE 2, usage/input error 3.
 */
import { main } from "./cli/main.js";

process.exitCode = await main(process.argv.slice(2));
