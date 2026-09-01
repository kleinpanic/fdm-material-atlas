import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("bounded performance runner", () => {
  it("excludes only an internally invalid cold capture from the three recorded runs", async () => {
    const { collectValidReports } = await import("../../tools/run-performance-budget.mjs");
    const captures = [
      { id: "cold-skew", timeToFirstByte: 15_001 },
      { id: "recorded-1", timeToFirstByte: 550 },
      { id: "recorded-2", timeToFirstByte: 600 },
      { id: "recorded-3", timeToFirstByte: 650 },
    ];
    let calls = 0;

    const reports = await collectValidReports({
      runs: 3,
      navigationTimeoutMs: 15_000,
      collect: async () => {
        const capture = captures[calls++];
        return {
          id: capture.id,
          lhr: {
            audits: { metrics: { details: { items: [{ timeToFirstByte: capture.timeToFirstByte }] } } },
          },
        };
      },
    });

    expect(calls).toBe(4);
    expect(reports.map((report) => report.id)).toEqual([
      "recorded-1",
      "recorded-2",
      "recorded-3",
    ]);
  });

  it("fails closed after two internally invalid captures", async () => {
    const { collectValidReports } = await import("../../tools/run-performance-budget.mjs");
    let calls = 0;

    await expect(
      collectValidReports({
        runs: 3,
        navigationTimeoutMs: 15_000,
        collect: async () => {
          calls += 1;
          return {
            lhr: {
              audits: { metrics: { details: { items: [{ timeToFirstByte: 15_001 }] } } },
            },
          };
        },
      }),
    ).rejects.toMatchObject({ code: "PERFORMANCE_REPORT_INVALID" });
    expect(calls).toBe(2);
  });

  it("rejects a missing production artifact with a stable code", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "atlas-performance-"));
    try {
      const { inspectArtifact } = await import("../../tools/run-performance-budget.mjs");
      await expect(
        inspectArtifact({ label: "root", base: "/", artifact: join(temporaryRoot, "missing") }),
      ).rejects.toMatchObject({ code: "PERFORMANCE_ARTIFACT_MISSING" });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it("keeps failures controlled and report storage local", async () => {
    const source = await readFile("tools/run-performance-budget.mjs", "utf8");
    expect(source).toContain("finally");
    expect(source).toContain("PERFORMANCE_NAVIGATION_TIMEOUT");
    expect(source).toContain("PERFORMANCE_CONTENT_MISSING");
    expect(source).toContain("PERFORMANCE_EXTERNAL_NAVIGATION");
    expect(source).toContain("PERFORMANCE_REPORT_INVALID");
    expect(source).toContain("PERFORMANCE_BUDGET_EXCEEDED");
    expect(source).not.toContain("temporary-public-storage");
  });
});
