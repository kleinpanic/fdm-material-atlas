import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const LAYOUT = resolve(ROOT, "src/layouts/BaseLayout.astro");

describe("base layout font discovery", () => {
  it("preloads exactly the two Latin local fonts used by the document", async () => {
    const source = await readFile(LAYOUT, "utf8");

    expect(source.match(/<Font\b/gu)).toHaveLength(2);
    expect(source.match(/preload=\{\[\{ subset: "latin" \}\]\}/gu)).toHaveLength(2);
  });
});
