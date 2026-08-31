#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { lstat, opendir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { assertRepository } from './lib/repository-guard.mjs';
import {
  formatFinding,
  loadPublicationPolicy,
  PublicationPolicyError,
} from './lib/publication-policy.mjs';
import { isMainModule } from './lib/main-module.mjs';
import { buildGitEnvironment } from './lib/safe-git.mjs';
import { readStableFile, SafeFileError } from './lib/safe-file.mjs';

const execFileAsync = promisify(execFile);
const MODES = new Set(['working', 'tracked', 'history', 'artifact']);

export class PublicationScanError extends Error {
  constructor(ruleId) {
    super(`Publication scan failed: ${ruleId}`);
    this.name = 'PublicationScanError';
    this.ruleId = ruleId;
  }
}

function splitNul(buffer) {
  const values = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0) {
      if (index > start) values.push(buffer.subarray(start, index));
      start = index + 1;
    }
  }
  if (start < buffer.length) values.push(buffer.subarray(start));
  return values;
}

async function runGit(root, args, { allowFailure = false, maxBuffer = 80 * 1024 * 1024 } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: root,
      encoding: 'buffer',
      maxBuffer,
      env: buildGitEnvironment(),
    });
    return { ok: true, stdout };
  } catch {
    if (allowFailure) return { ok: false, stdout: Buffer.alloc(0) };
    throw new PublicationScanError('surface-inspection-failed');
  }
}

function isInside(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function locationBuffer(location) {
  return Buffer.isBuffer(location) ? location : Buffer.from(location);
}

function uniqueFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = JSON.stringify(finding);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Scan untrusted bytes using only stable rule identifiers. */
export function scanBytes(bytes, { policy, surface, location, objectType, objectId } = {}) {
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (content.length > policy.maximumBytes) throw new PublicationScanError('input-too-large');
  const findings = [];
  const add = (ruleId) => findings.push(formatFinding({ ruleId, surface, location, objectType, objectId }));

  for (const exact of policy.exactPatterns) {
    if (content.includes(exact.bytes)) add('private-source-pattern');
  }
  const text = content.toString('latin1');
  for (const pattern of policy.credentialPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) add('credential-signature');
  }
  return uniqueFindings(findings);
}

/** Scan an untrusted pathname. The pathname never enters the returned finding. */
export function scanPath(pathBytes, { policy, surface, objectType } = {}) {
  const location = locationBuffer(pathBytes);
  const normalized = location.toString('latin1').replaceAll('\\', '/');
  const findings = scanBytes(location, { policy, surface, location, objectType });
  if (policy.operationalPathPatterns.some((pattern) => pattern.test(normalized))) {
    findings.push(formatFinding({ ruleId: 'operational-path', surface, location, objectType }));
  }
  if (/\.map$/i.test(normalized)) {
    findings.push(formatFinding({ ruleId: 'unsafe-source-map', surface, location, objectType }));
  }
  return uniqueFindings(findings);
}

function scanGeneratedMetadata(pathBytes, bytes, context) {
  const normalized = locationBuffer(pathBytes).toString('latin1').replaceAll('\\', '/');
  if (!/\.json$/i.test(normalized)) return [];
  const text = bytes.toString('latin1');
  if (!/(?:sourcesContent|sourceRoot|file:\/\/|(?:^|["'])\/(?:home|Users|workspace)\/)/i.test(text)) return [];
  return [formatFinding({
    ruleId: 'unsafe-generated-metadata',
    surface: context.surface,
    location: locationBuffer(pathBytes),
    objectType: context.objectType,
  })];
}

async function inspectFile(path, pathBytes, context) {
  let stable;
  try {
    stable = await readStableFile(path, { maximumBytes: context.policy.maximumBytes });
  } catch (error) {
    if (error instanceof SafeFileError && error.ruleId === 'input-too-large') {
      throw new PublicationScanError('input-too-large');
    }
    if (error instanceof SafeFileError && error.ruleId === 'file-inspection-failed') {
      try {
        if ((await lstat(path)).isSymbolicLink()) {
          return [formatFinding({
            ruleId: 'unsafe-symlink',
            surface: context.surface,
            location: locationBuffer(pathBytes),
            objectType: 'symlink',
          })];
        }
      } catch {}
    }
    throw new PublicationScanError('surface-inspection-failed');
  }
  const { bytes } = stable;
  return uniqueFindings([
    ...scanPath(pathBytes, context),
    ...scanBytes(bytes, { ...context, location: locationBuffer(pathBytes) }),
    ...scanGeneratedMetadata(pathBytes, bytes, context),
  ]);
}

async function scanWorking(root, policy) {
  const listing = await runGit(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  const paths = splitNul(listing.stdout);
  const findings = [];
  for (const pathBytes of paths) {
    findings.push(...await inspectFile(join(root, pathBytes.toString()), pathBytes, {
      policy,
      surface: 'working',
      objectType: 'file',
    }));
  }
  return { scannedCount: paths.length, findings: uniqueFindings(findings) };
}

async function scanTracked(root, policy) {
  const listing = await runGit(root, ['ls-files', '--stage', '-z']);
  const records = splitNul(listing.stdout).map(parseIndexRecord);
  const findings = [];
  for (const record of records) {
    const context = { policy, surface: 'tracked', objectType: record.type, location: record.path };
    findings.push(...scanPath(record.path, context));
    if (record.mode === '160000') {
      findings.push(formatFinding({ ruleId: 'unsafe-gitlink', surface: 'tracked', location: record.path, objectType: 'gitlink' }));
      continue;
    }
    const indexObject = await runGit(root, ['cat-file', 'blob', record.oid]);
    if (record.mode === '120000') {
      findings.push(formatFinding({ ruleId: 'unsafe-symlink', surface: 'tracked', location: record.path, objectType: 'symlink' }));
    }
    findings.push(...scanBytes(indexObject.stdout, context));
    findings.push(...scanGeneratedMetadata(record.path, indexObject.stdout, context));
  }
  return { scannedCount: records.length, findings: uniqueFindings(findings) };
}

function parseIndexRecord(record) {
  const tab = record.indexOf(9);
  if (tab < 0) throw new PublicationScanError('surface-inspection-failed');
  const header = record.subarray(0, tab).toString('ascii').split(' ');
  if (header.length !== 3) throw new PublicationScanError('surface-inspection-failed');
  const mode = header[0];
  return { mode, type: mode === '160000' ? 'gitlink' : mode === '120000' ? 'symlink' : 'blob', oid: header[1], path: record.subarray(tab + 1) };
}

function parseTreeRecord(record) {
  const tab = record.indexOf(9);
  if (tab < 0) throw new PublicationScanError('surface-inspection-failed');
  const header = record.subarray(0, tab).toString('ascii').split(' ');
  if (header.length !== 3) throw new PublicationScanError('surface-inspection-failed');
  return { mode: header[0], type: header[1], oid: header[2], path: record.subarray(tab + 1) };
}

async function scanHistory(root, policy) {
  // Git ref names cannot contain LF or NUL, so one ref per line is unambiguous.
  const refs = await runGit(root, ['for-each-ref', '--format=%(refname)']);
  const refNames = refs.stdout.length === 0
    ? []
    : refs.stdout.toString('utf8').trimEnd().split('\n').map((name) => Buffer.from(name));
  if (refNames.length === 0) return { scannedCount: 0, findings: [] };
  const commitList = await runGit(root, ['rev-list', '--all']);
  const commits = commitList.stdout.toString('ascii').trim().split('\n').filter(Boolean);
  const objectList = await runGit(root, ['rev-list', '--objects', '--all', '--no-object-names']);
  const objectIds = [...new Set(objectList.stdout.toString('ascii').trim().split('\n').filter(Boolean))];
  const findings = [];
  let scannedCount = refNames.length;

  for (const refName of refNames) {
    findings.push(...scanPath(refName, {
      policy,
      surface: 'history',
      objectType: 'ref',
    }));
  }

  for (const commit of commits) {
    const tree = await runGit(root, ['ls-tree', '-rz', '-r', commit]);
    for (const rawRecord of splitNul(tree.stdout)) {
      const record = parseTreeRecord(rawRecord);
      scannedCount += 1;
      const context = { policy, surface: 'history', objectType: record.type, location: record.path };
      findings.push(...scanPath(record.path, context));
      if (record.mode === '160000') {
        findings.push(formatFinding({ ruleId: 'unsafe-gitlink', surface: 'history', location: record.path, objectType: 'gitlink' }));
      }
      if (record.type === 'blob') {
        const bytes = await runGit(root, ['cat-file', 'blob', record.oid]);
        if (record.mode === '120000') {
          findings.push(formatFinding({ ruleId: 'unsafe-symlink', surface: 'history', location: record.path, objectType: 'symlink' }));
        }
        findings.push(...scanBytes(bytes.stdout, context));
        findings.push(...scanGeneratedMetadata(record.path, bytes.stdout, context));
      }
    }
  }

  for (const oid of objectIds) {
    const typeResult = await runGit(root, ['cat-file', '-t', oid]);
    const objectType = typeResult.stdout.toString('ascii').trim();
    if (!['blob', 'commit', 'tag'].includes(objectType)) continue;
    const bytes = await runGit(root, ['cat-file', objectType, oid]);
    scannedCount += 1;
    findings.push(...scanBytes(bytes.stdout, {
      policy,
      surface: 'history',
      location: Buffer.from(oid),
      objectType,
      objectId: oid,
    }));
  }
  return { scannedCount, findings: uniqueFindings(findings) };
}

async function collectArtifactFiles(root, current = root, output = []) {
  let directory;
  try {
    directory = await opendir(current);
  } catch {
    throw new PublicationScanError('surface-inspection-failed');
  }
  for await (const entry of directory) {
    const path = join(current, entry.name);
    let info;
    try {
      info = await lstat(path);
    } catch {
      throw new PublicationScanError('surface-inspection-failed');
    }
    if (info.isSymbolicLink()) {
      output.push({ path, relativePath: relative(root, path), symlink: true });
    } else if (info.isDirectory()) {
      await collectArtifactFiles(root, path, output);
    } else if (info.isFile()) {
      output.push({ path, relativePath: relative(root, path), symlink: false });
    } else {
      throw new PublicationScanError('surface-inspection-failed');
    }
  }
  return output;
}

async function scanArtifact(artifactPath, policy) {
  if (!artifactPath) throw new PublicationScanError('artifact-path-required');
  let artifactRoot;
  try {
    artifactRoot = await realpath(resolve(artifactPath));
    if (!(await stat(artifactRoot)).isDirectory()) throw new Error('not-directory');
  } catch {
    throw new PublicationScanError('surface-inspection-failed');
  }
  const files = await collectArtifactFiles(artifactRoot);
  const findings = [];
  for (const file of files) {
    if (!isInside(artifactRoot, resolve(file.path))) throw new PublicationScanError('surface-inspection-failed');
    const pathBytes = Buffer.from(file.relativePath);
    if (file.symlink) {
      findings.push(formatFinding({
        ruleId: 'unsafe-symlink',
        surface: 'artifact',
        location: pathBytes,
        objectType: 'symlink',
      }));
      continue;
    }
    findings.push(...await inspectFile(file.path, pathBytes, {
      policy,
      surface: 'artifact',
      objectType: 'file',
    }));
  }
  return { scannedCount: files.length, findings: uniqueFindings(findings) };
}

/** Scan one publication surface and return only counts and redacted findings. */
export async function scanPublication({ root = process.cwd(), mode, artifactPath, policy } = {}) {
  if (!MODES.has(mode)) throw new PublicationScanError('mode-invalid');
  let physicalRoot;
  try {
    physicalRoot = await realpath(resolve(root));
  } catch {
    throw new PublicationScanError('surface-inspection-failed');
  }
  const activePolicy = policy ?? await loadPublicationPolicy({ root: physicalRoot });
  try {
    let result;
    if (mode === 'artifact') {
      result = await scanArtifact(artifactPath, activePolicy);
    } else {
      await assertRepository({ cwd: physicalRoot, expectedRoot: physicalRoot, remotePolicy: 'any' });
      if (mode === 'working') result = await scanWorking(physicalRoot, activePolicy);
      if (mode === 'tracked') result = await scanTracked(physicalRoot, activePolicy);
      if (mode === 'history') result = await scanHistory(physicalRoot, activePolicy);
    }
    return Object.freeze({
      mode,
      scannedCount: result.scannedCount,
      findingCount: result.findings.length,
      findings: result.findings,
    });
  } catch (error) {
    if (error instanceof PublicationScanError || error instanceof PublicationPolicyError) throw error;
    throw new PublicationScanError('surface-inspection-failed');
  }
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--mode', '--root', '--artifact', '--sensitive-file'].includes(flag) || index + 1 >= argv.length) {
      throw new PublicationScanError('arguments-invalid');
    }
    options[flag.slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!options.mode) throw new PublicationScanError('arguments-invalid');
  return options;
}

async function main() {
  try {
    const args = parseArguments(process.argv.slice(2));
    const root = args.root ?? process.cwd();
    const policy = await loadPublicationPolicy({ root, env: process.env, sensitiveFile: args['sensitive-file'] });
    const report = await scanPublication({ root, mode: args.mode, artifactPath: args.artifact, policy });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.findingCount > 0 ? 1 : 0;
  } catch (error) {
    const ruleId = error?.ruleId ?? 'surface-inspection-failed';
    process.stderr.write(`${JSON.stringify({ ok: false, error: { ruleId } })}\n`);
    process.exitCode = 2;
  }
}

if (await isMainModule(import.meta.url)) {
  await main();
}
