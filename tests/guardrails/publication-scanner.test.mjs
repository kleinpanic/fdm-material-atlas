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

const SCANNER_URL = new URL('../../tools/scan-publication.mjs', import.meta.url);
const POLICY_URL = new URL('../../tools/lib/publication-policy.mjs', import.meta.url);
const PROHIBITED_PATHS_URL = new URL('../../tools/lib/prohibited-paths.mjs', import.meta.url);
const SAFE_GIT_URL = new URL('../../tools/lib/safe-git.mjs', import.meta.url);
const SAFE_FILE_URL = new URL('../../tools/lib/safe-file.mjs', import.meta.url);
const EMPTY_GIT_CONFIG = join(mkdtempSync(join(tmpdir(), 'publication-git-config-')), 'config');
writeFileSync(EMPTY_GIT_CONFIG, '');
const MAINTAINER_NAME = 'Casey Maintainer';
const MAINTAINER_EMAIL = 'casey@example.test';

function git(cwd, args, options = {}) {
  const environment = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: EMPTY_GIT_CONFIG,
    ...options.env,
  };
  delete environment.GIT_AUTHOR_NAME;
  delete environment.GIT_AUTHOR_EMAIL;
  delete environment.GIT_COMMITTER_NAME;
  delete environment.GIT_COMMITTER_EMAIL;
  return execFileSync('git', args, {
    cwd,
    encoding: options.encoding ?? 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'publication-scanner-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', MAINTAINER_NAME]);
  git(root, ['config', 'user.email', MAINTAINER_EMAIL]);
  return resolve(root);
}

function write(root, relativePath, content) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

function commit(root, paths, message = 'Synthetic fixture') {
  git(root, ['add', '--', ...paths]);
  git(root, ['commit', '-m', message]);
}

function privateMarker(suffix = 'A') {
  return ['SYNTHETIC', 'PRIVATE', 'SOURCE', suffix].join('-');
}

function credentialShape(suffix = 'A') {
  return ['gh', 'p_', 'A'.repeat(34), suffix].join('');
}

function privateKeyShape() {
  return ['-----BEGIN ', 'PRIVATE KEY', '-----\n', 'synthetic-fixture', '\n-----END ', 'PRIVATE KEY', '-----'].join('');
}

function additionalCredentialShapes() {
  return [
    ['github', '_pat_', 'A'.repeat(52)].join(''),
    ['AI', 'za', 'B'.repeat(35)].join(''),
    ['ya', '29.', 'C'.repeat(24)].join(''),
    ['1', '//', 'D'.repeat(34)].join(''),
    ['session', '_token=', 'E'.repeat(20)].join(''),
    ['cookie', ':', 'F'.repeat(20)].join(''),
    ['-----BEGIN ', 'ENCRYPTED PRIVATE KEY', '-----'].join(''),
  ];
}

async function loadInterfaces() {
  try {
    const [scanner, policy] = await Promise.all([import(SCANNER_URL), import(POLICY_URL)]);
    const required = [
      [scanner, 'scanPublication'],
      [scanner, 'scanBytes'],
      [scanner, 'scanPath'],
      [policy, 'loadPublicationPolicy'],
      [policy, 'loadExactPatterns'],
      [policy, 'formatFinding'],
    ];
    if (required.some(([module, name]) => typeof module[name] !== 'function')) {
      const error = new Error('ERR_PUBLICATION_SCANNER_INTERFACE_MISSING');
      error.code = 'ERR_PUBLICATION_SCANNER_INTERFACE_MISSING';
      throw error;
    }
    return { ...scanner, ...policy };
  } catch (error) {
    if (
      error?.code === 'ERR_MODULE_NOT_FOUND' ||
      error?.code === 'ERR_PUBLICATION_SCANNER_INTERFACE_MISSING'
    ) {
      const contractError = new Error('ERR_PUBLICATION_SCANNER_INTERFACE_MISSING');
      contractError.code = 'ERR_PUBLICATION_SCANNER_INTERFACE_MISSING';
      throw contractError;
    }
    throw error;
  }
}

function assertRedacted(value, forbidden = []) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const item of forbidden) assert.equal(serialized.includes(item), false);
  const findings = value?.findings ?? [];
  for (const finding of findings) {
    assert.match(finding.safeLocation, /^(?:sha256:[a-f0-9]{64}|object:[a-f0-9]{40,64})$/);
    assert.deepEqual(
      Object.keys(finding).sort(),
      Object.keys(finding).filter((key) => ['objectType', 'ruleId', 'safeLocation', 'surface'].includes(key)).sort(),
    );
  }
}

test('scanner contract is available', async () => {
  const marker = process.env.PUBLICATION_TEST_LEAK_MARKER ?? privateMarker('CONTRACT');
  try {
    const api = await loadInterfaces();
    assert.equal(typeof api.scanPublication, 'function');
  } catch (error) {
    assert.equal(String(error).includes(marker), false);
    throw error;
  }
});

test('Git child environment excludes private-source and credential variables', async () => {
  const { buildGitEnvironment } = await import(SAFE_GIT_URL);
  const source = {
    ...process.env,
    PUBLICATION_SENSITIVE_PATTERNS_JSON: 'synthetic-pattern',
    GOG_TOKEN: 'synthetic-gog',
    OAUTH_ACCESS_TOKEN: 'synthetic-oauth',
    [String.raw`SERVICE_${'COOKIE'}`]: ['synthetic', '-cookie'].join(''),
    GIT_CONFIG_GLOBAL: '/synthetic/injected-config',
    GIT_SSH_COMMAND: 'synthetic-helper',
  };
  const helper = spawnSync(
    process.execPath,
    ['-e', 'process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))'],
    { encoding: 'utf8', env: buildGitEnvironment(source) },
  );
  assert.equal(helper.status, 0);
  const names = JSON.parse(helper.stdout);
  for (const name of [
    'PUBLICATION_SENSITIVE_PATTERNS_JSON',
    'GOG_TOKEN',
    'OAUTH_ACCESS_TOKEN',
    'SERVICE_COOKIE',
    'GIT_CONFIG_GLOBAL',
    'GIT_SSH_COMMAND',
  ]) assert.equal(names.includes(name), false, name);
  assert.ok(names.includes('GIT_NO_LAZY_FETCH'));
  assert.ok(names.includes('GIT_CONFIG_COUNT'));
});

test('all four modes accept clean synthetic surfaces, including unborn history', async () => {
  const { loadPublicationPolicy, scanPublication } = await loadInterfaces();
  const root = createRepository();
  const artifact = join(root, 'clean-artifact');
  mkdirSync(artifact);
  write(root, 'safe file.txt', 'ordinary public material data\n');
  write(artifact, 'index.html', '<main>Safe fixture</main>');
  const policy = await loadPublicationPolicy({ root, env: {} });

  for (const mode of ['working', 'tracked', 'history']) {
    const report = await scanPublication({ root, mode, policy });
    assert.equal(report.findings.length, 0, mode);
  }
  const artifactReport = await scanPublication({ root, mode: 'artifact', artifactPath: artifact, policy });
  assert.equal(artifactReport.findings.length, 0);
});

test('working and tracked modes reject operational paths with NUL-safe names', async () => {
  const { loadPublicationPolicy, scanPublication } = await loadInterfaces();
  const root = createRepository();
  const oddPath = 'safe space\nline.txt';
  write(root, oddPath, 'safe\n');
  write(root, 'AGENTS.md', 'harmless fixture\n');
  const policy = await loadPublicationPolicy({ root, env: {} });

  const working = await scanPublication({ root, mode: 'working', policy });
  assert.ok(working.findings.some(({ ruleId }) => ruleId === 'operational-path'));
  assert.equal(working.scannedCount, 2);
  assertRedacted(working, ['AGENTS.md', oddPath]);

  commit(root, [oddPath, 'AGENTS.md']);
  const tracked = await scanPublication({ root, mode: 'tracked', policy });
  assert.ok(tracked.findings.some(({ ruleId }) => ruleId === 'operational-path'));
  assert.equal(tracked.scannedCount, 2);
  assertRedacted(tracked, ['AGENTS.md', oddPath]);
});

test('canonical model-operation path classes are ignored and rejected on every public surface', async () => {
  const [{ PROHIBITED_PATH_CLASSES }, { loadPublicationPolicy, scanPublication }] = await Promise.all([
    import(PROHIBITED_PATHS_URL),
    loadInterfaces(),
  ]);
  const publicIgnore = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8').split(/\r?\n/);
  for (const { ignore } of PROHIBITED_PATH_CLASSES) assert.ok(publicIgnore.includes(ignore), ignore);

  const root = createRepository();
  const policy = await loadPublicationPolicy({ root, env: {} });
  for (const { fixture } of PROHIBITED_PATH_CLASSES) write(root, fixture, 'synthetic operating fixture\n');
  const working = await scanPublication({ root, mode: 'working', policy });
  assert.ok(working.findings.filter(({ ruleId }) => ruleId === 'operational-path').length >= PROHIBITED_PATH_CLASSES.length);

  git(root, ['add', '-f', '--', ...PROHIBITED_PATH_CLASSES.map(({ fixture }) => fixture)]);
  git(root, ['commit', '-m', 'Add prohibited fixtures']);
  for (const mode of ['tracked', 'history']) {
    const report = await scanPublication({ root, mode, policy });
    assert.ok(report.findings.filter(({ ruleId }) => ruleId === 'operational-path').length >= PROHIBITED_PATH_CLASSES.length, mode);
  }

  write(root, 'safe.txt', 'safe\n');
  git(root, ['add', '--', 'safe.txt']);
  git(root, ['commit', '-m', 'Add safe ref target']);
  git(root, ['update-ref', 'refs/custom/session-handoff.md', 'HEAD']);
  const refs = await scanPublication({ root, mode: 'history', policy });
  assert.ok(refs.findings.some(({ ruleId, objectType }) => (
    ruleId === 'operational-path' && objectType === 'ref'
  )));
});

test('environment exact patterns are detected and redacted across every mode', async () => {
  const { loadPublicationPolicy, scanPublication } = await loadInterfaces();
  const root = createRepository();
  const marker = privateMarker('ENV');
  const nested = `nested-${marker}/file-${credentialShape('P')}.bin`;
  write(root, nested, Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(marker)]));
  const policy = await loadPublicationPolicy({
    root,
    env: { PUBLICATION_SENSITIVE_PATTERNS_JSON: JSON.stringify([marker]) },
  });

  const working = await scanPublication({ root, mode: 'working', policy });
  assert.ok(working.findings.some(({ ruleId }) => ruleId === 'private-source-pattern'));
  assertRedacted(working, [marker, credentialShape('P')]);

  commit(root, [nested]);
  for (const mode of ['tracked', 'history']) {
    const report = await scanPublication({ root, mode, policy });
    assert.ok(report.findings.some(({ ruleId }) => ruleId === 'private-source-pattern'), mode);
    assertRedacted(report, [marker, credentialShape('P')]);
  }

  const artifactRoot = mkdtempSync(join(tmpdir(), 'publication-artifact-'));
  write(artifactRoot, nested, marker);
  const artifact = await scanPublication({ root, mode: 'artifact', artifactPath: artifactRoot, policy });
  assert.ok(artifact.findings.some(({ ruleId }) => ruleId === 'private-source-pattern'));
  assertRedacted(artifact, [marker, credentialShape('P')]);
});

test('sensitive files obey the outside-root or ignored, unstaged, untracked invariant', async () => {
  const { loadExactPatterns } = await loadInterfaces();
  const root = createRepository();
  const marker = privateMarker('FILE');
  const outside = write(dirname(root), `${marker}-outside.json`, JSON.stringify([marker]));
  const ignored = write(root, '.publication-sensitive-patterns', JSON.stringify([marker]));
  write(root, '.gitignore', '.publication-sensitive-patterns\n');

  assert.equal((await loadExactPatterns({ root, env: {}, sensitiveFile: outside })).length, 1);
  assert.equal((await loadExactPatterns({ root, env: {}, sensitiveFile: ignored })).length, 1);

  for (const state of ['non-ignored', 'tracked', 'staged']) {
    const caseRoot = createRepository();
    const unsafeName = `${marker}-${state}.json`;
    const target = write(caseRoot, unsafeName, JSON.stringify([marker]));
    if (state === 'tracked') commit(caseRoot, [unsafeName]);
    if (state === 'staged') git(caseRoot, ['add', '--', unsafeName]);
    await assert.rejects(
      loadExactPatterns({ root: caseRoot, env: {}, sensitiveFile: target }),
      (error) => {
        assert.equal(error.ruleId, 'sensitive-input-unsafe');
        assertRedacted(String(error), [marker, unsafeName]);
        return true;
      },
    );
  }
});

test('default sensitive input is optional only when absent and rejects unusable entries', async () => {
  const { loadExactPatterns } = await loadInterfaces();
  const absentRoot = createRepository();
  assert.deepEqual(await loadExactPatterns({ root: absentRoot, env: {} }), []);

  for (const kind of ['directory', 'symlink']) {
    const root = createRepository();
    const selected = join(root, '.publication-sensitive-patterns');
    if (kind === 'directory') {
      mkdirSync(selected);
    } else {
      const outside = write(dirname(root), `${privateMarker('DEFAULT-LINK')}.json`, JSON.stringify(['safe']));
      symlinkSync(outside, selected, 'file');
    }
    await assert.rejects(
      loadExactPatterns({ root, env: {} }),
      (error) => error.ruleId === 'sensitive-input-inspection-failed',
      kind,
    );
  }
});

test('environment and explicit sensitive files merge without ambient precedence', async () => {
  const { loadPublicationPolicy, scanPublication } = await loadInterfaces();
  const root = createRepository();
  const environmentMarker = privateMarker('MERGED-ENV');
  const fileMarker = privateMarker('MERGED-FILE');
  write(root, '.gitignore', '.publication-sensitive-patterns\n');
  const sensitiveFile = write(
    root,
    '.publication-sensitive-patterns',
    JSON.stringify([fileMarker, fileMarker]),
  );
  write(root, 'fixture.txt', `${environmentMarker}\n${fileMarker}\n`);
  const policy = await loadPublicationPolicy({
    root,
    sensitiveFile,
    env: { PUBLICATION_SENSITIVE_PATTERNS_JSON: JSON.stringify([environmentMarker]) },
  });
  assert.equal(policy.exactPatterns.length, 2);
  const report = await scanPublication({ root, mode: 'working', policy });
  assert.equal(report.findings.filter(({ ruleId }) => ruleId === 'private-source-pattern').length, 1);
  assertRedacted(report, [environmentMarker, fileMarker]);
});

test('exact-pattern documents enforce redacted size, count, and total bounds', async () => {
  const { loadExactPatterns } = await loadInterfaces();
  const root = createRepository();
  const cases = [
    JSON.stringify(['x'.repeat(4097)]),
    JSON.stringify(Array.from({ length: 129 }, (_, index) => `pattern-${index}`)),
    JSON.stringify(Array.from({ length: 32 }, (_, index) => `${index}-${'x'.repeat(3000)}`)),
    JSON.stringify(['x'.repeat(1024 * 1024)]),
  ];
  for (const document of cases) {
    await assert.rejects(
      loadExactPatterns({ root, env: { PUBLICATION_SENSITIVE_PATTERNS_JSON: document } }),
      (error) => {
        assert.ok(['sensitive-input-invalid', 'sensitive-input-too-large'].includes(error.ruleId));
        assertRedacted(String(error), [document.slice(-48)]);
        return true;
      },
    );
  }
});

test('ignored-file exact patterns are detected in every surface', async () => {
  const { loadPublicationPolicy, scanPublication } = await loadInterfaces();
  const root = createRepository();
  const marker = privateMarker('IGNORED');
  write(root, '.gitignore', '.publication-sensitive-patterns\n');
  write(root, '.publication-sensitive-patterns', JSON.stringify([marker]));
  const policy = await loadPublicationPolicy({ root, env: {}, sensitiveFile: join(root, '.publication-sensitive-patterns') });

  for (const mode of ['working', 'tracked', 'history']) {
    const fixture = `fixture-${mode}.txt`;
    write(root, fixture, marker);
    if (mode !== 'working') commit(root, [fixture], `Add ${mode} fixture`);
    const report = await scanPublication({ root, mode, policy });
    assert.ok(report.findings.some(({ ruleId }) => ruleId === 'private-source-pattern'));
    assertRedacted(report, [marker]);
    if (mode !== 'history') rmSync(join(root, fixture));
  }

  const artifact = mkdtempSync(join(tmpdir(), 'publication-artifact-'));
  write(artifact, 'bundle.bin', Buffer.from(marker));
  const report = await scanPublication({ root, mode: 'artifact', artifactPath: artifact, policy });
  assert.ok(report.findings.some(({ ruleId }) => ruleId === 'private-source-pattern'));
  assertRedacted(report, [marker]);
});

test('credential shapes and private key fixtures are detected without disclosure', async () => {
  const { loadPublicationPolicy, scanPublication } = await loadInterfaces();
  const root = createRepository();
  const token = credentialShape('Z');
  const key = privateKeyShape();
  write(root, `nested-${token}/fixture.txt`, `${token}\n${key}\n`);
  const policy = await loadPublicationPolicy({ root, env: {} });
  const report = await scanPublication({ root, mode: 'working', policy });

  assert.ok(report.findings.some(({ ruleId }) => ruleId === 'credential-signature'));
  assertRedacted(report, [token, key, `nested-${token}`]);
});

test('current GitHub, Google, session, and encrypted-key credential shapes are detected', async () => {
  const { loadPublicationPolicy, scanBytes } = await loadInterfaces();
  const root = createRepository();
  const policy = await loadPublicationPolicy({ root, env: {} });
  for (const value of additionalCredentialShapes()) {
    const findings = scanBytes(Buffer.from(value), {
      policy,
      surface: 'working',
      location: Buffer.from('synthetic-fixture'),
      objectType: 'file',
    });
    assert.ok(findings.some(({ ruleId }) => ruleId === 'credential-signature'), value.slice(0, 8));
    assertRedacted({ findings }, [value]);
  }
});

test('unsafe source maps and generated metadata are rejected in tracked and artifact modes', async () => {
  const { loadPublicationPolicy, scanPublication } = await loadInterfaces();
  const root = createRepository();
  write(root, 'bundle.js.map', JSON.stringify({ version: 3, sourcesContent: ['synthetic source'] }));
  git(root, ['add', '-f', '--', 'bundle.js.map']);
  git(root, ['commit', '-m', 'Add generated fixture']);
  const policy = await loadPublicationPolicy({ root, env: {} });
  const tracked = await scanPublication({ root, mode: 'tracked', policy });
  assert.ok(tracked.findings.some(({ ruleId }) => ruleId === 'unsafe-source-map'));

  const artifact = mkdtempSync(join(tmpdir(), 'publication-artifact-'));
  write(artifact, 'meta/build.json', JSON.stringify({ sourceRoot: '/synthetic/build/root' }));
  write(artifact, 'manifest.json', JSON.stringify({ sourcesContent: ['synthetic embedded source'] }));
  write(artifact, '_astro/stats.json', JSON.stringify({ output: 'file:///synthetic/workspace/app.js' }));
  const built = await scanPublication({ root, mode: 'artifact', artifactPath: artifact, policy });
  assert.equal(
    built.findings.filter(({ ruleId }) => ruleId === 'unsafe-generated-metadata').length,
    3,
  );
});

test('inline and external source-map directives are rejected on every stored-code surface', async () => {
  const { loadPublicationPolicy, scanPublication } = await loadInterfaces();
  const root = createRepository();
  const inline = ['//# sourceMapping', 'URL=', 'data:application/json;base64,', 'e30='].join('');
  write(root, 'bundle.js', inline);
  commit(root, ['bundle.js']);
  const policy = await loadPublicationPolicy({ root, env: {} });
  for (const mode of ['tracked', 'history']) {
    const report = await scanPublication({ root, mode, policy });
    assert.ok(report.findings.some(({ ruleId }) => ruleId === 'unsafe-source-map'), mode);
  }

  const artifact = mkdtempSync(join(tmpdir(), 'publication-artifact-'));
  write(artifact, 'styles.css', ['/*# sourceMapping', 'URL=styles.css.map */'].join(''));
  const built = await scanPublication({ root, mode: 'artifact', artifactPath: artifact, policy });
  assert.ok(built.findings.some(({ ruleId }) => ruleId === 'unsafe-source-map'));
});

test('history finds content removed from the current tree and scans reachable side refs', async () => {
  const { loadPublicationPolicy, scanPublication } = await loadInterfaces();
  const root = createRepository();
  const marker = privateMarker('HISTORY');
  const policy = await loadPublicationPolicy({
    root,
    env: { PUBLICATION_SENSITIVE_PATTERNS_JSON: JSON.stringify([marker]) },
  });
  write(root, 'temporary.txt', marker);
  commit(root, ['temporary.txt'], `Message ${marker}`);
  rmSync(join(root, 'temporary.txt'));
  git(root, ['add', '-u']);
  git(root, ['commit', '-m', 'Remove temporary fixture']);
  git(root, ['branch', 'reachable-side-ref']);

  const working = await scanPublication({ root, mode: 'working', policy });
  assert.equal(working.findings.length, 0);
  const history = await scanPublication({ root, mode: 'history', policy });
  assert.ok(history.findings.some(({ ruleId }) => ruleId === 'private-source-pattern'));
  assertRedacted(history, [marker]);
});

test('history scans branch, tag, note, and unusual ref names without disclosure', async () => {
  const { loadPublicationPolicy, scanPublication } = await loadInterfaces();
  const root = createRepository();
  write(root, 'seed.txt', 'safe\n');
  commit(root, ['seed.txt']);
  const marker = privateMarker('REF');
  const policy = await loadPublicationPolicy({
    root,
    env: { PUBLICATION_SENSITIVE_PATTERNS_JSON: JSON.stringify([marker]) },
  });
  git(root, ['branch', `feature-${marker}`]);
  git(root, ['tag', `release-${marker}`]);
  git(root, ['update-ref', `refs/notes/topic-${marker}`, 'HEAD']);
  git(root, ['update-ref', `refs/custom/space-safe-${marker}`, 'HEAD']);

  const report = await scanPublication({ root, mode: 'history', policy });
  assert.ok(report.findings.some(({ ruleId, objectType }) => (
    ruleId === 'private-source-pattern' && objectType === 'ref'
  )));
  assertRedacted(report, [marker]);
});

test('tracked and history scans preserve symlink and gitlink modes', async () => {
  const { loadPublicationPolicy, scanPublication } = await loadInterfaces();
  const root = createRepository();
  write(root, 'seed.txt', 'safe\n');
  commit(root, ['seed.txt']);
  symlinkSync('../outside-target', join(root, 'relative-link'));
  symlinkSync('/synthetic/absolute-target', join(root, 'absolute-link'));
  git(root, ['add', '--', 'relative-link', 'absolute-link']);
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  git(root, ['update-index', '--add', '--cacheinfo', `160000,${head},synthetic-submodule`]);
  git(root, ['commit', '-m', 'Add link fixtures']);
  const policy = await loadPublicationPolicy({ root, env: {} });

  for (const mode of ['tracked', 'history']) {
    const report = await scanPublication({ root, mode, policy });
    assert.ok(report.findings.some(({ ruleId }) => ruleId === 'unsafe-symlink'), mode);
    assert.ok(report.findings.some(({ ruleId }) => ruleId === 'unsafe-gitlink'), mode);
    assertRedacted(report, ['outside-target', 'absolute-target', 'synthetic-submodule']);
  }
});

test('malformed input and missing, unreadable, or escaping surfaces fail closed and redact errors', async () => {
  const { loadExactPatterns, loadPublicationPolicy, scanPublication } = await loadInterfaces();
  const root = createRepository();
  const marker = privateMarker('ERROR');

  await assert.rejects(
    loadExactPatterns({ root, env: { PUBLICATION_SENSITIVE_PATTERNS_JSON: `[${marker}` } }),
    (error) => {
      assert.equal(error.ruleId, 'sensitive-input-invalid');
      assertRedacted(String(error), [marker]);
      return true;
    },
  );

  const policy = await loadPublicationPolicy({ root, env: {} });
  await assert.rejects(
    scanPublication({ root, mode: 'artifact', artifactPath: join(root, marker), policy }),
    (error) => {
      assert.equal(error.ruleId, 'surface-inspection-failed');
      assertRedacted(String(error), [marker]);
      return true;
    },
  );

  const artifact = mkdtempSync(join(tmpdir(), 'publication-artifact-'));
  const outside = write(dirname(artifact), `${marker}-outside.txt`, 'safe');
  const link = join(artifact, 'escape-link');
  symlinkSync(outside, link, 'file');
  const symlinkReport = await scanPublication({ root, mode: 'artifact', artifactPath: artifact, policy });
  assert.ok(symlinkReport.findings.some(({ ruleId }) => ruleId === 'unsafe-symlink'));
  assertRedacted(symlinkReport, [marker]);

});

test('artifact scans reject a symlink root and return a deterministic content digest', async () => {
  const { loadPublicationPolicy, scanPublication } = await loadInterfaces();
  const root = createRepository();
  const policy = await loadPublicationPolicy({ root, env: {} });
  const artifact = mkdtempSync(join(tmpdir(), 'publication-artifact-'));
  write(artifact, 'index.html', '<main>safe</main>');
  const first = await scanPublication({ root, mode: 'artifact', artifactPath: artifact, policy });
  const second = await scanPublication({ root, mode: 'artifact', artifactPath: artifact, policy });
  assert.match(first.artifactDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.artifactDigest, second.artifactDigest);

  const linkRoot = mkdtempSync(join(tmpdir(), 'publication-artifact-link-'));
  const link = join(linkRoot, 'dist');
  symlinkSync(artifact, link, 'dir');
  await assert.rejects(
    scanPublication({ root, mode: 'artifact', artifactPath: link, policy }),
    (error) => error.ruleId === 'surface-inspection-failed',
  );
});

test('stable file reader exposes a controlled failure seam without privilege assumptions', async () => {
  const { readStableFile, SafeFileError } = await import(SAFE_FILE_URL);
  const marker = privateMarker('OPEN-FAILURE');
  await assert.rejects(
    readStableFile(marker, {
      openFile: async () => { throw new Error(`uncontrolled ${marker}`); },
    }),
    (error) => {
      assert.ok(error instanceof SafeFileError);
      assert.equal(error.ruleId, 'file-inspection-failed');
      assertRedacted(String(error), [marker]);
      return true;
    },
  );
});

test('CLI returns nonzero with redacted stdout and stderr', async () => {
  const root = createRepository();
  const marker = privateMarker('CLI');
  write(root, `nested-${marker}/fixture.txt`, marker);
  const result = spawnSync(process.execPath, [SCANNER_URL.pathname, '--mode', 'working', '--root', root], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PUBLICATION_SENSITIVE_PATTERNS_JSON: JSON.stringify([marker]),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: EMPTY_GIT_CONFIG,
    },
  });
  assert.notEqual(result.status, 0);
  assertRedacted(`${result.stdout}${result.stderr}`, [marker]);
});

test('scanner CLI runs through absolute, relative, and symlink entrypoints', () => {
  const toolsDirectory = dirname(SCANNER_URL.pathname);
  const linkRoot = mkdtempSync(join(tmpdir(), 'publication-scanner-link-'));
  const link = join(linkRoot, 'scanner-link.mjs');
  symlinkSync(SCANNER_URL.pathname, link, 'file');
  for (const invocation of [
    { cwd: toolsDirectory, entry: 'scan-publication.mjs' },
    { cwd: toolsDirectory, entry: SCANNER_URL.pathname },
    { cwd: linkRoot, entry: link },
  ]) {
    const result = spawnSync(process.execPath, [invocation.entry, '--invalid', 'synthetic'], {
      cwd: invocation.cwd,
      encoding: 'utf8',
      env: process.env,
    });
    assert.notEqual(result.status, 0);
    assert.notEqual(`${result.stdout}${result.stderr}`.length, 0);
  }
});

test('the committed test source contains no contiguous runtime credential fixture', () => {
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  assert.equal(source.includes(credentialShape('A')), false);
  assert.equal(source.includes(privateKeyShape()), false);
  for (const value of additionalCredentialShapes()) assert.equal(source.includes(value), false);
});
