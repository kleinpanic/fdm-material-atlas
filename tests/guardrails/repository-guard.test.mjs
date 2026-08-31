import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  RepositoryGuardError,
  assertRepository,
  inspectRepository,
} from '../../tools/lib/repository-guard.mjs';

const MAINTAINER_NAME = 'Casey Maintainer';
const MAINTAINER_EMAIL = 'casey@example.test';

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      ...options.env,
    },
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initRepository(path) {
  mkdirSync(path, { recursive: true });
  git(path, ['init', '-b', 'main']);
}

function configureIdentity(path, name = MAINTAINER_NAME, email = MAINTAINER_EMAIL) {
  git(path, ['config', 'user.name', name]);
  git(path, ['config', 'user.email', email]);
}

function createNestedRepositories({ identity = true } = {}) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'repository-guard-'));
  const parent = join(fixtureRoot, 'parent');
  const child = join(parent, 'child');
  initRepository(parent);
  configureIdentity(parent);
  initRepository(child);
  if (identity) {
    configureIdentity(child);
  } else {
    configureIdentity(child, '', '');
  }
  return { fixtureRoot, parent: resolve(parent), child: resolve(child) };
}

function commitFile(repo, {
  filename = 'README.md',
  message = 'Add fixture',
  authorName = MAINTAINER_NAME,
  authorEmail = MAINTAINER_EMAIL,
  committerName = MAINTAINER_NAME,
  committerEmail = MAINTAINER_EMAIL,
} = {}) {
  writeFileSync(join(repo, filename), `${message}\n`);
  git(repo, ['add', filename]);
  git(repo, ['commit', '-m', message], {
    env: {
      GIT_AUTHOR_NAME: authorName,
      GIT_AUTHOR_EMAIL: authorEmail,
      GIT_COMMITTER_NAME: committerName,
      GIT_COMMITTER_EMAIL: committerEmail,
    },
  });
}

async function expectRule(promise, ruleCode, forbiddenValues = []) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof RepositoryGuardError);
    assert.equal(error.ruleCode, ruleCode);
    const serialized = JSON.stringify({ message: error.message, context: error.context });
    for (const value of forbiddenValues) assert.doesNotMatch(serialized, new RegExp(value, 'i'));
    return true;
  });
}

test('accepts an unborn independent nested repository without exposing identity', async () => {
  const { child } = createNestedRepositories();
  const inspection = await assertRepository({ cwd: child, expectedRoot: child, remotePolicy: 'absent' });

  assert.equal(inspection.repositoryRootMatches, true);
  assert.equal(inspection.commonDirectoryOwned, true);
  assert.equal(inspection.remoteCount, 0);
  assert.equal(inspection.identityConfigured, true);
  assert.equal(inspection.parentIndexEntryCount, 0);
  assert.equal(inspection.commitCount, 0);
  assert.equal(inspection.historyIdentityMatches, true);
  assert.doesNotMatch(JSON.stringify(inspection), /Casey Maintainer|casey@example\.test/i);
});

test('rejects a cwd that resolves to an ancestor repository', async () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'repository-guard-'));
  const parent = join(fixtureRoot, 'parent');
  const nested = join(parent, 'not-a-repository');
  initRepository(parent);
  configureIdentity(parent);
  mkdirSync(nested);

  await expectRule(
    assertRepository({ cwd: nested, expectedRoot: nested, remotePolicy: 'absent' }),
    'repository-root-mismatch',
  );
});

test('rejects Git files, linked worktrees, and symlinked external common directories', async () => {
  const gitFileFixture = createNestedRepositories();
  const externalGit = join(gitFileFixture.fixtureRoot, 'external-git');
  renameSync(join(gitFileFixture.child, '.git'), externalGit);
  writeFileSync(join(gitFileFixture.child, '.git'), `gitdir: ${externalGit}\n`);
  await expectRule(
    assertRepository({ cwd: gitFileFixture.child, expectedRoot: gitFileFixture.child, remotePolicy: 'absent' }),
    'common-directory-mismatch',
  );

  const symlinkFixture = createNestedRepositories();
  const symlinkTarget = join(symlinkFixture.fixtureRoot, 'external-git');
  renameSync(join(symlinkFixture.child, '.git'), symlinkTarget);
  symlinkSync(symlinkTarget, join(symlinkFixture.child, '.git'), 'dir');
  await expectRule(
    assertRepository({ cwd: symlinkFixture.child, expectedRoot: symlinkFixture.child, remotePolicy: 'absent' }),
    'common-directory-mismatch',
  );

  const linkedFixture = createNestedRepositories();
  const linkedPath = join(linkedFixture.fixtureRoot, 'linked-child');
  git(linkedFixture.child, ['worktree', 'add', '-b', 'linked-fixture', linkedPath]);
  configureIdentity(linkedPath);
  await expectRule(
    assertRepository({ cwd: linkedPath, expectedRoot: linkedPath, remotePolicy: 'absent' }),
    'common-directory-mismatch',
  );
});

test('rejects an ordinary parent index entry below the child path', async () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'repository-guard-'));
  const parent = join(fixtureRoot, 'parent');
  const child = join(parent, 'child');
  initRepository(parent);
  configureIdentity(parent);
  mkdirSync(child);
  writeFileSync(join(child, 'tracked-before-init.txt'), 'fixture\n');
  git(parent, ['add', 'child/tracked-before-init.txt']);
  initRepository(child);
  configureIdentity(child);

  await expectRule(
    assertRepository({ cwd: child, expectedRoot: child, remotePolicy: 'absent' }),
    'parent-index-entry',
  );
});

test('rejects a parent gitlink for the child repository', async () => {
  const { parent, child } = createNestedRepositories();
  commitFile(child);
  git(parent, ['add', 'child']);

  await expectRule(
    assertRepository({ cwd: child, expectedRoot: child, remotePolicy: 'absent' }),
    'parent-index-entry',
  );
});

test('rejects missing configured identity', async () => {
  const { child } = createNestedRepositories({ identity: false });
  await expectRule(
    assertRepository({ cwd: child, expectedRoot: child, remotePolicy: 'absent' }),
    'identity-missing',
  );
});

test('rejects prohibited AI or bot identity without echoing it', async () => {
  const { child } = createNestedRepositories();
  configureIdentity(child, 'Synthetic Automation Bot', 'automation@example.test');
  await expectRule(
    assertRepository({ cwd: child, expectedRoot: child, remotePolicy: 'absent' }),
    'identity-prohibited',
    ['Synthetic Automation Bot', 'automation@example.test'],
  );
});

test('rejects a remote when policy requires none without exposing its URL', async () => {
  const { child } = createNestedRepositories();
  const sensitiveRemote = 'https://example.test/private/fixture.git';
  git(child, ['remote', 'add', 'origin', sensitiveRemote]);
  await expectRule(
    assertRepository({ cwd: child, expectedRoot: child, remotePolicy: 'absent' }),
    'remote-present',
    ['private/fixture'],
  );

  const inspection = await inspectRepository({ cwd: child, expectedRoot: child, remotePolicy: 'any' });
  assert.equal(inspection.remoteCount, 1);
  assert.doesNotMatch(JSON.stringify(inspection), /private\/fixture/);
});

test('rejects a mismatched reachable commit author or committer', async () => {
  const { child } = createNestedRepositories();
  commitFile(child, { authorName: 'Different Person', authorEmail: 'different@example.test' });
  await expectRule(
    assertRepository({ cwd: child, expectedRoot: child, remotePolicy: 'absent' }),
    'history-identity-mismatch',
    ['Different Person', 'different@example.test'],
  );
});

test('rejects an AI co-author trailer without exposing the commit body', async () => {
  const { child } = createNestedRepositories();
  const sensitiveBody = 'Normal subject\n\nCo-authored-by: Codex <synthetic@example.test>';
  commitFile(child, { message: sensitiveBody });
  await expectRule(
    assertRepository({ cwd: child, expectedRoot: child, remotePolicy: 'absent' }),
    'history-prohibited-attribution',
    ['Codex', 'synthetic@example.test', 'Normal subject'],
  );
});

test('checks commits reachable from refs outside the current branch', async () => {
  const { child } = createNestedRepositories();
  commitFile(child);
  git(child, ['checkout', '-b', 'unsafe-history']);
  commitFile(child, { filename: 'unsafe.txt', authorName: 'Different Person' });
  git(child, ['checkout', 'main']);

  await expectRule(
    assertRepository({ cwd: child, expectedRoot: child, remotePolicy: 'absent' }),
    'history-identity-mismatch',
    ['Different Person'],
  );
});
