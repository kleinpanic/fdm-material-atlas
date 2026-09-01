import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("performance release policy", () => {
  it("locks the representative surfaces and reviewed thresholds", async () => {
    const policy = JSON.parse(await readFile("performance-budgets.json", "utf8"));
    const config = require("../../lighthouserc.cjs");

    expect(policy.routes.map((route: { label: string }) => route.label)).toEqual([
      "selector",
      "material",
      "compare",
      "data",
      "map",
    ]);
    expect(policy.lighthouse).toEqual({
      runs: 3,
      performanceScore: 0.9,
      firstContentfulPaintMs: 2000,
      largestContentfulPaintMs: 2500,
      cumulativeLayoutShift: 0.1,
      totalBlockingTimeMs: 200,
      totalBytes: 800 * 1024,
      javascriptBytes: 220 * 1024,
      cssBytes: 100 * 1024,
      fontBytes: 250 * 1024,
    });
    expect(policy.gzip).toEqual({
      selectorBytes: 100 * 1024,
      atlasBytes: 100 * 1024,
      compareBytes: 140 * 1024,
      dataBytes: 180 * 1024,
      mapTotalBytes: 120 * 1024,
      mapPreVisibleBytes: 8 * 1024,
      mapDynamicChunkBytes: 30 * 1024,
    });
    expect(config.ci.collect.numberOfRuns).toBe(3);
    expect(config.ci.upload.target).toBe("filesystem");
    expect(config.ci.upload.outputDir).toMatch(/^test-results\/performance/u);
    expect(JSON.stringify(config)).not.toContain("temporary-public-storage");
  });
});
