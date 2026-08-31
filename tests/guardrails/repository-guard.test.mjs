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
const EMPTY_GIT_CONFIG = join(mkdtempSync(join(tmpdir(), 'repository-git-config-')), 'config');
writeFileSync(EMPTY_GIT_CONFIG, '');

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: EMPTY_GIT_CONFIG,
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
    for (const value of forbiddenValues) {
      assert.equal(serialized.toLowerCase().includes(String(value).toLowerCase()), false);
    }
    return true;
  });
}

test('accepts an unborn independent nested repository without exposing identity', async () => {
  const { child } = createNestedRepositories();
  const inspection = await assertRepository({ cwd: child, expectedRoot: child, remotePolicy: 'absent' });

  assert.equal(inspection.repositoryRootMatches, true);
  assert.equal(inspection.commonDirectoryOwned, true);
  assert.equal(inspection.objectStoreOwned, true);
  assert.equal(inspection.remoteCount, 0);
  assert.equal(inspection.identityConfigured, true);
  assert.equal(inspection.parentIndexEntryCount, 0);
  assert.equal(inspection.commitCount, 0);
  assert.equal(inspection.historyIdentityMatches, true);
  assert.doesNotMatch(JSON.stringify(inspection), /Casey Maintainer|casey@example\.test/i);
  assert.equal(inspection.repositoryPresent, true);
  assert.equal(inspection.parentRepositoryPresent, true);
  assert.equal('repositoryRoot' in inspection, false);
  assert.equal('expectedRoot' in inspection, false);
  assert.equal('gitCommonDirectory' in inspection, false);
  assert.equal('parentRepositoryRoot' in inspection, false);
  assert.equal(JSON.stringify(inspection).includes(child), false);
});

test('invalid remote policy errors contain only redacted context', async () => {
  const { child } = createNestedRepositories();
  await expectRule(
    inspectRepository({ cwd: child, expectedRoot: child, remotePolicy: 'synthetic-invalid' }),
    'remote-policy-invalid',
    [child],
  );
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

test('exported inspection normalizes filesystem and corrupt-Git failures', async () => {
  const marker = 'SYNTHETIC-PRIVATE-INSPECTION-PATH';
  const missing = join(tmpdir(), marker, 'missing');
  await expectRule(inspectRepository({ cwd: missing, expectedRoot: missing }), 'repository-inspection-failed', [marker]);

  const { child } = createNestedRepositories();
  commitFile(child);
  writeFileSync(join(child, '.git', 'refs', 'heads', 'main'), 'not-an-object-id\n');
  await expectRule(
    inspectRepository({ cwd: child, expectedRoot: child }),
    'repository-inspection-failed',
    [],
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

test('rejects shared clones and symlinked object databases', async () => {
  const sharedSource = createNestedRepositories();
  commitFile(sharedSource.child);
  const shared = join(sharedSource.fixtureRoot, 'shared-child');
  git(sharedSource.fixtureRoot, ['clone', '--shared', sharedSource.child, shared]);
  configureIdentity(shared);
  await expectRule(
    assertRepository({ cwd: shared, expectedRoot: shared, remotePolicy: 'any' }),
    'external-object-store',
  );

  const symlinkFixture = createNestedRepositories();
  commitFile(symlinkFixture.child);
  const objects = join(symlinkFixture.child, '.git', 'objects');
  const externalObjects = join(symlinkFixture.fixtureRoot, 'external-objects');
  renameSync(objects, externalObjects);
  symlinkSync(externalObjects, objects, 'dir');
  await expectRule(
    assertRepository({ cwd: symlinkFixture.child, expectedRoot: symlinkFixture.child }),
    'external-object-store',
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

test('rejects common configured automation and exact AI identities', async () => {
  for (const [name, email] of [
    ['AI', 'person@example.test'],
    ['Artificial Intelligence', 'person@example.test'],
    ['Dependabot', 'dependabot@users.noreply.github.com'],
    ['Renovate', 'renovate[bot]@users.noreply.github.com'],
    ['GitHub Actions', 'github-actions[bot]@users.noreply.github.com'],
    ['Automation', 'automation@users.noreply.github.com'],
  ]) {
    const { child } = createNestedRepositories();
    configureIdentity(child, name, email);
    await expectRule(
      assertRepository({ cwd: child, expectedRoot: child }),
      'identity-prohibited',
      name === 'AI' ? [email] : [name, email],
    );
  }
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

test('rejects reviewed AI attribution aliases in author, committer, and co-author positions', async () => {
  const aliases = [
    'Codex', 'OpenAI', 'Claude', 'Anthropic', 'ChatGPT', 'GitHub Copilot',
    'Gemini', 'Grok', 'Cursor', 'Kimi', 'MiniMax', 'GLM', 'opencode', 'GSD',
    'AI Agent', 'Build Bot',
    'AI', 'Artificial Intelligence', 'dependabot', 'renovate[bot]',
    'github-actions[bot]', 'automation@users.noreply.github.com',
  ];
  for (const alias of aliases) {
    for (const position of ['author', 'committer', 'co-author']) {
      const { child } = createNestedRepositories();
      const options = {};
      if (position === 'author') options.authorName = alias;
      if (position === 'committer') options.committerName = alias;
      if (position === 'co-author') {
        options.message = `Ordinary subject\n\nCo-authored-by: ${alias} <synthetic@example.test>`;
      }
      commitFile(child, options);
      await expectRule(
        assertRepository({ cwd: child, expectedRoot: child, remotePolicy: 'absent' }),
        'history-prohibited-attribution',
        alias === 'AI' ? [] : [alias],
      );
    }
  }
});

test('allows human names that contain harmless attribution substrings', async () => {
  for (const name of ['Robin Botwin', 'Geminius Stone', 'Grokowski Reed', 'Cursorly Jones']) {
    const { child } = createNestedRepositories();
    configureIdentity(child, name, 'human@example.test');
    commitFile(child, { authorName: name, authorEmail: 'human@example.test', committerName: name, committerEmail: 'human@example.test' });
    const inspection = await assertRepository({ cwd: child, expectedRoot: child, remotePolicy: 'absent' });
    assert.equal(inspection.historyAttributionAllowed, true);
  }
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

test('rejects shallow and promisor repositories before auditing history', async () => {
  const sourceFixture = createNestedRepositories();
  commitFile(sourceFixture.child, { filename: 'first.txt', message: 'First fixture' });
  commitFile(sourceFixture.child, { filename: 'second.txt', message: 'Second fixture' });
  const shallow = join(sourceFixture.fixtureRoot, 'shallow');
  git(sourceFixture.fixtureRoot, ['clone', '--depth', '1', `file://${sourceFixture.child}`, shallow]);
  configureIdentity(shallow);
  await expectRule(
    assertRepository({ cwd: shallow, expectedRoot: shallow, remotePolicy: 'any' }),
    'history-incomplete',
  );

  const partialFixture = createNestedRepositories();
  git(partialFixture.child, ['config', 'extensions.partialClone', 'synthetic-origin']);
  await expectRule(
    assertRepository({ cwd: partialFixture.child, expectedRoot: partialFixture.child, remotePolicy: 'absent' }),
    'history-incomplete',
  );
});

test('rejects replacement refs and grafts before inspecting publishable history', async () => {
  const replacementFixture = createNestedRepositories();
  commitFile(replacementFixture.child, {
    filename: 'original.txt',
    authorName: 'Different Person',
    authorEmail: 'different@example.test',
  });
  const original = git(replacementFixture.child, ['rev-parse', 'HEAD']);
  git(replacementFixture.child, ['checkout', '--orphan', 'replacement-fixture']);
  git(replacementFixture.child, ['rm', '-rf', '.']);
  commitFile(replacementFixture.child, { filename: 'replacement.txt', message: 'Safe replacement' });
  const replacement = git(replacementFixture.child, ['rev-parse', 'HEAD']);
  git(replacementFixture.child, ['checkout', 'main']);
  git(replacementFixture.child, ['replace', original, replacement]);
  await expectRule(
    assertRepository({ cwd: replacementFixture.child, expectedRoot: replacementFixture.child }),
    'history-unsupported',
  );

  const graftFixture = createNestedRepositories();
  commitFile(graftFixture.child, { filename: 'first.txt', message: 'First' });
  commitFile(graftFixture.child, { filename: 'second.txt', message: 'Second' });
  const head = git(graftFixture.child, ['rev-parse', 'HEAD']);
  writeFileSync(join(graftFixture.child, '.git', 'info', 'grafts'), `${head}\n`);
  await expectRule(
    assertRepository({ cwd: graftFixture.child, expectedRoot: graftFixture.child }),
    'history-unsupported',
  );
});
