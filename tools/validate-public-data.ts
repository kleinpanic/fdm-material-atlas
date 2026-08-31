import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";

import { parseAtlas, type AtlasIssue } from "../src/data/schema/parse-atlas.ts";
import { serializeAtlas } from "../src/data/serialization/stable-json.ts";

const PUBLIC_DATA_PATH = "src/data/public/atlas.v1.json";
const MAX_PUBLIC_DATA_BYTES = 20 * 1024 * 1024;

type CliIssue = AtlasIssue | {
  code:
    | "CLI_ARGUMENTS_UNSUPPORTED"
    | "DATA_FILE_INVALID"
    | "DATA_FILE_TOO_LARGE"
    | "DATA_FILE_UNREADABLE";
  pointer: "/";
};

function writeJson(stream: NodeJS.WriteStream, value: unknown): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

function fail(issues: readonly CliIssue[]): number {
  writeJson(process.stderr, { ok: false, issueCount: issues.length, issues });
  return 1;
}

async function main(): Promise<number> {
  if (process.argv.length !== 2) {
    return fail([{ code: "CLI_ARGUMENTS_UNSUPPORTED", pointer: "/" }]);
  }

  const path = resolve(process.cwd(), PUBLIC_DATA_PATH);
  let bytes: Buffer;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const details = await handle.stat();
    if (!details.isFile()) return fail([{ code: "DATA_FILE_UNREADABLE", pointer: "/" }]);
    if (details.size > MAX_PUBLIC_DATA_BYTES) {
      return fail([{ code: "DATA_FILE_TOO_LARGE", pointer: "/" }]);
    }
    bytes = await handle.readFile();
  } catch {
    return fail([{ code: "DATA_FILE_UNREADABLE", pointer: "/" }]);
  } finally {
    await handle?.close().catch(() => undefined);
  }

  let unknownData: unknown;
  try {
    unknownData = JSON.parse(bytes.toString("utf8"));
  } catch {
    return fail([{ code: "DATA_FILE_INVALID", pointer: "/" }]);
  }

  const parsed = parseAtlas(unknownData);
  if (!parsed.success) return fail(parsed.issues);

  const canonicalBytes = Buffer.from(serializeAtlas(parsed.data), "utf8");
  if (!bytes.equals(canonicalBytes)) {
    return fail([{ code: "SERIALIZATION_DRIFT", pointer: "/" }]);
  }

  writeJson(process.stdout, {
    ok: true,
    counts: {
      materials: parsed.data.materials.length,
      sources: parsed.data.sources.length,
      methods: parsed.data.methods.length,
      processGates: parsed.data.processGates.length,
      decisionLanes: parsed.data.decisionLanes.length,
      visualizationReferences: parsed.data.visualizationReferences.length,
      vocabularies: parsed.data.vocabularies.length,
    },
  });
  return 0;
}

process.exitCode = await main();
