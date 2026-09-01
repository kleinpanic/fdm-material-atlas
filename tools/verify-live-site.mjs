#!/usr/bin/env node

import { closeSync } from "node:fs";
import { readFile } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import { launch as launchChrome } from "chrome-launcher";
import lighthouse from "lighthouse";
import { chromium } from "playwright";

import { isMainModule } from "./lib/main-module.mjs";
import { readProtectedPolicyFromFd } from "./lib/protected-policy-input.mjs";
import {
  advanceReleaseEvidence,
  parseReleaseEvidence,
  writeReleaseEvidence,
} from "./lib/release-evidence.mjs";
import { validateDeployedPageUrl } from "./probe-pages.mjs";

const ROUTES = ["", "materials/", "compare/", "data/", "map/", "method/"];
const SAFE_MIME =
  /^(?:text\/(?:html|css)|application\/(?:javascript|json)|font\/woff2?|image\/(?:avif|gif|jpeg|png|svg\+xml|webp))(?:;|$)/iu;
const SOURCE_MAP = /(?:sourceMappingURL\s*=|\.map(?:$|[?#]))/iu;
const MAX_ROUTES = 64;
const MAX_ASSETS = 256;
const MAX_BODY = 2 * 1024 * 1024;
const MAX_TOTAL = 32 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export class LiveSiteError extends Error {
  constructor(code) {
    super(code);
    this.name = "LiveSiteError";
    this.code = code;
  }
}
function fail(code) {
  throw new LiveSiteError(code);
}

function validateSyntheticUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("LIVE_URL_INVALID");
  }
  if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/"))
    fail("LIVE_URL_INVALID");
  return { origin: url.origin, basePath: url.pathname, homeUrl: url.href };
}

function candidateUrls(text, current, contract) {
  const values = [];
  for (const match of text.matchAll(
    /(?:<(?:script|img|source)\b[^>]*\bsrc|<link\b[^>]*\bhref)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)|(?:import\s*(?:\(|)["'])([^"']+)/giu,
  )) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw || raw.startsWith("#") || raw.startsWith("data:")) continue;
    let url;
    try {
      url = new URL(raw, current);
    } catch {
      fail("LIVE_REFERENCE_INVALID");
    }
    if (url.origin !== contract.origin) fail("LIVE_EXTERNAL_RUNTIME_REQUEST");
    if (!url.pathname.startsWith(contract.basePath)) fail("LIVE_BASE_ESCAPE");
    url.hash = "";
    url.search = "";
    values.push(url.href);
  }
  return values;
}

async function boundedFetch(url, contract, fetchImpl, deadline) {
  let current = new URL(url);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    if (Date.now() > deadline) fail("LIVE_TIMEOUT");
    const response = await fetchImpl(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => fail("LIVE_NETWORK"));
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) fail("LIVE_REDIRECT_INVALID");
      const next = new URL(location, current);
      if (next.origin !== contract.origin) fail("LIVE_REDIRECT_ORIGIN");
      if (!next.pathname.startsWith(contract.basePath)) fail("LIVE_BASE_ESCAPE");
      current = next;
      continue;
    }
    if (!response.ok) fail("LIVE_HTTP_STATUS");
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_BODY) fail("LIVE_BODY_BOUNDS");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BODY) fail("LIVE_BODY_BOUNDS");
    const type = response.headers.get("content-type") ?? "";
    if (!SAFE_MIME.test(type)) fail("LIVE_CONTENT_TYPE");
    return { url: current, bytes, type };
  }
  fail("LIVE_REDIRECT_LIMIT");
}

/** Capture required routes and their complete bounded same-origin static graph. */
export async function captureLiveSurface({
  pagesUrl,
  synthetic = false,
  exactPatterns = [],
  fetchImpl = fetch,
  deadlineMs = 60_000,
} = {}) {
  const contract = synthetic ? validateSyntheticUrl(pagesUrl) : validateDeployedPageUrl(pagesUrl);
  if (!synthetic && !pagesUrl.startsWith("https://")) fail("LIVE_HTTPS_REQUIRED");
  const deadline = Date.now() + deadlineMs;
  const queue = ROUTES.map((suffix) => new URL(suffix, contract.homeUrl).href);
  const visited = new Set();
  const routeUrls = new Set(queue);
  let representativeAdded = false;
  let totalBytes = 0;
  let assetCount = 0;
  while (queue.length > 0) {
    const requested = queue.shift();
    if (visited.has(requested)) continue;
    const response = await boundedFetch(requested, contract, fetchImpl, deadline);
    if (visited.has(response.url.href)) continue;
    visited.add(response.url.href);
    totalBytes += response.bytes.length;
    if (totalBytes > MAX_TOTAL) fail("LIVE_GRAPH_BOUNDS");
    const text = response.bytes.toString("utf8");
    if (SOURCE_MAP.test(response.url.pathname) || SOURCE_MAP.test(text)) fail("LIVE_SOURCE_MAP");
    for (const pattern of exactPatterns) {
      if (response.bytes.includes(pattern)) fail("LIVE_PROTECTED_CONTENT");
    }
    if (
      /(?:authorization\s*:\s*bearer|github_pat_|gh[pousr]_|BEGIN (?:[A-Z]+ )*PRIVATE KEY)/iu.test(
        text,
      )
    )
      fail("LIVE_PROHIBITED_CONTENT");
    if (response.type.toLowerCase().startsWith("text/html")) {
      if (
        !text.includes("FDM Material Atlas") ||
        !/<main\b[^>]*id=["']main-content["']/iu.test(text)
      )
        fail("LIVE_MARKER_MISSING");
      if (!representativeAdded) {
        const match = text.match(
          new RegExp(
            `["'](${contract.basePath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}materials/[a-z0-9-]+/)["']`,
            "u",
          ),
        );
        if (match) {
          queue.push(new URL(match[1], contract.origin).href);
          routeUrls.add(new URL(match[1], contract.origin).href);
          representativeAdded = true;
        }
      }
    } else assetCount += 1;
    for (const found of candidateUrls(text, response.url, contract)) {
      if (!visited.has(found)) queue.push(found);
    }
    if (routeUrls.size > MAX_ROUTES || assetCount + queue.length > MAX_ASSETS + MAX_ROUTES)
      fail("LIVE_GRAPH_BOUNDS");
  }
  if (!representativeAdded) fail("LIVE_MATERIAL_ROUTE_MISSING");
  return Object.freeze({
    ok: true,
    routeCount: routeUrls.size,
    assetCount,
    findingCount: 0,
    status: "passed",
  });
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function auditLiveBrowser(pagesUrl) {
  const contract = validateDeployedPageUrl(pagesUrl);
  const browser = await chromium
    .launch({ headless: true })
    .catch(() => fail("LIVE_BROWSER_FAILED"));
  let materialUrl;
  try {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const failures = [];
    page.on("console", (message) => {
      if (message.type() === "error") failures.push("console");
    });
    page.on("pageerror", () => failures.push("page"));
    page.on("requestfailed", () => failures.push("request"));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== contract.origin) failures.push("origin");
      if (url.protocol !== "https:") failures.push("mixed-content");
    });

    const routeSuffixes = ["", "materials/", "compare/", "data/", "map/", "method/"];
    for (const suffix of routeSuffixes) {
      await page.goto(new URL(suffix, contract.homeUrl).href, {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
      if ((await page.locator("main#main-content").count()) !== 1)
        fail("LIVE_BROWSER_MARKER_MISSING");
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      if (axe.violations.length !== 0) fail("LIVE_ACCESSIBILITY_FAILED");
    }

    await page.goto(contract.homeUrl, { waitUntil: "networkidle", timeout: 30_000 });
    const goals = page.getByRole("radio");
    if ((await goals.count()) < 2) fail("LIVE_SELECTOR_FAILED");
    await goals.nth(1).check();
    if (
      !/compatible materials; \d+ eliminated\./u.test(
        (await page.locator("[role=status]").textContent()) ?? "",
      )
    )
      fail("LIVE_SELECTOR_FAILED");
    const firstResult = page.locator(".selector-compatible-list > li").first();
    await firstResult.getByText("Why this rank", { exact: true }).click();
    if ((await firstResult.locator("[data-contribution-state]").count()) < 1)
      fail("LIVE_SELECTOR_FAILED");
    const detail = await firstResult
      .getByRole("link", { name: "View material details" })
      .getAttribute("href");
    if (!detail) fail("LIVE_MATERIAL_ROUTE_MISSING");
    materialUrl = new URL(detail, contract.homeUrl).href;
    const addButtons = page.getByRole("button", { name: /^Add .+ to shortlist$/u });
    if ((await addButtons.count()) < 2) fail("LIVE_COMPARE_FAILED");
    await addButtons.nth(0).click();
    await addButtons.nth(1).click();
    await page.getByRole("link", { name: "Compare shortlisted" }).click();
    await page.getByRole("heading", { name: "Comparison of 2 materials" }).waitFor();

    await page.goto(materialUrl, { waitUntil: "networkidle", timeout: 30_000 });
    if ((await page.locator("#starting-profile, #evidence").count()) !== 2)
      fail("LIVE_MATERIAL_FAILED");
    await page.goto(new URL("data/", contract.homeUrl).href, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    const dataSearch = page.locator('input[type="search"]').first();
    if ((await dataSearch.count()) !== 1) fail("LIVE_DATA_FAILED");
    await dataSearch.fill("PLA");
    await page.goto(new URL("map/", contract.homeUrl).href, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    const lane = page.getByRole("button", { name: /^Highlight /u }).first();
    if ((await lane.count()) !== 1) fail("LIVE_MAP_FAILED");
    await lane.click();
    await page.goto(new URL("method/", contract.homeUrl).href, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    if ((await page.locator("#evidence-scopes").count()) !== 1) fail("LIVE_METHOD_FAILED");
    if (failures.length !== 0) fail("LIVE_BROWSER_ERROR");
  } finally {
    await browser.close().catch(() => undefined);
  }
  return materialUrl;
}

async function auditLivePerformance(pagesUrl, materialUrl) {
  const contract = validateDeployedPageUrl(pagesUrl);
  const policy = JSON.parse(
    await readFile(new URL("../performance-budgets.json", import.meta.url), "utf8"),
  );
  const routes = ["", "compare/", "data/", "map/"].map(
    (suffix) => new URL(suffix, contract.homeUrl).href,
  );
  routes.splice(1, 0, materialUrl);
  const chrome = await launchChrome({
    chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu"],
  }).catch(() => fail("LIVE_PERFORMANCE_FAILED"));
  try {
    for (const route of routes) {
      const reports = [];
      for (let run = 0; run < policy.lighthouse.runs; run += 1) {
        const result = await lighthouse(route, {
          port: chrome.port,
          output: "json",
          logLevel: "silent",
          onlyCategories: ["performance"],
        }).catch(() => fail("LIVE_PERFORMANCE_FAILED"));
        if (!result?.lhr) fail("LIVE_PERFORMANCE_FAILED");
        reports.push(result.lhr);
      }
      const score = median(reports.map((report) => report.categories.performance.score ?? 0));
      const audit = (id) =>
        median(
          reports.map((report) => report.audits[id]?.numericValue ?? Number.POSITIVE_INFINITY),
        );
      if (
        score < policy.lighthouse.performanceScore ||
        audit("first-contentful-paint") > policy.lighthouse.firstContentfulPaintMs ||
        audit("largest-contentful-paint") > policy.lighthouse.largestContentfulPaintMs ||
        audit("cumulative-layout-shift") > policy.lighthouse.cumulativeLayoutShift ||
        audit("total-blocking-time") > policy.lighthouse.totalBlockingTimeMs ||
        audit("total-byte-weight") > policy.lighthouse.totalBytes
      )
        fail("LIVE_PERFORMANCE_BUDGET");
    }
  } finally {
    await chrome.kill().catch(() => undefined);
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index],
      value = argv[index + 1];
    if (!value || !["--sensitive-fd", "--evidence"].includes(flag)) fail("LIVE_ARGUMENT_INVALID");
    result[flag.slice(2)] = value;
  }
  if (result["sensitive-fd"] !== "3" || !result.evidence) fail("LIVE_ARGUMENT_INVALID");
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = await readProtectedPolicyFromFd({ fd: 3 });
  closeSync(3);
  const evidence = parseReleaseEvidence(JSON.parse(await readFile(args.evidence, "utf8")));
  if (evidence.stage !== "deployed") fail("LIVE_EVIDENCE_STAGE_INVALID");
  const live = await captureLiveSurface({
    pagesUrl: evidence.deployment.pages.url,
    exactPatterns: policy.exactPatterns,
  });
  const materialUrl = await auditLiveBrowser(evidence.deployment.pages.url);
  await auditLivePerformance(evidence.deployment.pages.url, materialUrl);
  const remote = {
    refCount: evidence.publication.advertisedRefs.count,
    commitCount: evidence.publication.history.commitCount,
    advertisedRefDigest: evidence.publication.advertisedRefs.digest,
    mainSha: evidence.commitSha,
    findingCount: 0,
    status: "passed",
  };
  const verified = advanceReleaseEvidence(evidence, {
    stage: "verified",
    observation: {
      observedAt: new Date().toISOString(),
      live: {
        routeCount: live.routeCount,
        assetCount: live.assetCount,
        findingCount: live.findingCount,
        status: live.status,
      },
      remote,
      accessibility: { status: "passed", scope: "representative-live-routes" },
      performance: { status: "passed", scope: "established-live-budgets" },
    },
  });
  await writeReleaseEvidence(args.evidence, verified);
  process.stdout.write(`${JSON.stringify({ ok: true, ...live })}\n`);
}

if (await isMainModule(import.meta.url))
  main().catch((error) => {
    const code = error instanceof LiveSiteError ? error.code : "LIVE_AUDIT_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  });
