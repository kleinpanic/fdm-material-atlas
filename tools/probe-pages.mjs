import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_LIMITS = Object.freeze({
  maxAttempts: 3,
  maxRedirects: 3,
  perRequestTimeoutMs: 8_000,
  totalDeadlineMs: 45_000,
  bodyLimitBytes: 1_000_000,
  retryDelayMs: 750,
});

const LIMIT_BOUNDS = Object.freeze({
  maxAttempts: 3,
  maxRedirects: 3,
  perRequestTimeoutMs: 10_000,
  totalDeadlineMs: 60_000,
  bodyLimitBytes: 1_000_000,
  retryDelayMs: 5_000,
});

const HTML_CONTENT_TYPE = /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/iu;
const JAVASCRIPT_CONTENT_TYPE = /^(?:text|application)\/(?:javascript|x-javascript)(?:;|$)/iu;
const HASHED_ASSET_PATH = /\.[A-Za-z0-9_-]{8,}\.(?:avif|css|gif|jpe?g|js|png|svg|webp|woff2?)$/u;
const MATERIAL_DETAIL_SUFFIX = /^materials\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/$/u;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/u;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_CODES = new Set([
  "PROBE_NETWORK",
  "PROBE_TIMEOUT",
  "PROBE_HTTP_STATUS",
  "PROBE_CONTENT_TYPE",
  "PROBE_MARKER_MISSING",
  "PROBE_CANONICAL_INVALID",
  "PROBE_ASSET_MISSING",
  "PROBE_DETAIL_MISSING",
  "PROBE_ROUTE_MISSING",
]);
const PROHIBITED_CONTENT = Object.freeze([
  /authorization\s*:\s*(?:basic|bearer)/iu,
  /(?:access|refresh|id)[_-]?token\s*[:=]/iu,
  /client[_-]?secret\s*[:=]/iu,
  /(?:GOG_CONFIG|GOOGLE_APPLICATION_CREDENTIALS)/u,
  /https?:\/\/docs\.google\.com\/(?:forms|spreadsheets)\//iu,
]);

/** Stable, data-free failure exposed by the importable API and CLI. */
export class PagesProbeError extends Error {
  constructor(code) {
    super(code);
    Object.defineProperty(this, "name", { value: "PagesProbeError" });
    Object.defineProperty(this, "code", { value: code, enumerable: true });
  }

  toJSON() {
    return { code: this.code };
  }
}

function fail(code) {
  throw new PagesProbeError(code);
}

function boundedInteger(value, fallback, maximum) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < 0 || candidate > maximum) {
    fail("PROBE_LIMIT_INVALID");
  }
  return candidate;
}

function normalizeLimits(options) {
  const limits = {
    maxAttempts: boundedInteger(
      options.maxAttempts,
      DEFAULT_LIMITS.maxAttempts,
      LIMIT_BOUNDS.maxAttempts,
    ),
    maxRedirects: boundedInteger(
      options.maxRedirects,
      DEFAULT_LIMITS.maxRedirects,
      LIMIT_BOUNDS.maxRedirects,
    ),
    perRequestTimeoutMs: boundedInteger(
      options.perRequestTimeoutMs,
      DEFAULT_LIMITS.perRequestTimeoutMs,
      LIMIT_BOUNDS.perRequestTimeoutMs,
    ),
    totalDeadlineMs: boundedInteger(
      options.totalDeadlineMs,
      DEFAULT_LIMITS.totalDeadlineMs,
      LIMIT_BOUNDS.totalDeadlineMs,
    ),
    bodyLimitBytes: boundedInteger(
      options.bodyLimitBytes,
      DEFAULT_LIMITS.bodyLimitBytes,
      LIMIT_BOUNDS.bodyLimitBytes,
    ),
    retryDelayMs: boundedInteger(
      options.retryDelayMs,
      DEFAULT_LIMITS.retryDelayMs,
      LIMIT_BOUNDS.retryDelayMs,
    ),
  };
  if (
    limits.maxAttempts < 1 ||
    limits.perRequestTimeoutMs < 1 ||
    limits.totalDeadlineMs < limits.perRequestTimeoutMs ||
    limits.bodyLimitBytes < 1
  ) {
    fail("PROBE_LIMIT_INVALID");
  }
  return Object.freeze(limits);
}

/** Validate the exact normalized Pages output URL without returning rejected input. */
export function validateDeployedPageUrl(value) {
  if (value === undefined || value === null || value === "") fail("PROBE_INPUT_MISSING");
  if (typeof value !== "string" || value.length > 2_048 || value.trim() !== value) {
    fail("PROBE_INPUT_INVALID");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("PROBE_INPUT_INVALID");
  }

  const segments = parsed.pathname === "/" ? [] : parsed.pathname.slice(1, -1).split("/");
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !parsed.pathname.startsWith("/") ||
    !parsed.pathname.endsWith("/") ||
    parsed.pathname.includes("//") ||
    value.includes("\\") ||
    value.includes("%") ||
    value !== parsed.href ||
    segments.some(
      (segment) =>
        segment === "" || segment === "." || segment === ".." || !SAFE_PATH_SEGMENT.test(segment),
    )
  ) {
    fail("PROBE_INPUT_INVALID");
  }

  return Object.freeze({
    origin: parsed.origin,
    basePath: parsed.pathname,
    homeUrl: parsed.href,
    deployment: parsed.pathname === "/" ? "root" : "repository",
  });
}

function safeUrl(candidate, contract, errorCode = "PROBE_TARGET_INVALID") {
  let parsed;
  try {
    parsed =
      candidate instanceof URL ? new URL(candidate.href) : new URL(candidate, contract.homeUrl);
  } catch {
    fail(errorCode);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== contract.origin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !parsed.pathname.startsWith(contract.basePath) ||
    parsed.pathname.includes("\\") ||
    parsed.pathname.includes("//") ||
    parsed.href.includes("%")
  ) {
    fail(parsed.origin !== contract.origin ? "PROBE_REDIRECT_ORIGIN" : errorCode);
  }
  return parsed;
}

function routeUrl(contract, suffix) {
  return safeUrl(new URL(suffix, contract.homeUrl), contract);
}

function readAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, "iu"));
  return match?.[2];
}

function tags(source, name) {
  return source.match(new RegExp(`<${name}\\b[^>]*>`, "giu")) ?? [];
}

function canonicalHref(source) {
  for (const tag of tags(source, "link")) {
    const rel = readAttribute(tag, "rel")?.toLowerCase().split(/\s+/u) ?? [];
    if (rel.includes("canonical")) return readAttribute(tag, "href");
  }
  return undefined;
}

function assertPublicContent(source) {
  if (PROHIBITED_CONTENT.some((pattern) => pattern.test(source))) {
    fail("PROBE_PROHIBITED_CONTENT");
  }
}

function assertHtmlDocument(source, expectedUrl) {
  assertPublicContent(source);
  if (
    !/<main\b[^>]*\bid\s*=\s*["']main-content["'][^>]*>/iu.test(source) ||
    !source.includes("FDM Material Atlas")
  ) {
    fail("PROBE_MARKER_MISSING");
  }
  if (canonicalHref(source) !== expectedUrl.href) fail("PROBE_CANONICAL_INVALID");
}

function discoverAsset(source, contract) {
  const references = [
    ...tags(source, "script").map((tag) => readAttribute(tag, "src")),
    ...tags(source, "link").map((tag) => readAttribute(tag, "href")),
  ].filter((value) => typeof value === "string");
  for (const reference of references) {
    let url;
    try {
      url = safeUrl(reference, contract);
    } catch (error) {
      if (error instanceof PagesProbeError) continue;
      throw error;
    }
    if (url.pathname.includes("/_astro/") && HASHED_ASSET_PATH.test(url.pathname)) return url;
  }
  fail("PROBE_ASSET_MISSING");
}

function discoverMaterialDetail(source, contract) {
  for (const tag of tags(source, "a")) {
    const reference = readAttribute(tag, "href");
    if (reference === undefined) continue;
    let url;
    try {
      url = safeUrl(reference, contract);
    } catch (error) {
      if (error instanceof PagesProbeError) continue;
      throw error;
    }
    const relativePath = url.pathname.slice(contract.basePath.length);
    if (MATERIAL_DETAIL_SUFFIX.test(relativePath)) return url;
  }
  fail("PROBE_DETAIL_MISSING");
}

function discoverNavigation(source, contract) {
  const expected = Object.freeze({
    materials: routeUrl(contract, "materials/"),
    compare: routeUrl(contract, "compare/"),
    data: routeUrl(contract, "data/"),
    map: routeUrl(contract, "map/"),
    method: routeUrl(contract, "method/"),
  });
  const discovered = {};
  for (const tag of tags(source, "a")) {
    const reference = readAttribute(tag, "href");
    if (reference === undefined) continue;
    let url;
    try {
      url = safeUrl(reference, contract);
    } catch (error) {
      if (error instanceof PagesProbeError) continue;
      throw error;
    }
    for (const [label, expectedUrl] of Object.entries(expected)) {
      if (url.href === expectedUrl.href) discovered[label] = url;
    }
  }
  if (Object.keys(discovered).length !== Object.keys(expected).length) {
    fail("PROBE_ROUTE_MISSING");
  }
  return Object.freeze(discovered);
}

function expectedAssetContentType(pathname, contentType) {
  const normalized = contentType.toLowerCase();
  if (pathname.endsWith(".css")) return /^text\/css(?:;|$)/u.test(normalized);
  if (pathname.endsWith(".js")) return JAVASCRIPT_CONTENT_TYPE.test(normalized);
  if (/\.woff2?$/u.test(pathname))
    return /^(?:font\/|application\/(?:font|x-font))/u.test(normalized);
  if (/\.(?:avif|gif|jpe?g|png|svg|webp)$/u.test(pathname)) return /^image\//u.test(normalized);
  return false;
}

async function readBoundedBody(response, limit) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) fail("PROBE_BODY_TOO_LARGE");
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let source = "";
  try {
    while (true) {
      const record = await reader.read();
      if (record.done) break;
      size += record.value.byteLength;
      if (size > limit) fail("PROBE_BODY_TOO_LARGE");
      source += decoder.decode(record.value, { stream: true });
    }
    source += decoder.decode();
  } catch (error) {
    if (error instanceof PagesProbeError) throw error;
    fail("PROBE_BODY_INVALID");
  }
  return source;
}

async function requestResource({ url, contract, fetchImpl, limits, deadline, now }) {
  let current = safeUrl(url, contract);
  const visited = new Set([current.href]);
  let redirectCount = 0;
  const controller = new AbortController();
  const remaining = deadline - now();
  if (remaining <= 0) fail("PROBE_DEADLINE");
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(limits.perRequestTimeoutMs, remaining),
  );

  try {
    while (true) {
      let response;
      try {
        response = await fetchImpl(current.href, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.1" },
        });
      } catch {
        if (controller.signal.aborted) fail("PROBE_TIMEOUT");
        fail("PROBE_NETWORK");
      }

      if (REDIRECT_STATUS.has(response.status)) {
        if (redirectCount >= limits.maxRedirects) fail("PROBE_REDIRECT_LIMIT");
        const location = response.headers.get("location");
        if (location === null) fail("PROBE_REDIRECT_INVALID");
        const next = safeUrl(new URL(location, current), contract, "PROBE_REDIRECT_INVALID");
        if (visited.has(next.href)) fail("PROBE_REDIRECT_LOOP");
        visited.add(next.href);
        current = next;
        redirectCount += 1;
        continue;
      }

      if (response.status < 200 || response.status >= 300) fail("PROBE_HTTP_STATUS");
      const source = await readBoundedBody(response, limits.bodyLimitBytes);
      return Object.freeze({
        source,
        status: response.status,
        contentType: response.headers.get("content-type")?.trim() ?? "",
        finalUrl: current,
      });
    }
  } finally {
    clearTimeout(timer);
  }
}

function duration(started, now) {
  return Math.max(0, Math.min(60_000, Math.round(now() - started)));
}

function eventRecord(label, status, durationMs, attempt, code) {
  const event = { label, status, durationMs, attempt };
  if (code !== undefined) event.code = code;
  return Object.freeze(event);
}

async function checkedRequest(context, label, url, kind) {
  const started = context.now();
  try {
    const response = await requestResource({
      url,
      contract: context.contract,
      fetchImpl: context.fetchImpl,
      limits: context.limits,
      deadline: context.deadline,
      now: context.now,
    });
    const normalizedType = response.contentType.toLowerCase();
    if (
      (kind === "html" && !HTML_CONTENT_TYPE.test(normalizedType)) ||
      (kind === "asset" && !expectedAssetContentType(response.finalUrl.pathname, normalizedType))
    ) {
      fail("PROBE_CONTENT_TYPE");
    }
    if (kind === "html") assertHtmlDocument(response.source, response.finalUrl);
    else assertPublicContent(response.source);
    context.onEvent(
      eventRecord(label, response.status, duration(started, context.now), context.attempt),
    );
    return response;
  } catch (error) {
    const controlled =
      error instanceof PagesProbeError ? error : new PagesProbeError("PROBE_INTERNAL");
    context.onEvent(
      eventRecord(label, 0, duration(started, context.now), context.attempt, controlled.code),
    );
    throw controlled;
  }
}

async function probeAttempt(context) {
  const home = await checkedRequest(context, "home", context.contract.homeUrl, "html");
  const assetUrl = discoverAsset(home.source, context.contract);
  const navigation = discoverNavigation(home.source, context.contract);
  const materials = await checkedRequest(context, "materials", navigation.materials, "html");
  const detailUrl = discoverMaterialDetail(materials.source, context.contract);
  await checkedRequest(context, "material-detail", detailUrl, "html");
  for (const label of ["compare", "data", "map", "method"]) {
    await checkedRequest(context, label, navigation[label], "html");
  }
  await checkedRequest(context, "asset", assetUrl, "asset");
}

function defaultSleep(milliseconds) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  });
}

/** Probe one deployed Pages origin using only bounded, same-origin requests. */
export async function probePages(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    fail("PROBE_OPTIONS_INVALID");
  }
  const contract = validateDeployedPageUrl(options.deployedPageUrl);
  const limits = normalizeLimits(options);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const onEvent = options.onEvent ?? (() => {});
  if (
    typeof fetchImpl !== "function" ||
    typeof now !== "function" ||
    typeof sleep !== "function" ||
    typeof onEvent !== "function"
  ) {
    fail("PROBE_OPTIONS_INVALID");
  }
  const deadline = now() + limits.totalDeadlineMs;

  for (let attempt = 1; attempt <= limits.maxAttempts; attempt += 1) {
    try {
      await probeAttempt({ contract, limits, fetchImpl, now, onEvent, deadline, attempt });
      return Object.freeze({
        ok: true,
        checks: 8,
        attempts: attempt,
        deployment: contract.deployment,
      });
    } catch (error) {
      const controlled =
        error instanceof PagesProbeError ? error : new PagesProbeError("PROBE_INTERNAL");
      if (
        attempt >= limits.maxAttempts ||
        !RETRYABLE_CODES.has(controlled.code) ||
        now() + limits.retryDelayMs >= deadline
      ) {
        throw controlled;
      }
      await sleep(limits.retryDelayMs);
    }
  }
  fail("PROBE_INTERNAL");
}

async function runCli() {
  try {
    if (process.argv.length !== 2) fail("PROBE_ARGUMENT_INVALID");
    const result = await probePages({
      deployedPageUrl: process.env.DEPLOYED_PAGE_URL,
      onEvent: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof PagesProbeError ? error.code : "PROBE_INTERNAL";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  }
}

const isCli =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) await runCli();
