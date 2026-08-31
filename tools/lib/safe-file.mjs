import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export class SafeFileError extends Error {
  constructor(ruleId) {
    super(`Safe file read failed: ${ruleId}`);
    this.name = 'SafeFileError';
    this.ruleId = ruleId;
  }
}

/** Bind validation and reading to one no-follow descriptor. */
export async function readStableFile(path, { maximumBytes, openFile = open } = {}) {
  let handle;
  try {
    const limit = maximumBytes ?? 64 * 1024 * 1024;
    if (!Number.isSafeInteger(limit) || limit < 0) throw new SafeFileError('file-inspection-failed');
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
    handle = await openFile(path, flags);
    const before = await handle.stat();
    if (!before.isFile()) throw new SafeFileError('not-regular-file');
    if (before.size > limit) {
      throw new SafeFileError('input-too-large');
    }
    const chunks = [];
    let total = 0;
    while (total <= limit) {
      const length = Math.min(64 * 1024, limit + 1 - total);
      if (length === 0) break;
      const chunk = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(chunk, 0, length, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
      if (total > limit) throw new SafeFileError('input-too-large');
    }
    const bytes = Buffer.concat(chunks, total);
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      bytes.length !== after.size
    ) {
      throw new SafeFileError('file-changed-during-read');
    }
    return { bytes, stat: after };
  } catch (error) {
    if (error instanceof SafeFileError) throw error;
    throw new SafeFileError('file-inspection-failed');
  } finally {
    await handle?.close().catch(() => {});
  }
}
