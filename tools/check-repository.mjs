#!/usr/bin/env node

import { resolve } from "node:path";
import { assertRepository, RepositoryGuardError } from "./lib/repository-guard.mjs";

function parseArguments(argv) {
  const options = { cwd: process.cwd(), expectedRoot: process.cwd(), remotePolicy: "absent" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      const root = argv[index + 1];
      if (!root) throw new Error("Missing value for --root");
      options.cwd = resolve(root);
      options.expectedRoot = resolve(root);
      index += 1;
    } else if (argument === "--remote-policy") {
      const policy = argv[index + 1];
      if (!policy || !["absent", "any"].includes(policy)) {
        throw new Error("--remote-policy must be absent or any");
      }
      options.remotePolicy = policy;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

try {
  const inspection = await assertRepository(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(inspection)}\n`);
} catch (error) {
  if (error instanceof RepositoryGuardError) {
    process.stderr.write(`Repository guard failed: ${error.ruleCode}\n`);
  } else {
    process.stderr.write("Repository guard failed: invalid-command\n");
  }
  process.exitCode = 1;
}
