import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const BASELINE_URL = new URL('../../tools/check-publication.mjs', import.meta.url);
const EMPTY_GIT_CONFIG = join(mkdtempSync(join(tmpdir(), 'publication-git-config-')), 'config');
writeFileSync(EMPTY_GIT_CONFIG, '');
const MAINTAINER_NAME = 'Casey Maintainer';
const MAINTAINER_EMAIL = 'casey@example.test';
const FIXTURE_HOME = mkdtempSync(join(tmpdir(), 'publication-baseline-home-'));
writeFileSync(join(FIXTURE_HOME, '.gitconfig'), `[user]\n\tname = ${MAINTAINER_NAME}\n\temail = ${MAINTAINER_EMAIL}\n`);
process.env.HOME = FIXTURE_HOME;

function cleanEnvironment(overrides = {}) {
  const environment = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: EMPTY_GIT_CONFIG,
  };
  delete environment.GIT_AUTHOR_NAME;
  delete environment.GIT_AUTHOR_EMAIL;
  delete environment.GIT_COMMITTER_NAME;
  delete environment.GIT_COMMITTER_EMAIL;
  return { ...environment, ...overrides };
}

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: cleanEnvironment(options.env),
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initRepository(path, { identity = true } = {}) {
  mkdirSync(path, { recursive: true });
  git(path, ['init', '-b', 'main']);
  if (identity) {
    git(path, ['config', 'user.name', MAINTAINER_NAME]);
    git(path, ['config', 'user.email', MAINTAINER_EMAIL]);
  }
}

function createNestedRepositories(options = {}) {
  const fixture = mkdtempSync(join(tmpdir(), 'publication-baseline-'));
  const parent = join(fixture, 'parent');
  const child = join(parent, 'child');
  initRepository(parent);
  initRepository(child, options);
  return { fixture, parent: resolve(parent), child: resolve(child) };
}

function write(root, relativePath, content = 'safe public fixture\n') {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

function commit(root, paths, message = 'Add synthetic fixture', environment = {}) {
  git(root, ['add', '--', ...paths]);
  git(root, ['commit', '-m', message], { env: environment });
}

function privateMarker(suffix = 'A') {
  return ['SYNTHETIC', 'BASELINE', 'PRIVATE', suffix].join('-');
}

function credentialShape(suffix = 'A') {
  return ['gh', 'p_', 'B'.repeat(34), suffix].join('');
}

function runBaseline(root, args = [], environment = {}) {
  return spawnSync(process.execPath, [BASELINE_URL.pathname, '--root', root, ...args], {
    encoding: 'utf8',
    env: cleanEnvironment(environment),
  });
}

function parseOutput(result) {
  const text = result.stdout.trim() || result.stderr.trim();
  return JSON.parse(text);
}

function assertOpaqueFindings(report) {
  for (const finding of report.findings ?? []) {
    assert.deepEqual(
      Object.keys(finding).sort(),
      Object.keys(finding).filter((key) => ['objectType', 'ruleId', 'safeLocation', 'surface'].includes(key)).sort(),
    );
    assert.match(finding.safeLocation, /^(?:sha256:[a-f0-9]{64}|object:[a-f0-9]{40,64})$/);
  }
}

function assertRedacted(result, forbidden = []) {
  const output = `${result.stdout}${result.stderr}`;
  for (const value of forbidden) assert.equal(output.includes(value), false);
  if (output.trim()) assertOpaqueFindings(parseOutput(result));
}

function assertFailedWith(result, ruleId, forbidden = []) {
  assert.notEqual(result.status, 0);
  const report = parseOutput(result);
  assert.equal(report.ok, false);
  assert.ok(
    report.errors?.some((error) => error.ruleId === ruleId) ||
      report.findings?.some((finding) => finding.ruleId === ruleId),
    `missing ${ruleId} in ${JSON.stringify(report)}`,
  );
  assertRedacted(result, forbidden);
  return report;
}

async function loadEntrypoint() {
  try {
    const module = await import(BASELINE_URL);
    if (typeof module.checkPublication !== 'function') {
      const error = new Error('ERR_PUBLICATION_BASELINE_ENTRYPOINT_MISSING');
      error.code = 'ERR_PUBLICATION_BASELINE_ENTRYPOINT_MISSING';
      throw error;
    }
    return module.checkPublication;
  } catch (error) {
    if (
      error?.code === 'ERR_MODULE_NOT_FOUND' ||
      error?.code === 'ERR_PUBLICATION_BASELINE_ENTRYPOINT_MISSING'
    ) {
      const contractError = new Error('ERR_PUBLICATION_BASELINE_ENTRYPOINT_MISSING');
      contractError.code = 'ERR_PUBLICATION_BASELINE_ENTRYPOINT_MISSING';
      throw contractError;
    }
    throw error;
  }
}

test('aggregate entrypoint is available', async () => {
  const marker = process.env.PUBLICATION_TEST_LEAK_MARKER ?? privateMarker('ENTRYPOINT');
  try {
    assert.equal(typeof await loadEntrypoint(), 'function');
  } catch (error) {
    assert.equal(String(error).includes(marker), false);
    throw error;
  }
});

test('clean committed and unborn repositories pass every default surface without mutation', () => {
  for (const commitFixture of [false, true]) {
    const { parent, child } = createNestedRepositories();
    write(child, 'public.txt');
    if (commitFixture) commit(child, ['public.txt']);
    const before = {
      childStatus: git(child, ['status', '--porcelain=v1']),
      childRefs: git(child, ['for-each-ref', '--format=%(refname):%(objectname)']),
      childRemotes: git(child, ['remote', '-v']),
      parentStatus: git(parent, ['status', '--porcelain=v1']),
      parentIndex: git(parent, ['ls-files', '--stage', '--', 'child']),
    };

    const result = runBaseline(child, ['--remote-policy', 'absent']);
    assert.equal(result.status, 0, result.stderr);
    const report = parseOutput(result);
    assert.equal(report.ok, true);
    assert.deepEqual(report.surfaces.map(({ surface }) => surface), ['repository', 'working', 'tracked', 'history']);
    assert.ok(report.surfaces.every(({ findingCount }) => findingCount === 0));
    assert.deepEqual(before, {
      childStatus: git(child, ['status', '--porcelain=v1']),
      childRefs: git(child, ['for-each-ref', '--format=%(refname):%(objectname)']),
      childRemotes: git(child, ['remote', '-v']),
      parentStatus: git(parent, ['status', '--porcelain=v1']),
      parentIndex: git(parent, ['ls-files', '--stage', '--', 'child']),
    });
  }
});

test('repository failures propagate for wrong root, parent index, remote, and author', () => {
  const wrongRootFixture = createNestedRepositories();
  const nested = join(wrongRootFixture.child, 'nested');
  mkdirSync(nested);
  assertFailedWith(runBaseline(nested), 'repository-root-mismatch');

  const indexed = createNestedRepositories();
  write(indexed.child, 'public.txt');
  commit(indexed.child, ['public.txt']);
  git(indexed.parent, ['add', 'child']);
  assertFailedWith(runBaseline(indexed.child), 'parent-index-entry');

  const remote = createNestedRepositories();
  const remoteSegment = privateMarker('REMOTE');
  git(remote.child, ['remote', 'add', 'origin', `https://example.test/${remoteSegment}.git`]);
  assertFailedWith(runBaseline(remote.child), 'remote-present', [remoteSegment]);

  const author = createNestedRepositories();
  write(author.child, 'public.txt');
  const identitySegment = privateMarker('IDENTITY');
  commit(author.child, ['public.txt'], 'Fixture', {
    GIT_AUTHOR_NAME: identitySegment,
    GIT_AUTHOR_EMAIL: 'different@example.test',
  });
  assertFailedWith(runBaseline(author.child), 'history-identity-mismatch', [identitySegment]);
});

test('working, tracked, and reachable-history disclosure failures all propagate and redact', () => {
  for (const surface of ['working', 'tracked', 'history']) {
    const { child } = createNestedRepositories();
    const marker = privateMarker(surface.toUpperCase());
    const token = credentialShape(surface[0].toUpperCase());
    const unsafePath = `nested-${marker}/fixture-${token}.txt`;
    write(child, unsafePath, `${marker}\n${token}\n`);
    if (surface !== 'working') commit(child, [unsafePath]);
    if (surface === 'history') {
      rmSync(join(child, unsafePath));
      git(child, ['add', '-u']);
      git(child, ['commit', '-m', 'Remove synthetic fixture']);
    }
    const result = runBaseline(child, [], {
      PUBLICATION_SENSITIVE_PATTERNS_JSON: JSON.stringify([marker]),
    });
    assertFailedWith(result, 'private-source-pattern', [marker, token, unsafePath]);
    const report = parseOutput(result);
    assert.ok(report.findings.some((finding) => finding.surface === surface));
  }

  const { child } = createNestedRepositories();
  write(child, 'AGENTS.md');
  assertFailedWith(runBaseline(child), 'operational-path', ['AGENTS.md']);
});

test('repeated artifact options scan all directories and missing artifacts fail closed', () => {
  const { fixture, child } = createNestedRepositories();
  const cleanArtifact = join(fixture, 'clean-artifact');
  const dirtyArtifact = join(fixture, 'dirty-artifact');
  mkdirSync(cleanArtifact);
  const marker = privateMarker('ARTIFACT');
  const token = credentialShape('R');
  const unsafeSegment = `nested-${marker}-${token}`;
  write(dirtyArtifact, `${unsafeSegment}/bundle.js`, `${marker}\n${token}\n`);

  const dirty = runBaseline(
    child,
    ['--artifact', cleanArtifact, '--artifact', dirtyArtifact],
    { PUBLICATION_SENSITIVE_PATTERNS_JSON: JSON.stringify([marker]) },
  );
  assertFailedWith(dirty, 'private-source-pattern', [marker, token, unsafeSegment, dirtyArtifact]);
  assert.equal(parseOutput(dirty).surfaces.filter(({ surface }) => surface === 'artifact').length, 2);
  const artifactSurfaces = parseOutput(dirty).surfaces.filter(({ surface }) => surface === 'artifact');
  assert.deepEqual(artifactSurfaces.map(({ artifactOrdinal }) => artifactOrdinal), [0, 1]);
  for (const surface of artifactSurfaces) assert.match(surface.artifactDigest, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(artifactSurfaces[0].artifactDigest, artifactSurfaces[1].artifactDigest);
  assert.equal(JSON.stringify(artifactSurfaces).includes(cleanArtifact), false);
  assert.equal(JSON.stringify(artifactSurfaces).includes(dirtyArtifact), false);

  const missingSegment = privateMarker('MISSING-ARTIFACT');
  const missing = join(fixture, missingSegment);
  assertFailedWith(runBaseline(child, ['--artifact', cleanArtifact, '--artifact', missing]), 'surface-inspection-failed', [missingSegment, missing]);
});

test('sensitive files enforce provenance through the aggregate CLI', () => {
  const accepted = createNestedRepositories();
  const marker = privateMarker('FILE');
  const outside = write(accepted.fixture, `${marker}-outside.json`, JSON.stringify([marker]));
  assert.equal(runBaseline(accepted.child, ['--sensitive-file', outside]).status, 0);

  write(accepted.child, '.gitignore', '.publication-sensitive-patterns\n');
  const ignored = write(accepted.child, '.publication-sensitive-patterns', JSON.stringify([marker]));
  assert.equal(runBaseline(accepted.child, ['--sensitive-file', ignored]).status, 0);

  for (const state of ['non-ignored', 'tracked', 'staged']) {
    const fixture = createNestedRepositories();
    const unsafeName = `${marker}-${state}.json`;
    const target = write(fixture.child, unsafeName, JSON.stringify([marker]));
    if (state === 'tracked') commit(fixture.child, [unsafeName]);
    if (state === 'staged') git(fixture.child, ['add', '--', unsafeName]);
    assertFailedWith(
      runBaseline(fixture.child, ['--sensitive-file', target]),
      'sensitive-input-unsafe',
      [marker, unsafeName, target],
    );
  }
});

test('parser and aggregate failures never reproduce caller-controlled sensitive arguments', () => {
  const { child } = createNestedRepositories();
  const marker = privateMarker('ARGUMENT');
  const result = runBaseline(child, ['--unknown', marker], {
    PUBLICATION_SENSITIVE_PATTERNS_JSON: JSON.stringify([marker]),
  });
  assertFailedWith(result, 'arguments-invalid', [marker]);
});

test('aggregate CLI runs through absolute, relative, and symlink entrypoints', () => {
  const toolsDirectory = dirname(BASELINE_URL.pathname);
  const linkRoot = mkdtempSync(join(tmpdir(), 'publication-baseline-link-'));
  const link = join(linkRoot, 'baseline-link.mjs');
  symlinkSync(BASELINE_URL.pathname, link, 'file');
  for (const invocation of [
    { cwd: toolsDirectory, entry: 'check-publication.mjs' },
    { cwd: toolsDirectory, entry: BASELINE_URL.pathname },
    { cwd: linkRoot, entry: link },
  ]) {
    const result = spawnSync(process.execPath, [invocation.entry, '--unknown', 'synthetic'], {
      cwd: invocation.cwd,
      encoding: 'utf8',
      env: cleanEnvironment(),
    });
    assert.notEqual(result.status, 0);
    assert.notEqual(`${result.stdout}${result.stderr}`.length, 0);
  }
});

test('the committed baseline test contains no contiguous runtime credential fixture', () => {
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  assert.equal(source.includes(credentialShape('A')), false);
});
