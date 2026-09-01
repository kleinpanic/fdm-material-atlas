import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const LAYOUT = resolve(ROOT, "src/layouts/BaseLayout.astro");
const CONFIG = resolve(ROOT, "astro.config.mjs");

describe("base layout font discovery", () => {
  it("preloads exactly the two Latin local fonts used by the document", async () => {
    const [layout, config] = await Promise.all([
      readFile(LAYOUT, "utf8"),
      readFile(CONFIG, "utf8"),
    ]);

    expect(layout.match(/<Font\b/gu)).toHaveLength(2);
    expect(layout.match(/preload=\{true\}/gu)).toHaveLength(2);
    expect(config.match(/provider: fontProviders\.local\(\)/gu)).toHaveLength(2);
    expect(config).toContain("ibm-plex-sans-latin-wght-normal.woff2");
    expect(config).toContain("ibm-plex-mono-latin-400-normal.woff2");
    expect(config.match(/variants:\s*\[/gu)).toHaveLength(2);
  });
});
