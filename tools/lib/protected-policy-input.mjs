import { constants } from "node:fs";
import { open } from "node:fs/promises";

const MAX_BYTES = 64 * 1024;
const MAX_PATTERNS = 128;
const MAX_PATTERN_BYTES = 4096;

export class ProtectedPolicyInputError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProtectedPolicyInputError";
    this.code = code;
  }
}

function fail(code) {
  throw new ProtectedPolicyInputError(code);
}

export async function readProtectedPolicyFromFd({
  fd = 3,
  synthetic = false,
  openFile = open,
} = {}) {
  if (!Number.isSafeInteger(fd) || fd < 0 || (!synthetic && fd !== 3))
    fail("PROTECTED_POLICY_DESCRIPTOR_INVALID");
  let duplicate;
  try {
    duplicate = await openFile(`/proc/self/fd/${fd}`, constants.O_RDONLY);
    const info = await duplicate.stat();
    if (!info.isFile()) fail("PROTECTED_POLICY_TYPE_INVALID");
    if ((info.mode & 0o077) !== 0) fail("PROTECTED_POLICY_MODE_INVALID");
    if (info.size < 1 || info.size > MAX_BYTES) fail("PROTECTED_POLICY_SIZE_INVALID");
    const bytes = Buffer.alloc(info.size);
    const { bytesRead } = await duplicate.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== info.size) fail("PROTECTED_POLICY_READ_INVALID");
    let value;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail("PROTECTED_POLICY_CONTENT_INVALID");
    }
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.exactPatterns) ||
      value.exactPatterns.length < 1 ||
      value.exactPatterns.length > MAX_PATTERNS
    )
      fail("PROTECTED_POLICY_CONTENT_INVALID");
    const exactPatterns = value.exactPatterns.map((pattern) => {
      const hasForbiddenControl =
        typeof pattern === "string" &&
        [...pattern].some((character) => {
          const point = character.codePointAt(0) ?? 0;
          return point === 0 || point === 10 || point === 13;
        });
      if (
        typeof pattern !== "string" ||
        Buffer.byteLength(pattern) < 1 ||
        Buffer.byteLength(pattern) > MAX_PATTERN_BYTES ||
        hasForbiddenControl
      )
        fail("PROTECTED_POLICY_CONTENT_INVALID");
      return Buffer.from(pattern);
    });
    if (
      new Set(exactPatterns.map((pattern) => pattern.toString("base64"))).size !==
      exactPatterns.length
    )
      fail("PROTECTED_POLICY_CONTENT_INVALID");
    return Object.freeze({ schemaVersion: 1, exactPatterns: Object.freeze(exactPatterns) });
  } catch (error) {
    if (error instanceof ProtectedPolicyInputError) throw error;
    fail("PROTECTED_POLICY_DESCRIPTOR_INVALID");
  } finally {
    await duplicate?.close().catch(() => {});
  }
}
