/**
 * T009 — CLI entry dispatch (PROJECT_BOOK §6.4; PLAN §4.3).
 *
 * `main(argv)` returns the process exit code and never calls
 * `process.exit` itself, so it is testable in-process. Usage /
 * input errors print a clear message to stderr and return 3 —
 * never a stack trace as the only output.
 */
import { runAudit } from "./audit.js";
import { runGroundTruth } from "./ground-truth.js";
import { parseArgs, USAGE, UsageError } from "./parse.js";

export async function main(argv: string[]): Promise<number> {
  try {
    const command = parseArgs(argv);
    switch (command.kind) {
      case "help":
        process.stdout.write(`${USAGE}\n`);
        return 0;
      case "audit":
        return await runAudit(command.options);
      case "ground-truth":
        return await runGroundTruth(command.options);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`Error: ${e.message}\n`);
      process.stderr.write("Run `repomapverify --help` for usage.\n");
      return 3;
    }
    process.stderr.write(
      `Error: unexpected failure: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 3;
  }
}
