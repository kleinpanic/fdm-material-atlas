import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
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
    expect(policy.routes.find((route: { label: string }) => route.label === "map")?.marker).toBe(
      ".map-lane-directory",
    );
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
    expect(config.ci.assert.aggregationMethod).toBe("median");
    expect(config.ci.upload.target).toBe("filesystem");
    expect(config.ci.upload.outputDir).toMatch(/^test-results\/performance/u);
    expect(JSON.stringify(config)).not.toContain("temporary-public-storage");
  });

  it("uses deterministic transfer budgets for PR CI and retains full Lighthouse release checks", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    expect(packageJson.scripts["test:performance:ci"]).toContain(
      "ATLAS_PERFORMANCE_SCOPE=transfer",
    );
    expect(packageJson.scripts["test:performance"]).not.toContain("ATLAS_PERFORMANCE_SCOPE");
    expect(packageJson.scripts["verify:exact-artifact"]).toContain("run-performance-budget.mjs");
  });
});

describe("bounded performance runner", () => {
  const metricSet = (performanceScore: number, upperBoundValue: number) => ({
    performanceScore,
    firstContentfulPaintMs: upperBoundValue,
    largestContentfulPaintMs: upperBoundValue,
    cumulativeLayoutShift: upperBoundValue / 1_000,
    totalBlockingTimeMs: upperBoundValue,
    totalBytes: upperBoundValue,
    javascriptBytes: upperBoundValue,
    cssBytes: upperBoundValue,
    fontBytes: upperBoundValue,
  });

  const budget = {
    runs: 3,
    performanceScore: 0.9,
    firstContentfulPaintMs: 2_000,
    largestContentfulPaintMs: 2_500,
    cumulativeLayoutShift: 0.1,
    totalBlockingTimeMs: 200,
    totalBytes: 800 * 1_024,
    javascriptBytes: 220 * 1_024,
    cssBytes: 100 * 1_024,
    fontBytes: 250 * 1_024,
  };

  it("computes the exact per-metric median for three recorded runs", async () => {
    const { medianMetrics } = await import("../../tools/run-performance-budget.mjs");
    expect(
      medianMetrics([metricSet(0.95, 150), metricSet(0.91, 100), metricSet(0.93, 125)]),
    ).toEqual(metricSet(0.93, 125));
  }, 30_000);

  it("tolerates one valid environmental outlier when the median passes", async () => {
    const { assertMedianMetrics } = await import("../../tools/run-performance-budget.mjs");
    expect(() =>
      assertMedianMetrics(
        [metricSet(0.95, 50), metricSet(0.1, 10_000), metricSet(0.94, 75)],
        budget,
      ),
    ).not.toThrow();
  }, 15_000);

  it("fails with the controlled budget code when the median fails", async () => {
    const { assertMedianMetrics } = await import("../../tools/run-performance-budget.mjs");
    expect(() =>
      assertMedianMetrics(
        [metricSet(0.95, 100), metricSet(0.9, 201), metricSet(0.91, 202)],
        budget,
      ),
    ).toThrowError(expect.objectContaining({ code: "PERFORMANCE_BUDGET_EXCEEDED" }));
  }, 15_000);

  it("confirms a failed median with two additional samples without discarding failures", async () => {
    const { confirmMedianMetrics } = await import("../../tools/run-performance-budget.mjs");
    const initial = [metricSet(0.7, 300), metricSet(0.7, 300), metricSet(0.95, 100)];
    let confirmations = 0;

    const result = await confirmMedianMetrics(initial, budget, async () => {
      confirmations += 1;
      return [metricSet(0.95, 100), metricSet(0.95, 100)];
    });

    expect(confirmations).toBe(1);
    expect(result.runs).toHaveLength(5);
    expect(result.runs.slice(0, 3)).toEqual(initial);
    expect(result.median).toEqual(metricSet(0.95, 100));
  }, 15_000);

  it("does not collect confirmation samples when the initial median passes", async () => {
    const { confirmMedianMetrics } = await import("../../tools/run-performance-budget.mjs");
    let confirmations = 0;

    const result = await confirmMedianMetrics(
      [metricSet(0.95, 100), metricSet(0.95, 100), metricSet(0.7, 300)],
      budget,
      async () => {
        confirmations += 1;
        return [];
      },
    );

    expect(confirmations).toBe(0);
    expect(result.runs).toHaveLength(3);
    expect(result.median).toEqual(metricSet(0.95, 100));
  }, 15_000);

  it("still fails when the five-sample median exceeds the budget", async () => {
    const { confirmMedianMetrics } = await import("../../tools/run-performance-budget.mjs");

    await expect(
      confirmMedianMetrics(
        [metricSet(0.7, 300), metricSet(0.7, 300), metricSet(0.95, 100)],
        budget,
        async () => [metricSet(0.7, 300), metricSet(0.95, 100)],
      ),
    ).rejects.toMatchObject({ code: "PERFORMANCE_BUDGET_EXCEEDED" });
  }, 15_000);

  it("excludes only an internally invalid cold capture from the three recorded runs", async () => {
    const { collectValidReports } = await import("../../tools/run-performance-budget.mjs");
    const captures = [
      { id: "cold-skew", timeToFirstByte: 15_001, serverResponseTime: 50 },
      { id: "recorded-1", timeToFirstByte: 15_001, serverResponseTime: 15_001 },
      { id: "recorded-2", timeToFirstByte: 600, serverResponseTime: 50 },
      { id: "recorded-3", timeToFirstByte: 650, serverResponseTime: 50 },
    ];
    let calls = 0;

    const reports = await collectValidReports({
      runs: 3,
      navigationTimeoutMs: 15_000,
      collect: async () => {
        const capture = captures[calls++];
        if (!capture) throw new Error("unexpected extra performance capture");
        return {
          id: capture.id,
          lhr: {
            audits: {
              metrics: { details: { items: [{ timeToFirstByte: capture.timeToFirstByte }] } },
              "server-response-time": { numericValue: capture.serverResponseTime },
            },
          },
        };
      },
    });

    expect(calls).toBe(4);
    expect(reports.map((report) => report.id)).toEqual(["recorded-1", "recorded-2", "recorded-3"]);
  }, 15_000);

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
              audits: {
                metrics: { details: { items: [{ timeToFirstByte: 15_001 }] } },
                "server-response-time": { numericValue: 50 },
              },
            },
          };
        },
      }),
    ).rejects.toMatchObject({ code: "PERFORMANCE_REPORT_INVALID" });
    expect(calls).toBe(2);
  }, 15_000);

  it("waits for quiet samples before capture without discarding a measured report", async () => {
    const { waitForMeasurementIsolation } = await import("../../tools/run-performance-budget.mjs");
    const observations = [0.9, 0.4, 0.75, 0.8];
    let calls = 0;

    await waitForMeasurementIsolation({
      observe: async () => observations[calls++] ?? 0,
      minimumIdleFraction: 0.7,
      consecutiveSamples: 2,
      maxSamples: observations.length,
    });

    expect(calls).toBe(4);
  }, 15_000);

  it("fails closed when the host never becomes quiet", async () => {
    const { waitForMeasurementIsolation } = await import("../../tools/run-performance-budget.mjs");
    let calls = 0;

    await expect(
      waitForMeasurementIsolation({
        observe: async () => {
          calls += 1;
          return 0.5;
        },
        minimumIdleFraction: 0.7,
        consecutiveSamples: 2,
        maxSamples: 3,
      }),
    ).rejects.toMatchObject({ code: "PERFORMANCE_HOST_BUSY" });
    expect(calls).toBe(3);
  }, 15_000);

  it("measures the compressed map projection carried by the deferred island payload", async () => {
    const { mapProjectionTransferBytes } = await import("../../tools/run-performance-budget.mjs");
    const projection = { lanes: [{ id: "outdoor" }], modeFragments: { outdoor: "/map/#outdoor" } };
    const compressed = gzipSync(Buffer.from(JSON.stringify(projection)), { level: 9 });
    const serialized = JSON.stringify({
      payload: [0, { gzipBase64: [0, compressed.toString("base64")] }],
    }).replaceAll('"', "&quot;");

    expect(mapProjectionTransferBytes(serialized)).toBe(compressed.byteLength);
    expect(() =>
      mapProjectionTransferBytes(
        JSON.stringify({ payload: [0, { gzipBase64: [0, "not base64"] }] }),
      ),
    ).toThrowError(expect.objectContaining({ code: "PERFORMANCE_REPORT_INVALID" }));
  }, 15_000);

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
