import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";

import type { AtlasV1 } from "../data/schema/atlas.ts";
import { parseAtlas } from "../data/schema/parse-atlas.ts";

const PUBLIC_ATLAS_RELATIVE_PATH = "src/data/public/atlas.v1.json";
const MAX_PUBLIC_ATLAS_BYTES = 8 * 1024 * 1024;

type PublicAtlasErrorCode =
  | "PUBLIC_ATLAS_READ_FAILED"
  | "PUBLIC_ATLAS_INVALID";

function fail(code: PublicAtlasErrorCode): never {
  throw new Error(code);
}

/**
 * Load the one committed public Atlas artifact at build time.
 *
 * This boundary accepts no caller path, URL, environment locator, or
 * credential. All rejected input is reduced to an allow-listed code.
 */
export function loadPublicAtlas(): AtlasV1 {
  let descriptor: number | undefined;
  let raw: string;

  try {
    descriptor = openSync(
      resolve(process.cwd(), PUBLIC_ATLAS_RELATIVE_PATH),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const stat = fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.size <= 0 ||
      stat.size > MAX_PUBLIC_ATLAS_BYTES
    ) {
      return fail("PUBLIC_ATLAS_READ_FAILED");
    }
    raw = readFileSync(descriptor, { encoding: "utf8" });
  } catch {
    return fail("PUBLIC_ATLAS_READ_FAILED");
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The read result is already isolated. Do not disclose descriptor details.
      }
    }
  }

  let input: unknown;
  try {
    input = JSON.parse(raw) as unknown;
  } catch {
    return fail("PUBLIC_ATLAS_INVALID");
  }

  const result = parseAtlas(input);
  if (!result.success) return fail("PUBLIC_ATLAS_INVALID");
  return result.data;
}
