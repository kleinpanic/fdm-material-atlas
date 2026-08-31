import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { buildGitEnvironment } from './safe-git.mjs';

const execFileAsync = promisify(execFile);
const PROHIBITED_ATTRIBUTION = /(?:^|[^a-z])(codex|openai|claude|anthropic|chatgpt|gsd|ai[- ]?agent|bot)(?:[^a-z]|$)/i;

/**
 * A redacted repository invariant failure.
 *
 * @typedef {object} RepositoryGuardErrorContext
 * @property {string | null} repositoryRoot
 * @property {string} expectedRoot
 * @property {string | null} parentRepositoryRoot
 */
export class RepositoryGuardError extends Error {
  /**
   * @param {string} ruleCode
   * @param {RepositoryGuardErrorContext} context
   */
  constructor(ruleCode, context) {
    super(`Repository guard failed: ${ruleCode}`);
    this.name = 'RepositoryGuardError';
    this.ruleCode = ruleCode;
    this.context = context;
  }
}

/**
 * @typedef {object} RepositoryInspection
 * @property {string | null} repositoryRoot
 * @property {string} expectedRoot
 * @property {string | null} gitCommonDirectory
 * @property {string | null} parentRepositoryRoot
 * @property {boolean} repositoryRootMatches
 * @property {boolean} commonDirectoryOwned
 * @property {boolean} identityConfigured
 * @property {boolean} identityAllowed
 * @property {boolean} remotePolicySatisfied
 * @property {boolean} parentIndexClean
 * @property {boolean} historyIdentityMatches
 * @property {boolean} historyAttributionAllowed
 * @property {boolean} historyComplete
 * @property {number} remoteCount
 * @property {number} parentIndexEntryCount
 * @property {number} commitCount
 */

async function runGit(cwd, args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: buildGitEnvironment(),
    });
    return { ok: true, stdout: stdout.trimEnd() };
  } catch (error) {
    if (allowFailure) return { ok: false, stdout: '' };
    throw error;
  }
}

async function physicalPath(path) {
  return realpath(resolve(path));
}

async function literalDirectoryExists(path) {
  try {
    const info = await lstat(path);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

async function findAncestorRepository(projectRoot) {
  let candidate = dirname(projectRoot);
  while (true) {
    const result = await runGit(candidate, ['rev-parse', '--show-toplevel'], { allowFailure: true });
    if (result.ok) return physicalPath(result.stdout);
    const next = dirname(candidate);
    if (next === candidate) return null;
    candidate = next;
  }
}

function splitLines(value) {
  return value === '' ? [] : value.split('\n').filter(Boolean);
}

function safeContext(inspection) {
  return {
    repositoryRoot: inspection.repositoryRoot ? 'repository' : null,
    expectedRoot: 'expected-root',
    parentRepositoryRoot: inspection.parentRepositoryRoot ? 'parent-repository' : null,
  };
}

function failureContext() {
  return { repositoryRoot: null, expectedRoot: 'expected-root', parentRepositoryRoot: null };
}

async function inspectHistory(repositoryRoot, configuredName, configuredEmail) {
  const revisions = await runGit(repositoryRoot, ['rev-list', '--all']);
  const hashes = splitLines(revisions.stdout);
  let identityMatches = true;
  let attributionAllowed = true;

  for (const hash of hashes) {
    const record = await runGit(repositoryRoot, [
      'show',
      '--quiet',
      '--format=%an%x00%ae%x00%cn%x00%ce%x00%B',
      hash,
    ]);
    const [authorName = '', authorEmail = '', committerName = '', committerEmail = '', ...bodyParts] =
      record.stdout.split('\0');
    const body = bodyParts.join('\0');
    if (
      authorName !== configuredName ||
      authorEmail !== configuredEmail ||
      committerName !== configuredName ||
      committerEmail !== configuredEmail
    ) {
      identityMatches = false;
    }
    if (
      PROHIBITED_ATTRIBUTION.test(authorName) ||
      PROHIBITED_ATTRIBUTION.test(authorEmail) ||
      PROHIBITED_ATTRIBUTION.test(committerName) ||
      PROHIBITED_ATTRIBUTION.test(committerEmail) ||
      body.split('\n').some((line) => /^co-authored-by:/i.test(line) && PROHIBITED_ATTRIBUTION.test(line))
    ) {
      attributionAllowed = false;
    }
  }

  return { commitCount: hashes.length, identityMatches, attributionAllowed };
}

async function inspectHistoryCompleteness(repositoryRoot) {
  const shallow = await runGit(repositoryRoot, ['rev-parse', '--is-shallow-repository']);
  const partialExtension = await runGit(
    repositoryRoot,
    ['config', '--get', 'extensions.partialClone'],
    { allowFailure: true },
  );
  const promisorRemotes = await runGit(
    repositoryRoot,
    ['config', '--get-regexp', '^remote\..*\.promisor$'],
    { allowFailure: true },
  );
  const missing = await runGit(repositoryRoot, ['rev-list', '--objects', '--all', '--missing=print']);
  return {
    shallow: shallow.stdout === 'true',
    partial:
      (partialExtension.ok && partialExtension.stdout !== '') ||
      (promisorRemotes.ok && splitLines(promisorRemotes.stdout).length > 0),
    objectsMissing: splitLines(missing.stdout).some((line) => line.startsWith('?')),
  };
}

/**
 * Inspect repository boundaries and authorship without changing Git state.
 * Configured identities, remote URLs, and commit bodies never enter the result.
 *
 * @param {{cwd?: string, expectedRoot?: string, remotePolicy?: 'absent' | 'any'}} options
 * @returns {Promise<RepositoryInspection>}
 */
async function inspectRepositoryUnsafe(options = {}) {
  const cwd = await physicalPath(options.cwd ?? process.cwd());
  const expectedRoot = await physicalPath(options.expectedRoot ?? cwd);
  const remotePolicy = options.remotePolicy ?? 'absent';
  if (!['absent', 'any'].includes(remotePolicy)) {
    throw new RepositoryGuardError('remote-policy-invalid', {
      repositoryRoot: null,
      expectedRoot,
      parentRepositoryRoot: null,
    });
  }

  const rootResult = await runGit(cwd, ['rev-parse', '--show-toplevel'], { allowFailure: true });
  const repositoryRoot = rootResult.ok ? await physicalPath(rootResult.stdout) : null;
  const commonResult = repositoryRoot
    ? await runGit(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { allowFailure: true })
    : { ok: false, stdout: '' };
  const gitCommonDirectory = commonResult.ok ? await physicalPath(commonResult.stdout) : null;
  const expectedGitDirectory = join(expectedRoot, '.git');
  const commonDirectoryOwned =
    gitCommonDirectory !== null &&
    (await literalDirectoryExists(expectedGitDirectory)) &&
    resolve(commonResult.stdout) === expectedGitDirectory &&
    gitCommonDirectory === expectedGitDirectory;

  const parentRepositoryRoot = await findAncestorRepository(expectedRoot);
  let parentIndexEntryCount = 0;
  if (parentRepositoryRoot) {
    const childPath = relative(parentRepositoryRoot, expectedRoot).split(sep).join('/');
    if (childPath && childPath !== '..' && !childPath.startsWith('../') && !isAbsolute(childPath)) {
      const entries = await runGit(parentRepositoryRoot, ['ls-files', '--stage', '--', childPath]);
      parentIndexEntryCount = splitLines(entries.stdout).length;
    }
  }

  const remotes = repositoryRoot ? await runGit(repositoryRoot, ['remote']) : { stdout: '' };
  const remoteCount = splitLines(remotes.stdout).length;
  const nameResult = repositoryRoot
    ? await runGit(repositoryRoot, ['config', '--get', 'user.name'], { allowFailure: true })
    : { ok: false, stdout: '' };
  const emailResult = repositoryRoot
    ? await runGit(repositoryRoot, ['config', '--get', 'user.email'], { allowFailure: true })
    : { ok: false, stdout: '' };
  const configuredName = nameResult.ok ? nameResult.stdout : '';
  const configuredEmail = emailResult.ok ? emailResult.stdout : '';
  const identityConfigured = configuredName !== '' && configuredEmail !== '';
  const identityAllowed =
    identityConfigured &&
    !PROHIBITED_ATTRIBUTION.test(configuredName) &&
    !PROHIBITED_ATTRIBUTION.test(configuredEmail);

  const history = repositoryRoot && identityConfigured
    ? await inspectHistory(repositoryRoot, configuredName, configuredEmail)
    : { commitCount: 0, identityMatches: false, attributionAllowed: true };
  const historyCompleteness = repositoryRoot
    ? await inspectHistoryCompleteness(repositoryRoot)
    : { shallow: false, partial: false, objectsMissing: false };

  return {
    repositoryRoot,
    expectedRoot,
    gitCommonDirectory,
    parentRepositoryRoot,
    repositoryRootMatches: repositoryRoot === expectedRoot,
    commonDirectoryOwned,
    identityConfigured,
    identityAllowed,
    remotePolicySatisfied: remotePolicy === 'any' || remoteCount === 0,
    parentIndexClean: parentIndexEntryCount === 0,
    historyIdentityMatches: history.commitCount === 0 || history.identityMatches,
    historyAttributionAllowed: history.attributionAllowed,
    historyComplete:
      !historyCompleteness.shallow && !historyCompleteness.partial && !historyCompleteness.objectsMissing,
    remoteCount,
    parentIndexEntryCount,
    commitCount: history.commitCount,
  };
}

export async function inspectRepository(options = {}) {
  try {
    return await inspectRepositoryUnsafe(options);
  } catch (error) {
    if (error instanceof RepositoryGuardError) throw error;
    throw new RepositoryGuardError('repository-inspection-failed', failureContext());
  }
}

/**
 * Assert repository boundaries and authorship, returning the redacted inspection.
 *
 * @param {{cwd?: string, expectedRoot?: string, remotePolicy?: 'absent' | 'any'}} options
 * @returns {Promise<RepositoryInspection>}
 */
export async function assertRepository(options = {}) {
  const inspection = await inspectRepository(options);
  const context = safeContext(inspection);
  if (!inspection.repositoryRootMatches) throw new RepositoryGuardError('repository-root-mismatch', context);
  if (!inspection.commonDirectoryOwned) throw new RepositoryGuardError('common-directory-mismatch', context);
  if (!inspection.parentIndexClean) throw new RepositoryGuardError('parent-index-entry', context);
  if (!inspection.remotePolicySatisfied) throw new RepositoryGuardError('remote-present', context);
  if (!inspection.identityConfigured) throw new RepositoryGuardError('identity-missing', context);
  if (!inspection.identityAllowed) throw new RepositoryGuardError('identity-prohibited', context);
  if (!inspection.historyComplete) throw new RepositoryGuardError('history-incomplete', context);
  if (!inspection.historyAttributionAllowed) {
    throw new RepositoryGuardError('history-prohibited-attribution', context);
  }
  if (!inspection.historyIdentityMatches) throw new RepositoryGuardError('history-identity-mismatch', context);
  return inspection;
}
