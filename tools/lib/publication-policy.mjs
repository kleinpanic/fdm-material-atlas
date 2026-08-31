import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_SENSITIVE_FILE = '.publication-sensitive-patterns';

export class PublicationPolicyError extends Error {
  constructor(ruleId) {
    super(`Publication policy failed: ${ruleId}`);
    this.name = 'PublicationPolicyError';
    this.ruleId = ruleId;
  }
}

function isInside(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

async function gitStatus(root, args) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: 16 * 1024 * 1024,
      env: process.env,
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: Buffer.alloc(0) };
  }
}

function parsePatternDocument(bytes) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new PublicationPolicyError('sensitive-input-invalid');
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || Buffer.byteLength(item) === 0)
  ) {
    throw new PublicationPolicyError('sensitive-input-invalid');
  }
  return value.map((item) => ({ ruleId: 'private-source-pattern', bytes: Buffer.from(item) }));
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Load exact values into memory without exposing their origin or content.
 */
export async function loadExactPatterns({ root, env = process.env, sensitiveFile } = {}) {
  let physicalRoot;
  try {
    physicalRoot = await realpath(resolve(root ?? process.cwd()));
  } catch {
    throw new PublicationPolicyError('sensitive-input-inspection-failed');
  }

  if (Object.hasOwn(env, 'PUBLICATION_SENSITIVE_PATTERNS_JSON')) {
    return parsePatternDocument(Buffer.from(env.PUBLICATION_SENSITIVE_PATTERNS_JSON ?? ''));
  }

  const selected = resolve(physicalRoot, sensitiveFile ?? DEFAULT_SENSITIVE_FILE);
  if (!(await fileExists(selected))) {
    if (sensitiveFile) throw new PublicationPolicyError('sensitive-input-inspection-failed');
    return [];
  }

  let physicalFile;
  try {
    physicalFile = await realpath(selected);
  } catch {
    throw new PublicationPolicyError('sensitive-input-inspection-failed');
  }

  if (isInside(physicalRoot, physicalFile)) {
    const relativeFile = relative(physicalRoot, physicalFile).split(sep).join('/');
    const ignored = await gitStatus(physicalRoot, ['check-ignore', '-q', '--', relativeFile]);
    const indexed = await gitStatus(physicalRoot, ['ls-files', '--error-unmatch', '--', relativeFile]);
    const staged = await gitStatus(physicalRoot, ['diff', '--cached', '--quiet', '--', relativeFile]);
    if (!ignored.ok || indexed.ok || !staged.ok) {
      throw new PublicationPolicyError('sensitive-input-unsafe');
    }
  }

  try {
    return parsePatternDocument(await readFile(physicalFile));
  } catch (error) {
    if (error instanceof PublicationPolicyError) throw error;
    throw new PublicationPolicyError('sensitive-input-inspection-failed');
  }
}

/**
 * Convert an untrusted location into a surface-scoped opaque reference.
 */
export function formatFinding({ ruleId, surface, location, objectType, objectId }) {
  const finding = {
    ruleId,
    surface,
    safeLocation: objectId
      ? `object:${objectId}`
      : `sha256:${createHash('sha256').update(surface).update(Buffer.from([0])).update(location).digest('hex')}`,
  };
  if (objectType) finding.objectType = objectType;
  return finding;
}

/**
 * Build the shared publication policy. Rules are controlled constants; caller values
 * remain byte buffers with a generic rule identifier.
 */
export async function loadPublicationPolicy(options = {}) {
  const exactPatterns = await loadExactPatterns(options);
  return Object.freeze({
    exactPatterns,
    operationalPathPatterns: Object.freeze([
      /(?:^|\/)(?:\.planning|\.claude|\.codex|\.agents|\.gsd|\.cursor|\.gemini|\.opencode|\.windsurf)(?:\/|$)/i,
      /(?:^|\/)(?:AGENTS|CLAUDE|CODEX|GEMINI)\.md$/i,
      /(?:^|\/)(?:continue|handoff)(?:[-_.][^/]*)?\.md$/i,
      /(?:^|\/)(?:prompt|transcript)[^/]*\.(?:md|txt|json|jsonl|prompt|transcript)$/i,
      /(?:^|\/)\.env(?:\.[^/]*)?$/i,
      /(?:^|\/)(?:\.publication-audit|publication-audit)(?:\/|$)/i,
    ]),
    credentialPatterns: Object.freeze([
      /gh[pousr]_[A-Za-z0-9]{30,}/g,
      /AKIA[A-Z0-9]{16}/g,
      /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/gi,
      new RegExp(['-----BEGIN ', '(?:RSA |EC |OPENSSH )?', 'PRIVATE KEY', '-----'].join(''), 'g'),
    ]),
    maximumBytes: 64 * 1024 * 1024,
  });
}
