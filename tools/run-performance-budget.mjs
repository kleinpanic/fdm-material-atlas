#!/usr/bin/env node

import { launch as launchChrome } from "chrome-launcher";
import { gunzipSync, gzipSync } from "node:zlib";
import { lstat, mkdir, opendir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import lighthouse from "lighthouse";
import { chromium } from "playwright";

import { createPreviewServer } from "./verify-build-modes.mjs";
import { verifyPhase6Build } from "./verify-phase6-build.mjs";
import { verifyPhase7Build } from "./verify-phase7-build.mjs";
import { verifySelectorBuild } from "./verify-selector-build.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = resolve(PROJECT_ROOT, "performance-budgets.json");
const CONTROLLED_CODES = new Set([
  "PERFORMANCE_ARGUMENTS_INVALID",
  "PERFORMANCE_ARTIFACT_MISSING",
  "PERFORMANCE_ARTIFACT_INVALID",
  "PERFORMANCE_ROUTE_MISSING",
  "PERFORMANCE_SERVER_FAILED",
  "PERFORMANCE_NAVIGATION_TIMEOUT",
  "PERFORMANCE_CONTENT_MISSING",
  "PERFORMANCE_EXTERNAL_NAVIGATION",
  "PERFORMANCE_REPORT_INVALID",
  "PERFORMANCE_BUDGET_EXCEEDED",
  "PERFORMANCE_COLLECTION_FAILED",
  "PERFORMANCE_HOST_BUSY",
]);

export class PerformanceBudgetError extends Error {
  constructor(code) {
    super(code);
    this.name = "PerformanceBudgetError";
    this.code = code;
  }
}

function fail(code) {
  throw new PerformanceBudgetError(code);
}

function exactMode(mode) {
  if (
    !mode ||
    !["root", "repository", "pages"].includes(mode.label) ||
    !/^\/(?:[a-z0-9-]+\/)*$/u.test(mode.base) ||
    typeof mode.artifact !== "string"
  )
    fail("PERFORMANCE_ARGUMENTS_INVALID");
  return { name: mode.label, base: mode.base, output: resolve(PROJECT_ROOT, mode.artifact) };
}

async function filesUnder(root, limits) {
  const records = new Map();
  const pending = [root];
  let totalBytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    const stream = await opendir(directory).catch(() => fail("PERFORMANCE_ARTIFACT_INVALID"));
    for await (const entry of stream) {
      const path = join(directory, entry.name);
      const stat = await lstat(path).catch(() => fail("PERFORMANCE_ARTIFACT_INVALID"));
      if (stat.isSymbolicLink()) fail("PERFORMANCE_ARTIFACT_INVALID");
      if (stat.isDirectory()) pending.push(path);
      else if (stat.isFile()) {
        const name = relative(root, path).split(sep).join("/");
        records.set(name, { path, size: stat.size });
        totalBytes += stat.size;
        if (records.size > limits.maxArtifactFiles || totalBytes > limits.maxArtifactBytes)
          fail("PERFORMANCE_ARTIFACT_INVALID");
      } else fail("PERFORMANCE_ARTIFACT_INVALID");
    }
  }
  return records;
}

export async function inspectArtifact(modeInput, limitsInput) {
  const policy = JSON.parse(await readFile(POLICY_PATH, "utf8"));
  const limits = limitsInput ?? policy.limits;
  const mode = exactMode(modeInput);
  const stat = await lstat(mode.output).catch(() => fail("PERFORMANCE_ARTIFACT_MISSING"));
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("PERFORMANCE_ARTIFACT_INVALID");
  const canonical = await realpath(mode.output).catch(() => fail("PERFORMANCE_ARTIFACT_INVALID"));
  if (canonical !== mode.output) fail("PERFORMANCE_ARTIFACT_INVALID");
  const files = await filesUnder(canonical, limits);
  if (!files.has("index.html")) fail("PERFORMANCE_ROUTE_MISSING");
  return Object.freeze({ ...mode, files });
}

function routeFile(pathname) {
  const logical = pathname.replace(/^\//u, "");
  return logical === "" || logical.endsWith("/") ? `${logical}index.html` : logical;
}

async function discoverRoutes(mode, policy) {
  const routes = [];
  for (const descriptor of policy.routes) {
    let pathname = descriptor.path;
    if (descriptor.discoverFrom) {
      const source = mode.files.get(routeFile(descriptor.discoverFrom));
      if (!source) fail("PERFORMANCE_ROUTE_MISSING");
      const html = await readFile(source.path, "utf8");
      const candidates = [...html.matchAll(/\bhref=(?:"([^"]+)"|'([^']+)')/giu)]
        .map((match) => match[1] ?? match[2])
        .map((href) => new URL(href, "http://local.invalid" + mode.base).pathname)
        .map((path) => (mode.base === "/" ? path : path.replace(mode.base.slice(0, -1), "")))
        .filter((path) => new RegExp(descriptor.pathPattern, "u").test(path))
        .sort();
      pathname = candidates[0];
    }
    if (typeof pathname !== "string" || !mode.files.has(routeFile(pathname)))
      fail("PERFORMANCE_ROUTE_MISSING");
    routes.push(Object.freeze({ label: descriptor.label, pathname, marker: descriptor.marker }));
  }
  return Object.freeze(routes);
}

function publicPath(mode, pathname) {
  return mode.base === "/" ? pathname : `${mode.base.slice(0, -1)}${pathname}`;
}

async function listen(server) {
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  }).catch(() => fail("PERFORMANCE_SERVER_FAILED"));
  const address = server.address();
  if (!address || typeof address === "string") fail("PERFORMANCE_SERVER_FAILED");
  return `http://127.0.0.1:${address.port}`;
}

async function proveContent(origin, mode, routes, policy) {
  const browser = await chromium
    .launch({
      executablePath: process.env.CHROME_PATH || chromium.executablePath(),
      headless: true,
    })
    .catch(() => fail("PERFORMANCE_COLLECTION_FAILED"));
  try {
    const page = await browser.newPage();
    for (const route of routes) {
      const expected = new URL(publicPath(mode, route.pathname), origin);
      await page
        .goto(expected.href, {
          waitUntil: "networkidle",
          timeout: policy.limits.navigationTimeoutMs,
        })
        .catch((error) => {
          if (String(error).includes("Timeout")) fail("PERFORMANCE_NAVIGATION_TIMEOUT");
          fail("PERFORMANCE_ROUTE_MISSING");
        });
      const final = new URL(page.url());
      if (final.origin !== expected.origin || final.pathname !== expected.pathname)
        fail("PERFORMANCE_EXTERNAL_NAVIGATION");
      await page
        .locator(route.marker)
        .first()
        .waitFor({ state: "visible", timeout: policy.limits.navigationTimeoutMs })
        .catch(() => fail("PERFORMANCE_CONTENT_MISSING"));
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function importedSpecifiers(source) {
  return [
    ...source.matchAll(/\b(?:import|export)\s+(?:[^"']*?\s+from\s*)?["']([^"']+)["']/gu),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu),
  ].map((match) => match[1]);
}

function reviveAstro(value) {
  const handlers = {
    0: (item) => reviveObject(item),
    1: (item) => item.map(reviveTuple),
    2: (item) => new RegExp(item),
    3: (item) => new Date(item),
    4: (item) => new Map(item.map(reviveTuple)),
    5: (item) => new Set(item.map(reviveTuple)),
    6: (item) => BigInt(item),
    7: (item) => new URL(item),
    8: (item) => new Uint8Array(item),
    9: (item) => new Uint16Array(item),
    10: (item) => new Uint32Array(item),
    11: (item) => Number.POSITIVE_INFINITY * item,
  };
  function reviveTuple(tuple) {
    if (!Array.isArray(tuple) || tuple.length !== 2 || !(tuple[0] in handlers)) return tuple;
    return handlers[tuple[0]](tuple[1]);
  }
  function reviveObject(item) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item).map(([key, entry]) => [key, reviveTuple(entry)]),
    );
  }
  return reviveObject(value);
}

const MAX_MAP_PROJECTION_JSON_BYTES = 1024 * 1024;

export function mapProjectionTransferBytes(serializedProps) {
  const decodedProps = serializedProps
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&amp;", "&");
  try {
    const parsed = reviveAstro(JSON.parse(decodedProps));
    const encoded = parsed?.payload?.gzipBase64;
    if (
      typeof encoded !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)
    )
      fail("PERFORMANCE_REPORT_INVALID");
    const compressed = Buffer.from(encoded, "base64");
    const projection = JSON.parse(
      gunzipSync(compressed, { maxOutputLength: MAX_MAP_PROJECTION_JSON_BYTES }).toString("utf8"),
    );
    if (typeof projection !== "object" || projection === null || Array.isArray(projection))
      fail("PERFORMANCE_REPORT_INVALID");
    return compressed.byteLength;
  } catch (error) {
    if (error instanceof PerformanceBudgetError) throw error;
    fail("PERFORMANCE_REPORT_INVALID");
  }
}

export async function mapTransfer(mode, policy) {
  const html = await readFile(mode.files.get("map/index.html")?.path ?? "", "utf8").catch(() =>
    fail("PERFORMANCE_ROUTE_MISSING"),
  );
  const opening = html.match(
    /<astro-island\b[^>]*component-export="MapExplorerIsland"[^>]*>/iu,
  )?.[0];
  if (!opening) fail("PERFORMANCE_CONTENT_MISSING");
  const attribute = (name) =>
    opening
      .match(new RegExp(`\\b${name}=(?:"([^"]+)"|'([^']+)')`, "iu"))
      ?.slice(1)
      .find(Boolean);
  const props = attribute("props");
  const componentUrl = attribute("component-url");
  const rendererUrl = attribute("renderer-url");
  if (!props || !componentUrl || !rendererUrl) fail("PERFORMANCE_CONTENT_MISSING");
  const toName = (url) => {
    const pathname = new URL(url, "http://local.invalid" + mode.base).pathname;
    return decodeURIComponent(
      mode.base === "/" ? pathname.slice(1) : pathname.slice(mode.base.length),
    );
  };
  const pending = [toName(componentUrl), toName(rendererUrl)];
  const visited = new Set();
  let javascriptGzipBytes = 0;
  let largestModuleGzipBytes = 0;
  while (pending.length > 0) {
    const name = pending.pop();
    if (visited.has(name)) continue;
    const record = mode.files.get(name);
    if (!record || !/\.m?js$/u.test(name)) fail("PERFORMANCE_REPORT_INVALID");
    visited.add(name);
    const bytes = await readFile(record.path);
    const compressed = gzipSync(bytes, { level: 9, mtime: 0 }).byteLength;
    javascriptGzipBytes += compressed;
    largestModuleGzipBytes = Math.max(largestModuleGzipBytes, compressed);
    for (const specifier of importedSpecifiers(bytes.toString("utf8"))) {
      if (!specifier.startsWith(".")) continue;
      pending.push(posix.normalize(posix.join(posix.dirname(name), specifier)));
    }
  }
  const projectionBytes = mapProjectionTransferBytes(props);
  const totalGzipBytes =
    javascriptGzipBytes + gzipSync(Buffer.from(props), { level: 9, mtime: 0 }).byteLength;
  if (
    totalGzipBytes > policy.gzip.mapTotalBytes ||
    projectionBytes > policy.gzip.mapPreVisibleBytes ||
    largestModuleGzipBytes > policy.gzip.mapDynamicChunkBytes
  )
    fail("PERFORMANCE_BUDGET_EXCEEDED");
  return { totalGzipBytes, projectionBytes, largestModuleGzipBytes };
}

async function routeTransfer(mode, routeName) {
  const htmlRecord = mode.files.get(`${routeName}/index.html`);
  if (!htmlRecord) fail("PERFORMANCE_ROUTE_MISSING");
  const html = await readFile(htmlRecord.path, "utf8");
  const pending = [...html.matchAll(/(?:src|component-url|renderer-url)="([^"]+\.m?js)"/gu)].map(
    (match) => match[1],
  );
  const visited = new Set();
  let bytes = gzipSync(Buffer.from(html), { level: 9, mtime: 0 }).byteLength;
  while (pending.length > 0) {
    const raw = pending.pop();
    const pathname = new URL(raw, `https://local.invalid${mode.base}`).pathname;
    const name = decodeURIComponent(
      mode.base === "/" ? pathname.slice(1) : pathname.slice(mode.base.length),
    );
    if (visited.has(name)) continue;
    const record = mode.files.get(name);
    if (!record || !/\.m?js$/u.test(name)) fail("PERFORMANCE_REPORT_INVALID");
    visited.add(name);
    const source = await readFile(record.path);
    bytes += gzipSync(source, { level: 9, mtime: 0 }).byteLength;
    for (const specifier of importedSpecifiers(source.toString("utf8"))) {
      if (specifier.startsWith("."))
        pending.push(posix.normalize(posix.join(posix.dirname(name), specifier)));
    }
  }
  return bytes;
}

export async function exactTransfer(policy, modes) {
  const phase6 = await verifyPhase6Build({
    modes: modes.map((mode) => ({ name: mode.name, base: mode.base, output: mode.output })),
    runPublication: false,
  }).catch(() => fail("PERFORMANCE_BUDGET_EXCEEDED"));
  const phase7 =
    modes.length > 1
      ? await verifyPhase7Build({
          rootOutput: modes[0].output,
          repositoryOutput: modes[1].output,
          runPublicationScan: false,
        }).catch(() => fail("PERFORMANCE_BUDGET_EXCEEDED"))
      : undefined;
  const reports = [];
  for (const mode of modes) {
    const selector = await verifySelectorBuild({
      outputRoot: mode.output,
      base: mode.base,
      maxGzipBytes: policy.gzip.selectorBytes,
    }).catch(() => fail("PERFORMANCE_BUDGET_EXCEEDED"));
    const atlas = phase6.modes.find((item) => item.mode === mode.name);
    const comparison = phase7?.modes.find((item) => item.mode === mode.name);
    const compareGzipBytes = comparison?.compareGzipBytes ?? (await routeTransfer(mode, "compare"));
    const dataGzipBytes = comparison?.dataGzipBytes ?? (await routeTransfer(mode, "data"));
    if (!atlas) fail("PERFORMANCE_REPORT_INVALID");
    if (
      atlas.atlasGzipBytes > policy.gzip.atlasBytes ||
      compareGzipBytes > policy.gzip.compareBytes ||
      dataGzipBytes > policy.gzip.dataBytes
    )
      fail("PERFORMANCE_BUDGET_EXCEEDED");
    reports.push({
      mode: mode.name,
      selector: selector.totalGzipBytes,
      atlas: atlas.atlasGzipBytes,
      compare: compareGzipBytes,
      data: dataGzipBytes,
      map: await mapTransfer(mode, policy),
    });
  }
  return reports;
}

function numericAudit(lhr, id) {
  const value = lhr?.audits?.[id]?.numericValue;
  if (typeof value !== "number" || !Number.isFinite(value)) fail("PERFORMANCE_REPORT_INVALID");
  return value;
}

function resourceSize(lhr, type) {
  const items = lhr?.audits?.["resource-summary"]?.details?.items;
  const item = Array.isArray(items) && items.find((entry) => entry.resourceType === type);
  const value = item?.transferSize ?? item?.size;
  if (typeof value !== "number" || !Number.isFinite(value)) fail("PERFORMANCE_REPORT_INVALID");
  return value;
}

function measuredMetrics(lhr) {
  const performanceScore = lhr?.categories?.performance?.score;
  if (typeof performanceScore !== "number" || !Number.isFinite(performanceScore))
    fail("PERFORMANCE_REPORT_INVALID");
  return {
    performanceScore,
    firstContentfulPaintMs: numericAudit(lhr, "first-contentful-paint"),
    largestContentfulPaintMs: numericAudit(lhr, "largest-contentful-paint"),
    cumulativeLayoutShift: numericAudit(lhr, "cumulative-layout-shift"),
    totalBlockingTimeMs: numericAudit(lhr, "total-blocking-time"),
    totalBytes: resourceSize(lhr, "total"),
    javascriptBytes: resourceSize(lhr, "script"),
    cssBytes: resourceSize(lhr, "stylesheet"),
    fontBytes: resourceSize(lhr, "font"),
  };
}

function assertMetrics(metrics, budget) {
  if (
    metrics.performanceScore < budget.performanceScore ||
    metrics.firstContentfulPaintMs > budget.firstContentfulPaintMs ||
    metrics.largestContentfulPaintMs > budget.largestContentfulPaintMs ||
    metrics.cumulativeLayoutShift > budget.cumulativeLayoutShift ||
    metrics.totalBlockingTimeMs > budget.totalBlockingTimeMs ||
    metrics.totalBytes > budget.totalBytes ||
    metrics.javascriptBytes > budget.javascriptBytes ||
    metrics.cssBytes > budget.cssBytes ||
    metrics.fontBytes > budget.fontBytes
  )
    fail("PERFORMANCE_BUDGET_EXCEEDED");
}

const METRIC_NAMES = Object.freeze([
  "performanceScore",
  "firstContentfulPaintMs",
  "largestContentfulPaintMs",
  "cumulativeLayoutShift",
  "totalBlockingTimeMs",
  "totalBytes",
  "javascriptBytes",
  "cssBytes",
  "fontBytes",
]);

export function medianMetrics(runs) {
  if (!Array.isArray(runs) || runs.length < 1 || runs.length % 2 === 0)
    fail("PERFORMANCE_REPORT_INVALID");
  return Object.freeze(
    Object.fromEntries(
      METRIC_NAMES.map((name) => {
        const values = runs.map((metrics) => metrics?.[name]);
        if (values.some((value) => typeof value !== "number" || !Number.isFinite(value)))
          fail("PERFORMANCE_REPORT_INVALID");
        values.sort((left, right) => left - right);
        return [name, values[Math.floor(values.length / 2)]];
      }),
    ),
  );
}

export function assertMedianMetrics(runs, budget) {
  const median = medianMetrics(runs);
  assertMetrics(median, budget);
  return median;
}

/**
 * Confirm a failed three-run median with two more samples. All original
 * measurements remain in the final five-run median; no result is discarded.
 */
export async function confirmMedianMetrics(initialRuns, budget, collectAdditional) {
  if (
    !Array.isArray(initialRuns) ||
    initialRuns.length !== 3 ||
    typeof collectAdditional !== "function"
  )
    fail("PERFORMANCE_ARGUMENTS_INVALID");
  try {
    return Object.freeze({
      runs: Object.freeze([...initialRuns]),
      median: assertMedianMetrics(initialRuns, budget),
    });
  } catch (error) {
    if (error?.code !== "PERFORMANCE_BUDGET_EXCEEDED" || typeof collectAdditional !== "function")
      throw error;
  }

  const additionalRuns = await collectAdditional();
  if (!Array.isArray(additionalRuns) || additionalRuns.length !== 2)
    fail("PERFORMANCE_REPORT_INVALID");
  const runs = Object.freeze([...initialRuns, ...additionalRuns]);
  return Object.freeze({ runs, median: assertMedianMetrics(runs, budget) });
}

async function writeLighthouseReports(results, reportsDirectory, mode, route, startIndex = 0) {
  const directory = resolve(PROJECT_ROOT, reportsDirectory, mode.name);
  await mkdir(directory, { recursive: true });
  for (const [index, result] of results.entries()) {
    await writeFile(
      join(directory, `${route.label}-${startIndex + index + 1}.json`),
      JSON.stringify(result.lhr),
    );
  }
}

async function withCollectionTimeout(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new PerformanceBudgetError("PERFORMANCE_NAVIGATION_TIMEOUT")),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const MAX_CAPTURE_ATTEMPTS = 2;
const QUIET_SAMPLE_MS = 500;
const QUIET_IDLE_FRACTION = 0.8;
const QUIET_CONSECUTIVE_SAMPLES = 3;
const QUIET_MAX_SAMPLES = 40;

function cpuCounters(source) {
  const fields = source
    .split("\n")
    .find((line) => /^cpu\s/u.test(line))
    ?.trim()
    .split(/\s+/u)
    .slice(1)
    .map(Number);
  if (!fields || fields.length < 5 || fields.some((value) => !Number.isFinite(value)))
    fail("PERFORMANCE_COLLECTION_FAILED");
  return {
    total: fields.reduce((sum, value) => sum + value, 0),
    idle: (fields[3] ?? 0) + (fields[4] ?? 0),
  };
}

async function observeCpuIdleFraction() {
  const before = cpuCounters(
    await readFile("/proc/stat", "utf8").catch(() => fail("PERFORMANCE_COLLECTION_FAILED")),
  );
  await new Promise((accept) => {
    setTimeout(accept, QUIET_SAMPLE_MS);
  });
  const after = cpuCounters(
    await readFile("/proc/stat", "utf8").catch(() => fail("PERFORMANCE_COLLECTION_FAILED")),
  );
  const total = after.total - before.total;
  const idle = after.idle - before.idle;
  if (total <= 0 || idle < 0 || idle > total) fail("PERFORMANCE_COLLECTION_FAILED");
  return idle / total;
}

/** Wait for a quiet host before capture; never reject or replace a measured Lighthouse report. */
export async function waitForMeasurementIsolation({
  observe = observeCpuIdleFraction,
  minimumIdleFraction = QUIET_IDLE_FRACTION,
  consecutiveSamples = QUIET_CONSECUTIVE_SAMPLES,
  maxSamples = QUIET_MAX_SAMPLES,
} = {}) {
  if (
    typeof observe !== "function" ||
    !Number.isFinite(minimumIdleFraction) ||
    minimumIdleFraction <= 0 ||
    minimumIdleFraction > 1 ||
    !Number.isSafeInteger(consecutiveSamples) ||
    consecutiveSamples < 1 ||
    !Number.isSafeInteger(maxSamples) ||
    maxSamples < consecutiveSamples
  )
    fail("PERFORMANCE_ARGUMENTS_INVALID");
  let quiet = 0;
  for (let sample = 0; sample < maxSamples; sample += 1) {
    const idleFraction = await observe();
    if (!Number.isFinite(idleFraction) || idleFraction < 0 || idleFraction > 1)
      fail("PERFORMANCE_COLLECTION_FAILED");
    quiet = idleFraction >= minimumIdleFraction ? quiet + 1 : 0;
    if (quiet >= consecutiveSamples) return;
  }
  fail("PERFORMANCE_HOST_BUSY");
}

function hasInvalidColdCaptureTiming(result, navigationTimeoutMs) {
  const timing = result?.lhr?.audits?.metrics?.details?.items?.[0];
  const observedTimeToFirstByte = timing?.timeToFirstByte;
  const serverResponseTime = result?.lhr?.audits?.["server-response-time"]?.numericValue;
  return (
    typeof observedTimeToFirstByte === "number" &&
    Number.isFinite(observedTimeToFirstByte) &&
    typeof serverResponseTime === "number" &&
    Number.isFinite(serverResponseTime) &&
    observedTimeToFirstByte > navigationTimeoutMs &&
    serverResponseTime <= navigationTimeoutMs
  );
}

export async function collectValidReports({ runs, navigationTimeoutMs, collect }) {
  if (
    !Number.isSafeInteger(runs) ||
    runs < 1 ||
    !Number.isFinite(navigationTimeoutMs) ||
    navigationTimeoutMs <= 0 ||
    typeof collect !== "function"
  )
    fail("PERFORMANCE_ARGUMENTS_INVALID");
  const reports = [];
  for (let run = 0; run < runs; run += 1) {
    let accepted;
    for (let attempt = 0; attempt < MAX_CAPTURE_ATTEMPTS; attempt += 1) {
      const result = await collect();
      if (!result?.lhr) fail("PERFORMANCE_REPORT_INVALID");
      if (!hasInvalidColdCaptureTiming(result, navigationTimeoutMs)) {
        accepted = result;
        break;
      }
    }
    if (!accepted) fail("PERFORMANCE_REPORT_INVALID");
    reports.push(accepted);
  }
  return Object.freeze(reports);
}

async function collectMode(origin, mode, routes, policy) {
  const chrome = await launchChrome({
    chromePath: process.env.CHROME_PATH || "/usr/bin/chromium",
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage"],
  }).catch(() => fail("PERFORMANCE_COLLECTION_FAILED"));
  const modeReport = [];
  try {
    for (const route of routes) {
      const collect = async () => {
        await waitForMeasurementIsolation();
        return withCollectionTimeout(
          lighthouse(new URL(publicPath(mode, route.pathname), origin).href, {
            port: chrome.port,
            output: "json",
            logLevel: "silent",
            onlyCategories: ["performance"],
          }),
          policy.limits.collectionTimeoutMs,
        ).catch((error) => {
          if (error instanceof PerformanceBudgetError) throw error;
          fail("PERFORMANCE_COLLECTION_FAILED");
        });
      };
      let results = await collectValidReports({
        runs: policy.lighthouse.runs,
        navigationTimeoutMs: policy.limits.navigationTimeoutMs,
        collect,
      });
      await writeLighthouseReports(results, policy.reports.directory, mode, route);
      let runs = results.map((result) => measuredMetrics(result.lhr));
      let confirmationResults = [];
      const confirmed = await confirmMedianMetrics(runs, policy.lighthouse, async () => {
        confirmationResults = await collectValidReports({
          runs: 2,
          navigationTimeoutMs: policy.limits.navigationTimeoutMs,
          collect,
        });
        await writeLighthouseReports(
          confirmationResults,
          policy.reports.directory,
          mode,
          route,
          results.length,
        );
        return confirmationResults.map((result) => measuredMetrics(result.lhr));
      });
      runs = confirmed.runs;
      modeReport.push({ label: route.label, runs, median: confirmed.median });
    }
  } finally {
    try {
      await chrome.kill();
    } catch {
      // Collection results remain authoritative when teardown has already
      // closed the browser process.
    }
  }
  return modeReport;
}

export async function runPerformanceBudget() {
  const policy = JSON.parse(await readFile(POLICY_PATH, "utf8"));
  const scope = process.env.ATLAS_PERFORMANCE_SCOPE ?? "full";
  if (!new Set(["full", "transfer"]).has(scope)) fail("PERFORMANCE_ARGUMENTS_INVALID");
  const configuredModes =
    process.env.ATLAS_TEST_MODE === "pages"
      ? [
          {
            label: "pages",
            base: process.env.ATLAS_PAGES_BASE,
            artifact: process.env.ATLAS_PAGES_ARTIFACT,
          },
        ]
      : policy.modes;
  const modes = [];
  for (const mode of configuredModes) modes.push(await inspectArtifact(mode, policy.limits));
  const transfer = await exactTransfer(policy, modes);
  if (scope === "transfer") return Object.freeze({ ok: true, transfer, modes: [] });
  const reports = [];
  for (const mode of modes) {
    const server = await createPreviewServer(mode, { productionCompression: true });
    try {
      const origin = await listen(server);
      const routes = await discoverRoutes(mode, policy);
      await proveContent(origin, mode, routes, policy);
      reports.push({ mode: mode.name, routes: await collectMode(origin, mode, routes, policy) });
    } finally {
      await new Promise((accept) => {
        server.close(accept);
      }).catch(() => undefined);
    }
  }
  return Object.freeze({ ok: true, transfer, modes: reports });
}

async function main() {
  if (process.argv.length !== 2) fail("PERFORMANCE_ARGUMENTS_INVALID");
  const report = await runPerformanceBudget();
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = CONTROLLED_CODES.has(error?.code) ? error.code : "PERFORMANCE_COLLECTION_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  });
}
