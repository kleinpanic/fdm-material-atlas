import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Compare physical entrypoint paths so symlink invocation cannot bypass a CLI. */
export async function isMainModule(metaUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  const [modulePath, entryPath] = await Promise.all([
    realpath(fileURLToPath(metaUrl)),
    realpath(argvPath),
  ]);
  return modulePath === entryPath;
}
