const PASSTHROUGH_KEYS = Object.freeze([
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
]);

/** Build a small, controlled environment for read-only Git inspection. */
export function buildGitEnvironment(source = process.env) {
  const environment = {};
  for (const key of PASSTHROUGH_KEYS) {
    if (typeof source[key] === 'string') environment[key] = source[key];
  }
  Object.assign(environment, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_LAZY_FETCH: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: '',
  });
  return environment;
}
