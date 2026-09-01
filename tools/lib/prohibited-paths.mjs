/** Canonical public-history exclusions for AI and agent operating artifacts. */
export const PROHIBITED_PATH_CLASSES = Object.freeze([
  { ignore: ".planning/", pattern: /(?:^|\/)\.planning(?:\/|$)/i, fixture: ".planning/state.json" },
  { ignore: ".claude/", pattern: /(?:^|\/)\.claude(?:\/|$)/i, fixture: ".claude/settings.json" },
  { ignore: ".codex/", pattern: /(?:^|\/)\.codex(?:\/|$)/i, fixture: ".codex/config.json" },
  { ignore: ".agents/", pattern: /(?:^|\/)\.agents(?:\/|$)/i, fixture: ".agents/state.json" },
  { ignore: ".gsd/", pattern: /(?:^|\/)\.gsd(?:\/|$)/i, fixture: ".gsd/activity.jsonl" },
  { ignore: ".cursor/", pattern: /(?:^|\/)\.cursor(?:\/|$)/i, fixture: ".cursor/rules.md" },
  { ignore: ".gemini/", pattern: /(?:^|\/)\.gemini(?:\/|$)/i, fixture: ".gemini/settings.json" },
  {
    ignore: ".opencode/",
    pattern: /(?:^|\/)\.opencode(?:\/|$)/i,
    fixture: ".opencode/config.json",
  },
  { ignore: ".windsurf/", pattern: /(?:^|\/)\.windsurf(?:\/|$)/i, fixture: ".windsurf/rules.md" },
  {
    ignore: ".continue/",
    pattern: /(?:^|\/)\.continue(?:\/|$)/i,
    fixture: ".continue/config.json",
  },
  { ignore: ".roo/", pattern: /(?:^|\/)\.roo(?:\/|$)/i, fixture: ".roo/rules.md" },
  {
    ignore: ".github/instructions/",
    pattern: /(?:^|\/)\.github\/instructions(?:\/|$)/i,
    fixture: ".github/instructions/local.md",
  },
  {
    ignore: ".github/prompts/",
    pattern: /(?:^|\/)\.github\/prompts(?:\/|$)/i,
    fixture: ".github/prompts/review.prompt.md",
  },
  {
    ignore: ".github/agents/",
    pattern: /(?:^|\/)\.github\/agents(?:\/|$)/i,
    fixture: ".github/agents/reviewer.agent.md",
  },
  {
    ignore: ".github/chatmodes/",
    pattern: /(?:^|\/)\.github\/chatmodes(?:\/|$)/i,
    fixture: ".github/chatmodes/reviewer.chatmode.md",
  },
  {
    ignore: ".github/skills/",
    pattern: /(?:^|\/)\.github\/skills(?:\/|$)/i,
    fixture: ".github/skills/local/SKILL.md",
  },
  { ignore: "AGENTS.md", pattern: /(?:^|\/)AGENTS\.md$/i, fixture: "AGENTS.md" },
  { ignore: "CLAUDE.md", pattern: /(?:^|\/)CLAUDE\.md$/i, fixture: "CLAUDE.md" },
  { ignore: "CODEX.md", pattern: /(?:^|\/)CODEX\.md$/i, fixture: "CODEX.md" },
  { ignore: "GEMINI.md", pattern: /(?:^|\/)GEMINI\.md$/i, fixture: "GEMINI.md" },
  {
    ignore: ".github/copilot-instructions.md",
    pattern: /(?:^|\/)\.github\/copilot-instructions\.md$/i,
    fixture: ".github/copilot-instructions.md",
  },
  { ignore: ".clinerules", pattern: /(?:^|\/)\.clinerules$/i, fixture: ".clinerules" },
  { ignore: ".cursorrules", pattern: /(?:^|\/)\.cursorrules$/i, fixture: ".cursorrules" },
  { ignore: ".windsurfrules", pattern: /(?:^|\/)\.windsurfrules$/i, fixture: ".windsurfrules" },
  {
    ignore: ".aider.conf.yml",
    pattern: /(?:^|\/)\.aider(?:\.conf)?\.ya?ml$/i,
    fixture: ".aider.conf.yml",
  },
  {
    ignore: ".publication-sensitive-patterns",
    pattern: /(?:^|\/)\.publication-sensitive-patterns$/i,
    fixture: ".publication-sensitive-patterns",
  },
  {
    ignore: "*-handoff.md",
    pattern: /(?:^|\/)[^/]+(?:-|\.)handoff\.md$/i,
    fixture: "session-handoff.md",
  },
  { ignore: "*-PLAN.md", pattern: /(?:^|\/)\d+(?:-\d+)?-PLAN\.md$/i, fixture: "01-01-PLAN.md" },
  {
    ignore: "*-CONTEXT.md",
    pattern: /(?:^|\/)\d+(?:-\d+)?-CONTEXT\.md$/i,
    fixture: "01-CONTEXT.md",
  },
  {
    ignore: "*-SUMMARY.md",
    pattern: /(?:^|\/)\d+(?:-\d+)?-SUMMARY\.md$/i,
    fixture: "01-SUMMARY.md",
  },
  {
    ignore: "*-VERIFICATION.md",
    pattern: /(?:^|\/)\d+(?:-\d+)?-VERIFICATION\.md$/i,
    fixture: "01-VERIFICATION.md",
  },
  { ignore: "*-REVIEW.md", pattern: /(?:^|\/)\d+(?:-\d+)?-REVIEW\.md$/i, fixture: "01-REVIEW.md" },
  {
    ignore: "*-REVIEW-FIX.md",
    pattern: /(?:^|\/)\d+(?:-\d+)?-REVIEW-FIX\.md$/i,
    fixture: "01-REVIEW-FIX.md",
  },
  {
    ignore: "*-RESEARCH.md",
    pattern: /(?:^|\/)\d+(?:-\d+)?-RESEARCH\.md$/i,
    fixture: "01-RESEARCH.md",
  },
  {
    ignore: "*-VALIDATION.md",
    pattern: /(?:^|\/)\d+(?:-\d+)?-VALIDATION\.md$/i,
    fixture: "01-VALIDATION.md",
  },
  {
    ignore: "*-SECURITY.md",
    pattern: /(?:^|\/)\d+(?:-\d+)?-SECURITY\.md$/i,
    fixture: "01-SECURITY.md",
  },
  {
    ignore: "*-UI-SPEC.md",
    pattern: /(?:^|\/)\d+(?:-\d+)?-UI-SPEC\.md$/i,
    fixture: "01-UI-SPEC.md",
  },
  { ignore: "*-SPEC.md", pattern: /(?:^|\/)\d+(?:-\d+)?-SPEC\.md$/i, fixture: "01-SPEC.md" },
  {
    ignore: "conversation-export*.json",
    pattern: /(?:^|\/)conversation[-_.]?export[^/]*\.(?:json|jsonl|md|txt)$/i,
    fixture: "conversation-export.json",
  },
]);

export const OPERATIONAL_PATH_PATTERNS = Object.freeze([
  ...PROHIBITED_PATH_CLASSES.map(({ pattern }) => pattern),
  /(?:^|\/)(?:continue|handoff)(?:[-_.][^/]*)?\.md$/i,
  /(?:^|\/)(?:prompt|transcript)[^/]*\.(?:md|txt|json|jsonl|prompt|transcript)$/i,
  /(?:^|\/)\.env(?:\.[^/]*)?$/i,
  /(?:^|\/)(?:\.publication-audit|publication-audit)(?:\/|$)/i,
]);

/** Narrow public placeholders that remain subject to content scanning. */
export const OPERATIONAL_PATH_EXCEPTIONS = Object.freeze([/(?:^|\/)\.env\.example$/i]);
