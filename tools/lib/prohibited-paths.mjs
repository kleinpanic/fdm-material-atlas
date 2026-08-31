/** Canonical public-history exclusions for AI and agent operating artifacts. */
export const PROHIBITED_PATH_CLASSES = Object.freeze([
  { ignore: '.planning/', pattern: /(?:^|\/)\.planning(?:\/|$)/i, fixture: '.planning/state.json' },
  { ignore: '.claude/', pattern: /(?:^|\/)\.claude(?:\/|$)/i, fixture: '.claude/settings.json' },
  { ignore: '.codex/', pattern: /(?:^|\/)\.codex(?:\/|$)/i, fixture: '.codex/config.json' },
  { ignore: '.agents/', pattern: /(?:^|\/)\.agents(?:\/|$)/i, fixture: '.agents/state.json' },
  { ignore: '.gsd/', pattern: /(?:^|\/)\.gsd(?:\/|$)/i, fixture: '.gsd/activity.jsonl' },
  { ignore: '.cursor/', pattern: /(?:^|\/)\.cursor(?:\/|$)/i, fixture: '.cursor/rules.md' },
  { ignore: '.gemini/', pattern: /(?:^|\/)\.gemini(?:\/|$)/i, fixture: '.gemini/settings.json' },
  { ignore: '.opencode/', pattern: /(?:^|\/)\.opencode(?:\/|$)/i, fixture: '.opencode/config.json' },
  { ignore: '.windsurf/', pattern: /(?:^|\/)\.windsurf(?:\/|$)/i, fixture: '.windsurf/rules.md' },
  { ignore: '.continue/', pattern: /(?:^|\/)\.continue(?:\/|$)/i, fixture: '.continue/config.json' },
  { ignore: '.roo/', pattern: /(?:^|\/)\.roo(?:\/|$)/i, fixture: '.roo/rules.md' },
  { ignore: '.github/instructions/', pattern: /(?:^|\/)\.github\/instructions(?:\/|$)/i, fixture: '.github/instructions/local.md' },
  { ignore: 'AGENTS.md', pattern: /(?:^|\/)AGENTS\.md$/i, fixture: 'AGENTS.md' },
  { ignore: 'CLAUDE.md', pattern: /(?:^|\/)CLAUDE\.md$/i, fixture: 'CLAUDE.md' },
  { ignore: 'CODEX.md', pattern: /(?:^|\/)CODEX\.md$/i, fixture: 'CODEX.md' },
  { ignore: 'GEMINI.md', pattern: /(?:^|\/)GEMINI\.md$/i, fixture: 'GEMINI.md' },
  { ignore: '.github/copilot-instructions.md', pattern: /(?:^|\/)\.github\/copilot-instructions\.md$/i, fixture: '.github/copilot-instructions.md' },
  { ignore: '.clinerules', pattern: /(?:^|\/)\.clinerules$/i, fixture: '.clinerules' },
  { ignore: '.windsurfrules', pattern: /(?:^|\/)\.windsurfrules$/i, fixture: '.windsurfrules' },
  { ignore: '.aider.conf.yml', pattern: /(?:^|\/)\.aider(?:\.conf)?\.ya?ml$/i, fixture: '.aider.conf.yml' },
]);

export const OPERATIONAL_PATH_PATTERNS = Object.freeze([
  ...PROHIBITED_PATH_CLASSES.map(({ pattern }) => pattern),
  /(?:^|\/)(?:continue|handoff)(?:[-_.][^/]*)?\.md$/i,
  /(?:^|\/)(?:prompt|transcript)[^/]*\.(?:md|txt|json|jsonl|prompt|transcript)$/i,
  /(?:^|\/)\.env(?:\.[^/]*)?$/i,
  /(?:^|\/)(?:\.publication-audit|publication-audit)(?:\/|$)/i,
]);
