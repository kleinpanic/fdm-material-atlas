#!/usr/bin/env node

import { launch as launchChrome } from "chrome-launcher";
import { gzipSync } from "node:zlib";
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
    !["root", "repository"].includes(mode.label) ||
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
  const decodedProps = props
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&amp;", "&");
  let projectionBytes;
  try {
    const parsed = reviveAstro(JSON.parse(decodedProps));
    const encoded = parsed.projection;
    projectionBytes = gzipSync(Buffer.from(JSON.stringify(encoded)), {
      level: 9,
      mtime: 0,
    }).byteLength;
  } catch {
    fail("PERFORMANCE_REPORT_INVALID");
  }
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

export async function exactTransfer(policy, modes) {
  const phase6 = await verifyPhase6Build({
    modes: modes.map((mode) => ({ name: mode.name, base: mode.base, output: mode.output })),
    runPublication: false,
  }).catch(() => fail("PERFORMANCE_BUDGET_EXCEEDED"));
  const phase7 = await verifyPhase7Build({
    rootOutput: modes[0].output,
    repositoryOutput: modes[1].output,
    runPublicationScan: false,
  }).catch(() => fail("PERFORMANCE_BUDGET_EXCEEDED"));
  const reports = [];
  for (const mode of modes) {
    const selector = await verifySelectorBuild({
      outputRoot: mode.output,
      base: mode.base,
      maxGzipBytes: policy.gzip.selectorBytes,
    }).catch(() => fail("PERFORMANCE_BUDGET_EXCEEDED"));
    const atlas = phase6.modes.find((item) => item.mode === mode.name);
    const comparison = phase7.modes.find((item) => item.mode === mode.name);
    if (!atlas || !comparison) fail("PERFORMANCE_REPORT_INVALID");
    if (
      atlas.atlasGzipBytes > policy.gzip.atlasBytes ||
      comparison.compareGzipBytes > policy.gzip.compareBytes ||
      comparison.dataGzipBytes > policy.gzip.dataBytes
    )
      fail("PERFORMANCE_BUDGET_EXCEEDED");
    reports.push({
      mode: mode.name,
      selector: selector.totalGzipBytes,
      atlas: atlas.atlasGzipBytes,
      compare: comparison.compareGzipBytes,
      data: comparison.dataGzipBytes,
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

async function collectMode(origin, mode, routes, policy) {
  const chrome = await launchChrome({
    chromePath: process.env.CHROME_PATH || "/usr/bin/chromium",
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage"],
  }).catch(() => fail("PERFORMANCE_COLLECTION_FAILED"));
  const modeReport = [];
  try {
    for (const route of routes) {
      const runs = [];
      for (let run = 1; run <= policy.lighthouse.runs; run += 1) {
        const result = await withCollectionTimeout(
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
        if (!result?.lhr) fail("PERFORMANCE_REPORT_INVALID");
        const metrics = measuredMetrics(result.lhr);
        const directory = resolve(PROJECT_ROOT, policy.reports.directory, mode.name);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, `${route.label}-${run}.json`), JSON.stringify(result.lhr));
        assertMetrics(metrics, policy.lighthouse);
        runs.push(metrics);
      }
      modeReport.push({ label: route.label, runs });
    }
  } finally {
    await chrome.kill().catch(() => undefined);
  }
  return modeReport;
}

export async function runPerformanceBudget() {
  const policy = JSON.parse(await readFile(POLICY_PATH, "utf8"));
  const modes = [];
  for (const mode of policy.modes) modes.push(await inspectArtifact(mode, policy.limits));
  const transfer = await exactTransfer(policy, modes);
  const reports = [];
  for (const mode of modes) {
    const server = await createPreviewServer(mode);
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
