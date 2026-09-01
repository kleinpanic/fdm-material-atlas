import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const SOURCE_ROOT = join(PROJECT_ROOT, "src");
const GLOBAL_CSS_PATH = join(SOURCE_ROOT, "styles/global.css");
const THEME_START = "/* atlas-theme:start */";
const THEME_END = "/* atlas-theme:end */";

type TokenIssue = Readonly<{
  code: "THEME_REGION_INVALID" | "TOKEN_MISSING" | "TOKEN_UNEXPECTED" | "TOKEN_VALUE_INVALID";
  token: string;
}>;

/*
 * Test-only exact-value oracle. It duplicates the approved UI contract so a
 * change to the runtime token source must be an explicit, reviewed change.
 * Application code must not import test files.
 */
const TEST_ONLY_EXACT_TOKEN_ORACLE = {
  "--font-sans": "var(--font-plex-sans), system-ui, sans-serif",
  "--font-mono": "var(--font-plex-mono), ui-monospace, SFMono-Regular, Consolas, monospace",
  "--text-label": "0.875rem",
  "--text-label--line-height": "1.35",
  "--text-body": "1rem",
  "--text-body--line-height": "1.55",
  "--text-heading": "1.5rem",
  "--text-heading--line-height": "1.25",
  "--text-display": "2rem",
  "--text-display--line-height": "1.15",
  "--font-weight-regular": "400",
  "--font-weight-semibold": "600",
  "--font-variant-numeric-tabular": "tabular-nums",
  "--spacing-1": "0.25rem",
  "--spacing-2": "0.5rem",
  "--spacing-4": "1rem",
  "--spacing-6": "1.5rem",
  "--spacing-8": "2rem",
  "--spacing-12": "3rem",
  "--spacing-16": "4rem",
  "--width-page": "90rem",
  "--width-reading": "45rem",
  "--width-data-column": "10rem",
  "--width-definition-rail-min": "17.5rem",
  "--width-definition-rail-max": "20rem",
  "--spacing-gutter-compact": "1rem",
  "--spacing-gutter-medium": "1.5rem",
  "--spacing-gutter-wide": "2rem",
  "--breakpoint-compact": "40rem",
  "--breakpoint-medium": "40rem",
  "--breakpoint-wide": "64rem",
  "--breakpoint-atlas-wide": "80rem",
  "--color-page": "#f3f4ef",
  "--color-surface": "#ffffff",
  "--color-ink-strong": "#17201e",
  "--color-ink": "#34413e",
  "--color-ink-muted": "#5d6966",
  "--color-rule": "#c7ceca",
  "--color-surface-subtle": "#e8ece8",
  "--color-accent": "#006b66",
  "--color-destructive": "#b42318",
  "--color-focus": "#006b66",
  "--color-hover": "#e2f1ef",
  "--color-disabled-ink": "#53605c",
  "--color-disabled-surface": "#e8ece8",
  "--color-caution-information": "#175cd3",
  "--color-caution-verify": "#906000",
  "--color-caution-incompatible": "#b42318",
  "--color-caution-unknown": "#5d6966",
  "--color-caution-not-applicable": "#5d6966",
  "--color-family-neutral": "#5d6966",
  "--color-thermal-service": "#006b66",
  "--color-thermal-tg": "#7048a8",
  "--color-thermal-hdt": "#b54708",
  "--color-thermal-vicat": "#9a6700",
  "--color-thermal-melting": "#c2410c",
  "--color-thermal-other": "#475467",
  "--color-gate-available": "#067647",
  "--color-gate-verify": "#9a6700",
  "--color-gate-blocked": "#b42318",
  "--color-gate-unknown": "#5d6966",
  "--color-gate-not-applicable": "#5d6966",
  "--color-diagram-axis": "var(--color-ink)",
  "--color-diagram-grid": "var(--color-rule)",
  "--color-diagram-active": "var(--color-accent)",
  "--color-diagram-unavailable": "var(--color-disabled-ink)",
  "--duration-state": "120ms",
  "--ease-state": "ease-out",
  "--size-target-min": "44px",
  "--size-focus-ring": "3px",
  "--size-focus-offset": "2px",
  "--size-rule": "1px",
  "--size-rule-strong": "2px",
  "--tracking-eyebrow": "0.06em",
} as const;

function themeBody(source: string): string | undefined {
  const start = source.indexOf(THEME_START);
  const end = source.indexOf(THEME_END);

  if (
    start < 0 ||
    end < 0 ||
    end <= start ||
    source.indexOf(THEME_START, start + THEME_START.length) >= 0 ||
    source.indexOf(THEME_END, end + THEME_END.length) >= 0
  ) {
    return undefined;
  }

  const region = source.slice(start + THEME_START.length, end);
  const block = /@theme\s*\{(?<body>[\s\S]*)\}\s*$/u.exec(region.trim());
  return block?.groups?.body;
}

function parseTheme(source: string): ReadonlyMap<string, string> | undefined {
  const body = themeBody(source);
  if (body === undefined) return undefined;

  const tokens = new Map<string, string>();
  const declarationPattern = /(?<name>--[a-z0-9-]+)\s*:\s*(?<value>[^;]+);/gu;

  for (const match of body.matchAll(declarationPattern)) {
    const name = match.groups?.name;
    const value = match.groups?.value?.trim();
    if (name !== undefined && value !== undefined) tokens.set(name, value);
  }

  return tokens;
}

function inspectTheme(
  source: string,
  oracle: Readonly<Record<string, string>> = TEST_ONLY_EXACT_TOKEN_ORACLE,
): readonly TokenIssue[] {
  const actual = parseTheme(source);
  if (actual === undefined) return [{ code: "THEME_REGION_INVALID", token: "@theme" }];

  const issues: TokenIssue[] = [];
  for (const [token, value] of Object.entries(oracle)) {
    if (!actual.has(token)) issues.push({ code: "TOKEN_MISSING", token });
    else if (actual.get(token) !== value) issues.push({ code: "TOKEN_VALUE_INVALID", token });
  }
  for (const token of actual.keys()) {
    if (!(token in oracle)) issues.push({ code: "TOKEN_UNEXPECTED", token });
  }

  return issues.sort((left, right) =>
    `${left.code}:${left.token}`.localeCompare(`${right.code}:${right.token}`),
  );
}

function syntheticThemeWithout(omittedToken: string): string {
  const declarations = Object.entries(TEST_ONLY_EXACT_TOKEN_ORACLE)
    .filter(([token]) => token !== omittedToken)
    .map(([token, value]) => `  ${token}: ${value};`)
    .join("\n");
  return `${THEME_START}\n@theme {\n${declarations}\n}\n${THEME_END}`;
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/gu)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (channels === undefined || channels.length !== 3) throw new Error(`INVALID_HEX_COLOR:${hex}`);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.isFile()) files.push(path);
  }

  return files;
}

function applicationCss(source: string, path: string): string {
  if (path !== GLOBAL_CSS_PATH) return source;
  const start = source.indexOf(THEME_START);
  const end = source.indexOf(THEME_END);
  if (start < 0 || end < 0) return source;
  return `${source.slice(0, start)}${source.slice(end + THEME_END.length)}`;
}

describe("engineering atlas design tokens", () => {
  it("reports TOKEN_MISSING for one controlled omission", () => {
    const omittedToken = "--color-thermal-hdt";

    expect(inspectTheme(syntheticThemeWithout(omittedToken))).toEqual([
      { code: "TOKEN_MISSING", token: omittedToken },
    ]);
  });

  it("matches the complete approved semantic token oracle", async () => {
    const source = await readFile(GLOBAL_CSS_PATH, "utf8");
    expect(inspectTheme(source)).toEqual([]);
  });

  it("keeps every real text and state pairing at its WCAG contrast threshold", () => {
    const token = (name: keyof typeof TEST_ONLY_EXACT_TOKEN_ORACLE): string =>
      TEST_ONLY_EXACT_TOKEN_ORACLE[name];
    const normalTextPairs = [
      ["--color-ink", "--color-page", "body text"],
      ["--color-ink", "--color-surface", "surface body text"],
      ["--color-ink-muted", "--color-page", "muted page text"],
      ["--color-ink-muted", "--color-surface", "muted surface text"],
      ["--color-accent", "--color-page", "page link"],
      ["--color-accent", "--color-surface", "surface link"],
      ["--color-surface", "--color-accent", "filled primary action"],
      ["--color-disabled-ink", "--color-disabled-surface", "disabled control"],
      ["--color-caution-information", "--color-surface", "information state"],
      ["--color-caution-verify", "--color-page", "verification state on page"],
      ["--color-caution-verify", "--color-surface", "verification state"],
      ["--color-caution-incompatible", "--color-surface", "incompatible state"],
      ["--color-gate-available", "--color-surface", "available state"],
    ] as const;

    for (const [foreground, background, label] of normalTextPairs) {
      expect(
        contrastRatio(token(foreground), token(background)),
        `${label} must meet WCAG AA normal-text contrast`,
      ).toBeGreaterThanOrEqual(4.5);
    }

    for (const background of ["--color-page", "--color-surface", "--color-hover"] as const) {
      expect(
        contrastRatio(token("--color-focus"), token(background)),
        `focus ring against ${background} must meet non-text contrast`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps colors and visual policy in the canonical CSS source", async () => {
    const findings: string[] = [];
    const styleExtensions = new Set([".astro", ".css", ".html", ".jsx", ".svelte", ".tsx", ".vue"]);
    const literalColor = /#[\da-f]{3,8}\b|\b(?:color|hsl|hsla|lab|lch|oklch|rgb|rgba)\s*\(/iu;
    const prohibitedStyle =
      /(?:repeating-)?(?:conic|linear|radial)-gradient\s*\(|backdrop-(?:filter|blur)|backdrop-filter\s*:|@keyframes\b|\banimation(?:-name)?\s*:|\bglassmorphism\b|\bdashboard-card(?:-grid)?\b/iu;
    const arbitraryColorClass =
      /(?:bg|border|fill|outline|ring|stroke|text)-\[(?:#|rgb|hsl|oklch|lab|lch|color\()/iu;
    const tinyTextClass = /\btext-(?:xs|\[(?:0(?:\.\d+)?rem|(?:[1-9]|1[0-3])px))/iu;

    for (const path of await sourceFiles(SOURCE_ROOT)) {
      const relativePath = relative(PROJECT_ROOT, path);
      const source = await readFile(path, "utf8");
      const cssSource = applicationCss(source, path);

      if (literalColor.test(cssSource)) findings.push(`COLOR_LITERAL:${relativePath}`);
      if (styleExtensions.has(extname(path)) && prohibitedStyle.test(source)) {
        findings.push(`VISUAL_PATTERN:${relativePath}`);
      }
      if (styleExtensions.has(extname(path)) && arbitraryColorClass.test(source)) {
        findings.push(`COLOR_CLASS:${relativePath}`);
      }
      if (styleExtensions.has(extname(path)) && tinyTextClass.test(source)) {
        findings.push(`TINY_TEXT_ROLE:${relativePath}`);
      }
    }

    expect(findings.sort()).toEqual([]);
  });

  it("provides static focus, state, reflow, overflow, and motion contracts", async () => {
    const source = await readFile(GLOBAL_CSS_PATH, "utf8");
    const requiredRules = [
      '@import "tailwindcss"',
      ":focus-visible",
      "color-scheme: light",
      ".skip-link:focus-visible",
      "[data-state]",
      "[data-gate-state]",
      ".family-fill-marker",
      ".data-overflow[aria-label]",
      "@media (min-width: 40rem)",
      "@media (min-width: 64rem)",
      "@media (min-width: 80rem)",
      "@media (prefers-reduced-motion: reduce)",
      "@media (forced-colors: active)",
    ] as const;

    const missingRules = requiredRules
      .filter((rule) => !source.includes(rule))
      .map((rule) => `RULE_MISSING:${rule}`);
    expect(missingRules).toEqual([]);
  });
});
