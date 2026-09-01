#!/usr/bin/env node

import { gzipSync } from "node:zlib";
import { lstat, opendir, readFile, realpath } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MAX_GZIP_BYTES = 100 * 1024;
const DEFAULT_MAX_INDEX_HTML_BYTES = 110 * 1024;
const DEFAULT_MAX_SELECTOR_ENTRY_JAVASCRIPT_BYTES = 90 * 1024;
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const PROHIBITED_PROP_KEYS = new Set([
  "atlas",
  "evidence",
  "evidenceLedger",
  "sources",
  "sourceLedger",
  "methods",
  "profiles",
  "startingProfiles",
  "decisionLanes",
  "visualizations",
  "sourceMetadata",
  "operationalMetadata",
  "workbook",
  "spreadsheet",
]);
const PROHIBITED_CLIENT_TEXT = [
  /(?:^|["'`/])(?:cytoscape|plotly|echarts|vis-network|three|deck\.gl)(?:["'`/]|$)/i,
  /(?:^|["'`/])d3(?:-[a-z]+)?(?:["'`/]|$)/i,
  /(?:source-adapter|sheet-adapter|gog-cli|googleapis)/i,
];
const FETCH_PATTERN = /\b(?:fetch|XMLHttpRequest|EventSource|WebSocket)\s*\(/;

export class SelectorBuildError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "SelectorBuildError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }

  toJSON() {
    return { code: this.code, ...this.details };
  }
}

function fail(code, details) {
  throw new SelectorBuildError(code, details);
}

function decodeHtmlAttribute(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&#x22;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function attributes(tag) {
  const result = new Map();
  for (const match of tag.matchAll(/\b([a-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    result.set(match[1].toLowerCase(), decodeHtmlAttribute(match[2] ?? match[3] ?? ""));
  }
  return result;
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
    return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, reviveTuple(entry)]));
  }
  return reviveObject(value);
}

function parseProps(serialized) {
  try {
    const parsed = JSON.parse(serialized);
    const looksEncoded = Object.values(parsed).some((value) => Array.isArray(value) && value.length === 2 && Number.isInteger(value[0]));
    return looksEncoded ? reviveAstro(parsed) : parsed;
  } catch {
    fail("SELECTOR_PROPS_INVALID");
  }
}

function inspectPropBoundary(value, exactPatterns, seen = new Set()) {
  if (typeof value === "string") {
    if (exactPatterns.some((pattern) => pattern !== "" && value.includes(pattern))) fail("SELECTOR_PRIVATE_PATTERN_FORBIDDEN");
    return;
  }
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value) || value instanceof Set) {
    for (const item of value) inspectPropBoundary(item, exactPatterns, seen);
    return;
  }
  if (value instanceof Map) {
    for (const [key, item] of value) {
      inspectPropBoundary(key, exactPatterns, seen);
      inspectPropBoundary(item, exactPatterns, seen);
    }
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (PROHIBITED_PROP_KEYS.has(key)) fail("SELECTOR_PROPS_BOUNDARY_VIOLATION");
    inspectPropBoundary(item, exactPatterns, seen);
  }
}

function exactKeys(value, expected) {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function decodeCompactPageModel(value) {
  if (!Array.isArray(value) || value.length !== 3 || value[0] !== 1 || !Array.isArray(value[1])) {
    fail("SELECTOR_PROPS_SHAPE_INVALID");
  }
  const dictionary = value[1];
  if (dictionary.length > 16_384 || dictionary.some((entry, index) =>
    typeof entry !== "string" || entry.length > 4_096 || (index > 0 && entry <= dictionary[index - 1]))) {
    fail("SELECTOR_PROPS_SHAPE_INVALID");
  }
  let nodes = 0;
  function decode(node, depth = 0) {
    if (++nodes > 200_000 || depth > 64 || !Array.isArray(node) || node.length === 0) fail("SELECTOR_PROPS_SHAPE_INVALID");
    if (node[0] === 0) {
      if (node.length !== 2 || !Number.isInteger(node[1]) || node[1] < 0 || node[1] >= dictionary.length) fail("SELECTOR_PROPS_SHAPE_INVALID");
      return dictionary[node[1]];
    }
    if (node[0] === 2) return node.slice(1).map((entry) => decode(entry, depth + 1));
    if (node[0] === 3) {
      if (node.length !== 2 || typeof node[1] !== "number" || !Number.isFinite(node[1])) fail("SELECTOR_PROPS_SHAPE_INVALID");
      return node[1];
    }
    if (node[0] === 4) {
      if (node.length !== 2 || (node[1] !== 0 && node[1] !== 1)) fail("SELECTOR_PROPS_SHAPE_INVALID");
      return node[1] === 1;
    }
    if (node[0] === 5) {
      if (node.length !== 1) fail("SELECTOR_PROPS_SHAPE_INVALID");
      return null;
    }
    if (node[0] !== 1 || (node.length - 1) % 2 !== 0) fail("SELECTOR_PROPS_SHAPE_INVALID");
    const result = Object.create(null);
    for (let index = 1; index < node.length; index += 2) {
      const keyIndex = node[index];
      if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= dictionary.length) fail("SELECTOR_PROPS_SHAPE_INVALID");
      const key = dictionary[keyIndex];
      if (Object.hasOwn(result, key)) fail("SELECTOR_PROPS_SHAPE_INVALID");
      result[key] = decode(node[index + 1], depth + 1);
    }
    return result;
  }
  return decode(value[2]);
}

function validatePageModelShape(props) {
  if (!exactKeys(props, ["pageModel"])) fail("SELECTOR_PROPS_SHAPE_INVALID");
  const pageModel = decodeCompactPageModel(props.pageModel);
  inspectPropBoundary(pageModel, []);
  if (!exactKeys(pageModel, ["projection", "defaults", "display", "routes"])) fail("SELECTOR_PROPS_SHAPE_INVALID");
  const { projection, defaults, display, routes } = pageModel;
  if (
    typeof projection !== "object" || projection === null
    || projection.kind !== "selector-projection"
    || !Array.isArray(projection.criteria)
    || !Array.isArray(projection.materials)
    || typeof defaults !== "object" || defaults === null || Array.isArray(defaults)
    || !exactKeys(display, ["materials"]) || !Array.isArray(display.materials)
    || typeof routes !== "object" || routes === null || !Array.isArray(routes.materials)
  ) fail("SELECTOR_PROPS_SHAPE_INVALID");
  const criterionIds = projection.criteria.map((criterion) => criterion?.id);
  const projectionIds = projection.materials.map((material) => material?.id);
  const displayIds = display.materials.map((material) => material?.id);
  const routeIds = routes.materials.map((material) => material?.materialId);
  if (
    criterionIds.some((id) => typeof id !== "string")
    || projectionIds.some((id) => typeof id !== "string")
    || new Set(criterionIds).size !== criterionIds.length
    || new Set(projectionIds).size !== projectionIds.length
    || Object.keys(defaults).length !== criterionIds.length
    || criterionIds.some((id) => defaults[id] !== projection.criteria.find((criterion) => criterion.id === id)?.defaultOptionId)
    || projectionIds.length !== displayIds.length
    || projectionIds.length !== routeIds.length
    || [...projectionIds].sort().join("\0") !== [...displayIds].sort().join("\0")
    || [...projectionIds].sort().join("\0") !== [...routeIds].sort().join("\0")
  ) fail("SELECTOR_PROPS_COUNT_INVALID");
  return pageModel;
}

async function collectFiles(root) {
  const literal = await lstat(root).catch(() => fail("SELECTOR_OUTPUT_MISSING"));
  if (!literal.isDirectory() || literal.isSymbolicLink()) fail("SELECTOR_OUTPUT_INVALID");
  if (await realpath(root).catch(() => "") !== root) fail("SELECTOR_OUTPUT_INVALID");
  const files = new Map();
  async function walk(directory) {
    const stream = await opendir(directory).catch(() => fail("SELECTOR_OUTPUT_INVALID"));
    for await (const entry of stream) {
      const path = join(directory, entry.name);
      const info = await lstat(path).catch(() => fail("SELECTOR_OUTPUT_INVALID"));
      if (info.isSymbolicLink()) fail("SELECTOR_OUTPUT_SYMLINK_FORBIDDEN");
      if (info.isDirectory()) await walk(path);
      else if (info.isFile()) {
        if (info.size > MAX_FILE_BYTES || files.size >= MAX_FILES) fail("SELECTOR_OUTPUT_LIMIT_EXCEEDED");
        files.set(relative(root, path).split(sep).join("/"), { path, size: info.size });
      } else fail("SELECTOR_OUTPUT_INVALID");
    }
  }
  await walk(root);
  return files;
}

function fileForPublicUrl(raw, base, files, code = "SELECTOR_CLIENT_REFERENCE_INVALID") {
  let url;
  try {
    url = new URL(raw, "https://atlas.example/");
  } catch {
    fail(code);
  }
  if (url.origin !== "https://atlas.example" || url.search !== "") fail(code);
  if (!url.pathname.startsWith(base) || (base !== "/" && url.pathname.startsWith(`${base}${base.slice(1)}`))) fail(code);
  let logical;
  try {
    logical = decodeURIComponent(url.pathname.slice(base.length));
  } catch {
    fail(code);
  }
  if (logical.includes("\\") || logical.split("/").some((part) => part === "." || part === "..")) fail(code);
  const candidate = logical === "" || logical.endsWith("/") ? `${logical}index.html` : logical;
  if (!files.has(candidate)) fail(code);
  return { candidate, fragment: url.hash.slice(1) };
}

function importedSpecifiers(source) {
  const values = [];
  const patterns = [
    /\bimport\s*["']([^"']+)["']/g,
    /\b(?:import|export)\s*[\w*$,\s{}]+\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) values.push(match[1]);
  return values;
}

function resolveImport(specifier, importer, files) {
  if (!specifier.startsWith(".")) fail("SELECTOR_CLIENT_IMPORT_FORBIDDEN");
  const candidate = posix.normalize(posix.join(posix.dirname(importer), specifier));
  if (candidate.startsWith("../") || candidate === ".." || !files.has(candidate)) fail("SELECTOR_CLIENT_REFERENCE_INVALID");
  return candidate;
}

function routeRecords(routes) {
  const records = [];
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== "object" || value === null) return;
    if (Object.hasOwn(value, "kind")) {
      if (value.kind !== "link" && value.kind !== "unavailable") {
        fail("SELECTOR_ROUTE_ACTION_KIND_INVALID");
      }
      records.push(value);
      return;
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(routes);
  return records;
}

async function validateRoutes(props, base, files) {
  const pageModel = props?.pageModel ?? props;
  const records = routeRecords(pageModel?.routes ?? props?.routes ?? {});
  let availableHrefCount = 0;
  for (const record of records) {
    if (record.kind === "unavailable") {
      if (Object.hasOwn(record, "href")) fail("SELECTOR_UNAVAILABLE_HREF_FORBIDDEN");
      continue;
    }
    if (typeof record.href !== "string" || record.href === "") fail("SELECTOR_LINK_HREF_MISSING");
    const { candidate, fragment } = fileForPublicUrl(record.href, base, files, "SELECTOR_LINK_HREF_INVALID");
    if (fragment !== "") {
      const html = await readFile(files.get(candidate).path, "utf8").catch(() => fail("SELECTOR_LINK_HREF_INVALID"));
      const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const count = [...html.matchAll(new RegExp(`(?:^|\\s)id=(?:"${escaped}"|'${escaped}')`, "g"))].length;
      if (count !== 1) fail("SELECTOR_LINK_HREF_INVALID");
    }
    availableHrefCount += 1;
  }
  return availableHrefCount;
}

export async function verifySelectorBuild({
  outputRoot,
  base,
  maxGzipBytes = DEFAULT_MAX_GZIP_BYTES,
  maxIndexHtmlBytes = DEFAULT_MAX_INDEX_HTML_BYTES,
  maxSelectorEntryJavaScriptBytes = DEFAULT_MAX_SELECTOR_ENTRY_JAVASCRIPT_BYTES,
  prohibitedExactPatterns = /** @type {string[]} */ ([]),
}) {
  if (typeof outputRoot !== "string" || !/^\/(?:[a-z0-9-]+\/)*$/.test(base)
      || [maxGzipBytes, maxIndexHtmlBytes, maxSelectorEntryJavaScriptBytes].some((cap) => !Number.isInteger(cap) || cap < 1)) {
    fail("SELECTOR_ARGUMENTS_INVALID");
  }
  const root = await realpath(resolve(outputRoot)).catch(() => fail("SELECTOR_OUTPUT_MISSING"));
  const files = await collectFiles(root);
  if ([...files.keys()].some((name) => name.endsWith(".map"))) fail("SELECTOR_SOURCE_MAP_FORBIDDEN");

  // The selector contract owns the home island only. Other routes can ship
  // independently audited islands (for example the material atlas).
  const islands = [];
  const selectorHtmlBytes = await readFile(files.get("index.html")?.path).catch(() => fail("SELECTOR_OUTPUT_INVALID"));
  const indexHtmlBytes = selectorHtmlBytes.byteLength;
  if (indexHtmlBytes > maxIndexHtmlBytes) fail("SELECTOR_INDEX_HTML_BUDGET_EXCEEDED", { indexHtmlBytes, maxIndexHtmlBytes });
  const selectorHtml = selectorHtmlBytes.toString("utf8");
  for (const match of selectorHtml.matchAll(/<astro-island\b[^>]*>/gi)) islands.push({ name: "index.html", attributes: attributes(match[0]) });
  if (islands.length !== 1 || islands[0].name !== "index.html") fail("SELECTOR_ISLAND_COUNT_INVALID", { islandCount: islands.length });
  const island = islands[0];
  const serializedProps = island.attributes.get("props");
  if (typeof serializedProps !== "string") fail("SELECTOR_PROPS_INVALID");
  const props = parseProps(serializedProps);
  inspectPropBoundary(props, prohibitedExactPatterns);
  const runtimePageModel = validatePageModelShape(props);
  inspectPropBoundary(runtimePageModel, prohibitedExactPatterns);

  const entries = [island.attributes.get("component-url"), island.attributes.get("renderer-url")];
  if (entries.some((entry) => typeof entry !== "string" || entry === "")) fail("SELECTOR_CLIENT_REFERENCE_INVALID");
  const selectorEntry = fileForPublicUrl(entries[0], base, files).candidate;
  if (!selectorEntry.endsWith(".js") && !selectorEntry.endsWith(".mjs")) fail("SELECTOR_CLIENT_REFERENCE_INVALID");
  const selectorEntryJavaScriptBytes = files.get(selectorEntry).size;
  if (selectorEntryJavaScriptBytes > maxSelectorEntryJavaScriptBytes) {
    fail("SELECTOR_ENTRY_JAVASCRIPT_BUDGET_EXCEEDED", { selectorEntryJavaScriptBytes, maxSelectorEntryJavaScriptBytes });
  }
  const pending = [selectorEntry, fileForPublicUrl(entries[1], base, files).candidate];
  const homeHtml = selectorHtml;
  let inlineScriptCount = 0;
  let inlineScriptGzipBytes = 0;
  for (const match of homeHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const scriptAttributes = attributes(`<script ${match[1]}>`);
    const source = match[2];
    const sourceUrl = scriptAttributes.get("src");
    if (sourceUrl !== undefined) {
      if (source.trim() !== "") fail("SELECTOR_CLIENT_REFERENCE_INVALID");
      pending.push(fileForPublicUrl(sourceUrl, base, files).candidate);
      continue;
    }
    inlineScriptCount += 1;
    if (PROHIBITED_CLIENT_TEXT.some((pattern) => pattern.test(source))) fail("SELECTOR_CLIENT_IMPORT_FORBIDDEN");
    if (FETCH_PATTERN.test(source)) fail("SELECTOR_RUNTIME_FETCH_FORBIDDEN");
    if (prohibitedExactPatterns.some((pattern) => pattern !== "" && source.includes(pattern))) fail("SELECTOR_PRIVATE_PATTERN_FORBIDDEN");
    if (importedSpecifiers(source).length > 0) fail("SELECTOR_CLIENT_REFERENCE_INVALID");
    inlineScriptGzipBytes += gzipSync(Buffer.from(source), { level: 9, mtime: 0 }).byteLength;
  }
  const visited = new Set();
  let javascriptGzipBytes = 0;
  while (pending.length > 0) {
    const name = pending.pop();
    if (visited.has(name)) continue;
    visited.add(name);
    if (!name.endsWith(".js") && !name.endsWith(".mjs")) fail("SELECTOR_CLIENT_REFERENCE_INVALID");
    const bytes = await readFile(files.get(name).path).catch(() => fail("SELECTOR_CLIENT_REFERENCE_INVALID"));
    const source = bytes.toString("utf8");
    if (PROHIBITED_CLIENT_TEXT.some((pattern) => pattern.test(source))) fail("SELECTOR_CLIENT_IMPORT_FORBIDDEN");
    if (FETCH_PATTERN.test(source)) fail("SELECTOR_RUNTIME_FETCH_FORBIDDEN");
    if (prohibitedExactPatterns.some((pattern) => pattern !== "" && source.includes(pattern))) fail("SELECTOR_PRIVATE_PATTERN_FORBIDDEN");
    javascriptGzipBytes += gzipSync(bytes, { level: 9, mtime: 0 }).byteLength;
    for (const specifier of importedSpecifiers(source)) pending.push(resolveImport(specifier, name, files));
  }
  const propsGzipBytes = gzipSync(Buffer.from(serializedProps), { level: 9, mtime: 0 }).byteLength;
  const totalGzipBytes = javascriptGzipBytes + inlineScriptGzipBytes + propsGzipBytes;
  if (totalGzipBytes > maxGzipBytes) fail("SELECTOR_PAYLOAD_BUDGET_EXCEEDED", { totalGzipBytes, maxGzipBytes });
  const availableHrefCount = await validateRoutes({ pageModel: runtimePageModel }, base, files);
  return Object.freeze({
    islandCount: 1,
    inlineScriptCount,
    reachableJavaScriptCount: visited.size,
    availableHrefCount,
    javascriptGzipBytes,
    inlineScriptGzipBytes,
    propsGzipBytes,
    totalGzipBytes,
    maxGzipBytes,
    indexHtmlBytes,
    maxIndexHtmlBytes,
    selectorEntryJavaScriptBytes,
    maxSelectorEntryJavaScriptBytes,
  });
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || !["--output", "--base"].includes(flag) || Object.hasOwn(values, flag)) fail("SELECTOR_ARGUMENTS_INVALID");
    values[flag] = value;
  }
  if (Object.keys(values).length !== 2) fail("SELECTOR_ARGUMENTS_INVALID");
  return values;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const report = await verifySelectorBuild({ outputRoot: resolve(PROJECT_ROOT, args["--output"]), base: args["--base"] });
  process.stdout.write(`${JSON.stringify({ ok: true, ...report })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const safe = error instanceof SelectorBuildError ? error.toJSON() : { code: "SELECTOR_VERIFICATION_FAILED" };
    process.stderr.write(`${JSON.stringify({ ok: false, ...safe })}\n`);
    process.exitCode = 1;
  });
}
