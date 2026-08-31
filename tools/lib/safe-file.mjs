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
export async function readStableFile(path, { maximumBytes } = {}) {
  let handle;
  try {
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
    handle = await open(path, flags);
    const before = await handle.stat();
    if (!before.isFile()) throw new SafeFileError('not-regular-file');
    if (maximumBytes !== undefined && before.size > maximumBytes) {
      throw new SafeFileError('input-too-large');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
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
