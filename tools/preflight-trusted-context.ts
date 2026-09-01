import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

type Mode = "audit" | "publication";
type IssueCode =
  | "CLI_ARGUMENTS_UNSUPPORTED"
  | "TRUSTED_INPUT_INSIDE_REPOSITORY"
  | "TRUSTED_INPUT_RELATIVE"
  | "TRUSTED_INPUT_TYPE_INVALID"
  | "TRUSTED_INPUT_UNREADABLE"
  | "TRUSTED_INPUT_UNSET";

const MODE_CONFIG = {
  "--audit": { mode: "audit", environmentName: "FDM_MATERIALS_AUDIT_DIR", type: "directory" },
  "--publication": {
    mode: "publication",
    environmentName: "FDM_PUBLICATION_SENSITIVE_FILE",
    type: "file",
  },
} as const;

function writeJson(stream: NodeJS.WriteStream, value: unknown): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

function fail(code: IssueCode): number {
  writeJson(process.stderr, { ok: false, code });
  return 1;
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

async function validate(modeArgument: string | undefined): Promise<number> {
  const config =
    modeArgument === "--audit" || modeArgument === "--publication"
      ? MODE_CONFIG[modeArgument]
      : undefined;
  if (config === undefined || process.argv.length !== 3) return fail("CLI_ARGUMENTS_UNSUPPORTED");

  const configuredPath = process.env[config.environmentName];
  if (configuredPath === undefined || configuredPath.trim() === "") {
    return fail("TRUSTED_INPUT_UNSET");
  }
  if (!isAbsolute(configuredPath)) return fail("TRUSTED_INPUT_RELATIVE");

  let configuredDetails: Awaited<ReturnType<typeof lstat>>;
  let physicalInput: string;
  let physicalRepository: string;
  try {
    configuredDetails = await lstat(configuredPath);
    if (
      !configuredDetails.isDirectory() &&
      !configuredDetails.isFile() &&
      !configuredDetails.isSymbolicLink()
    ) {
      return fail("TRUSTED_INPUT_TYPE_INVALID");
    }
    [physicalInput, physicalRepository] = await Promise.all([
      realpath(configuredPath),
      realpath(resolve(import.meta.dirname, "..")),
    ]);
    await access(physicalInput, constants.R_OK);
  } catch {
    return fail("TRUSTED_INPUT_UNREADABLE");
  }

  if (isWithin(physicalRepository, physicalInput)) {
    return fail("TRUSTED_INPUT_INSIDE_REPOSITORY");
  }

  try {
    const physicalDetails = await lstat(physicalInput);
    const validType =
      config.type === "directory" ? physicalDetails.isDirectory() : physicalDetails.isFile();
    if (!validType) return fail("TRUSTED_INPUT_TYPE_INVALID");
  } catch {
    return fail("TRUSTED_INPUT_UNREADABLE");
  }

  writeJson(process.stdout, { ok: true, mode: config.mode satisfies Mode });
  return 0;
}

process.exitCode = await validate(process.argv[2]);
