#!/usr/bin/env node

import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { dirname, extname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { HtmlValidate, Parser } from "html-validate/node";

import { loadPublicationPolicy } from "./lib/publication-policy.mjs";
import { scanPublication } from "./scan-publication.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ORIGIN = "https://atlas.example";
const DEFAULT_MODES = Object.freeze([
  { name: "root", base: "/", output: resolve(PROJECT_ROOT, "dist-test/root") },
  {
    name: "repository",
    base: "/atlas-preview/",
    output: resolve(PROJECT_ROOT, "dist-test/repository"),
  },
]);
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const BASE_PATTERN = /^\/(?:[A-Za-z0-9._~-]+\/)*$/u;
const MODE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;
const DANGEROUS_PATH_PATTERN = /(?:^|\/)(?:(?:\.|%2e){2})(?:\/|%2f|%5c|\\|$)/iu;
const SOURCE_MAP_PATTERN = /(?:^|\.)map$/iu;
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs"]);
const STYLE_EXTENSIONS = new Set([".css"]);
const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ".mp3", ".mp4", ".ogg", ".ogv", ".webm"]);
const CSS_ASSET_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ".eot",
  ".otf",
  ".ttf",
  ".woff",
  ".woff2",
]);
const HTML_VALIDATOR = new HtmlValidate({
  rules: {
    "close-order": "error",
    "no-dup-attr": "error",
    "void-content": "error",
  },
});
const HTML_PARSER_CONFIG = HTML_VALIDATOR.getConfigForSync("artifact.html");

export class ArtifactValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = "ArtifactValidationError";
    this.code = code;
  }

  toJSON() {
    return { code: this.code };
  }
}

function fail(code) {
  throw new ArtifactValidationError(code);
}

function isInside(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith("/"));
}

function assertMode(mode) {
  if (
    typeof mode !== "object" ||
    mode === null ||
    !MODE_PATTERN.test(mode.name ?? "") ||
    typeof mode.output !== "string" ||
    !BASE_PATTERN.test(mode.base ?? "") ||
    mode.base.includes("//")
  ) {
    fail("ARTIFACT_MODE_INVALID");
  }
}

async function readRegularFile(path, expected, maximumFileBytes) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const current = await handle.stat();
    if (
      !current.isFile() ||
      current.dev !== expected.dev ||
      current.ino !== expected.ino ||
      current.size !== expected.size ||
      current.mtimeMs !== expected.mtimeMs ||
      current.ctimeMs !== expected.ctimeMs
    ) {
      fail("ARTIFACT_ENTRY_CHANGED");
    }
    if (current.nlink !== 1) fail("ARTIFACT_HARDLINK_FORBIDDEN");
    if (current.size > maximumFileBytes) fail("ARTIFACT_LIMIT_EXCEEDED");
    return await handle.readFile();
  } catch (error) {
    if (error instanceof ArtifactValidationError) throw error;
    fail("ARTIFACT_READ_FAILED");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function collectArtifact(root, { maximumFileBytes, maximumFiles, maximumTotalBytes }) {
  const absolute = resolve(root);
  const before = await lstat(absolute).catch(() => fail("ARTIFACT_OUTPUT_MISSING"));
  const physical = await realpath(absolute).catch(() => fail("ARTIFACT_OUTPUT_INVALID"));
  if (!before.isDirectory() || before.isSymbolicLink() || physical !== absolute) {
    fail("ARTIFACT_OUTPUT_INVALID");
  }

  const files = new Map();
  let totalBytes = 0;
  async function walk(directory) {
    const stream = await opendir(directory).catch(() => fail("ARTIFACT_OUTPUT_INVALID"));
    for await (const entry of stream) {
      const path = join(directory, entry.name);
      if (!isInside(physical, path)) fail("ARTIFACT_PATH_ESCAPE");
      const info = await lstat(path).catch(() => fail("ARTIFACT_ENTRY_CHANGED"));
      if (info.isSymbolicLink()) fail("ARTIFACT_SYMLINK_FORBIDDEN");
      if (info.isDirectory()) {
        await walk(path);
      } else if (info.isFile()) {
        if (info.nlink !== 1) fail("ARTIFACT_HARDLINK_FORBIDDEN");
        if (info.size > maximumFileBytes || files.size >= maximumFiles) {
          fail("ARTIFACT_LIMIT_EXCEEDED");
        }
        totalBytes += info.size;
        if (totalBytes > maximumTotalBytes) fail("ARTIFACT_LIMIT_EXCEEDED");
        const name = relative(physical, path).split(sep).join("/");
        if (name === "" || name.startsWith("../") || files.has(name)) {
          fail("ARTIFACT_OUTPUT_INVALID");
        }
        if (SOURCE_MAP_PATTERN.test(name)) fail("ARTIFACT_SOURCE_MAP_FORBIDDEN");
        files.set(name, { path, info });
      } else {
        fail("ARTIFACT_ENTRY_TYPE_FORBIDDEN");
      }
    }
  }
  await walk(physical);
  if (files.size === 0) fail("ARTIFACT_OUTPUT_INVALID");

  const after = await lstat(absolute).catch(() => fail("ARTIFACT_ENTRY_CHANGED"));
  if (
    !after.isDirectory() ||
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs
  ) {
    fail("ARTIFACT_ENTRY_CHANGED");
  }
  return { root: physical, files, totalBytes };
}

function routeUrl(origin, mode, name) {
  const logical = name === "index.html" ? "" : name.replace(/index\.html$/u, "");
  return new URL(posix.join(mode.base, logical), origin);
}

function assertRawPath(raw) {
  const path = raw.split(/[?#]/u, 1)[0];
  if (path.includes("\\") || /%2f|%5c/iu.test(path) || DANGEROUS_PATH_PATTERN.test(path)) {
    fail("ARTIFACT_PATH_TRAVERSAL");
  }
}

function fileForUrl(url, mode, files) {
  if (!url.pathname.startsWith(mode.base)) fail("ARTIFACT_BASE_ESCAPE");
  if (mode.base !== "/" && url.pathname.startsWith(`${mode.base}${mode.base.slice(1)}`)) {
    fail("ARTIFACT_BASE_ESCAPE");
  }
  let logical;
  try {
    logical = decodeURIComponent(url.pathname.slice(mode.base.length));
  } catch {
    fail("ARTIFACT_REFERENCE_INVALID");
  }
  if (
    logical.includes("\\") ||
    logical.startsWith("/") ||
    logical.split("/").some((part) => part === "." || part === "..")
  ) {
    fail("ARTIFACT_PATH_TRAVERSAL");
  }
  const candidate = logical === "" || logical.endsWith("/") ? `${logical}index.html` : logical;
  if (!files.has(candidate)) fail("ARTIFACT_LOCAL_TARGET_MISSING");
  return candidate;
}

function assertExtension(tag, attribute, target, kind) {
  const extension = extname(target).toLowerCase();
  let allowed;
  if (tag === "script" && attribute === "src") allowed = SCRIPT_EXTENSIONS;
  if (tag === "link" && attribute === "href" && kind === "asset") allowed = STYLE_EXTENSIONS;
  if (["img", "image"].includes(tag) && ["src", "href"].includes(attribute)) {
    allowed = IMAGE_EXTENSIONS;
  }
  if (["audio", "source", "video"].includes(tag) || attribute === "poster") {
    allowed = MEDIA_EXTENSIONS;
  }
  if (allowed && !allowed.has(extension)) fail("ARTIFACT_EXTENSION_INVALID");
}

function parseSrcset(raw) {
  return raw.split(",").map((candidate) => candidate.trim().split(/\s+/u)[0]);
}

function cssUrls(source) {
  const urls = [];
  for (const match of source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*))\s*\)/giu)) {
    urls.push((match[1] ?? match[2] ?? match[3] ?? "").trim());
  }
  return urls;
}

function resolveReference(raw, context) {
  const { attribute, currentUrl, files, kind, mode, origin, tag } = context;
  if (typeof raw !== "string" || raw === "") fail("ARTIFACT_REFERENCE_INVALID");
  assertRawPath(raw);

  let url;
  try {
    url = new URL(raw, currentUrl);
  } catch {
    fail("ARTIFACT_REFERENCE_INVALID");
  }
  if (["javascript:", "data:", "file:", "blob:"].includes(url.protocol)) {
    fail("ARTIFACT_PROTOCOL_UNSAFE");
  }
  if (url.origin !== origin) {
    if (kind === "navigation" && url.protocol === "https:") return undefined;
    if (kind === "navigation" && ["mailto:", "tel:"].includes(url.protocol)) return undefined;
    if (url.protocol !== "https:") fail("ARTIFACT_PROTOCOL_UNSAFE");
    fail("ARTIFACT_REMOTE_ASSET");
  }
  if (url.search !== "") fail("ARTIFACT_REFERENCE_INVALID");
  const target = fileForUrl(url, mode, files);
  assertExtension(tag, attribute, target, kind);
  return { target, url };
}

function idsFrom(document) {
  return new Set(document.querySelectorAll("[id]").map((element) => element.id));
}

function assertFragment(reference, documents) {
  if (!reference?.url.hash) return;
  let fragment;
  try {
    fragment = decodeURIComponent(reference.url.hash.slice(1));
  } catch {
    fail("ARTIFACT_REFERENCE_INVALID");
  }
  if (fragment === "" || !documents.get(reference.target)?.ids.has(fragment)) {
    fail("ARTIFACT_FRAGMENT_MISSING");
  }
}

function referenceKind(tag, attribute, element) {
  if (tag === "a" && attribute === "href") return "navigation";
  if (tag === "area" && attribute === "href") return "navigation";
  if (tag === "link" && attribute === "href") {
    const rel = element.getAttributeValue("rel") ?? "";
    if (rel.split(/\s+/u).includes("canonical")) return "canonical";
  }
  return "asset";
}

async function inspectMode(mode, options) {
  assertMode(mode);
  const artifact = await collectArtifact(mode.output, options);
  const documents = new Map();
  for (const [name, record] of artifact.files) {
    if (!name.endsWith(".html")) continue;
    const bytes = await readRegularFile(record.path, record.info, options.maximumFileBytes);
    const source = bytes.toString("utf8");
    const report = await HTML_VALIDATOR.validateString(source, name);
    if (!report.valid) fail("ARTIFACT_HTML_INVALID");
    let document;
    try {
      document = new Parser(HTML_PARSER_CONFIG).parseHtml(source);
    } catch {
      fail("ARTIFACT_HTML_INVALID");
    }
    documents.set(name, { document, ids: idsFrom(document), source });
  }
  if (!documents.has("index.html")) fail("ARTIFACT_ROUTE_INVENTORY_INVALID");

  let referenceCount = 0;
  for (const [name, record] of documents) {
    const currentUrl = routeUrl(options.origin, mode, name);
    const elements = record.document.querySelectorAll("*");
    for (const element of elements) {
      const tag = element.tagName;
      if (tag === "base") fail("ARTIFACT_BASE_ELEMENT_FORBIDDEN");
      const attributes = [
        ["href", element.getAttributeValue("href")],
        ["src", element.getAttributeValue("src")],
        ["poster", element.getAttributeValue("poster")],
        ["action", element.getAttributeValue("action")],
        ["formaction", element.getAttributeValue("formaction")],
        ["data", tag === "object" ? element.getAttributeValue("data") : null],
      ];
      for (const [attribute, raw] of attributes) {
        if (raw === null) continue;
        const kind = referenceKind(tag, attribute, element);
        const reference = resolveReference(raw, {
          attribute,
          currentUrl,
          files: artifact.files,
          kind,
          mode,
          origin: options.origin,
          tag,
        });
        referenceCount += 1;
        if (kind === "canonical") {
          if (!reference || reference.url.href !== currentUrl.href) {
            fail("ARTIFACT_CANONICAL_INVALID");
          }
        }
        assertFragment(reference, documents);
      }
      for (const attribute of ["srcset", "imagesrcset"]) {
        const raw = element.getAttributeValue(attribute);
        if (raw === null) continue;
        for (const candidate of parseSrcset(raw)) {
          resolveReference(candidate, {
            attribute: "src",
            currentUrl,
            files: artifact.files,
            kind: "asset",
            mode,
            origin: options.origin,
            tag: "img",
          });
          referenceCount += 1;
        }
      }
      const style = element.getAttributeValue("style");
      const embeddedCss = tag === "style" ? element.textContent : style;
      if (embeddedCss) {
        for (const raw of cssUrls(embeddedCss)) {
          const reference = resolveReference(raw, {
            attribute: "css-url",
            currentUrl,
            files: artifact.files,
            kind: "asset",
            mode,
            origin: options.origin,
            tag: "style",
          });
          if (reference && !CSS_ASSET_EXTENSIONS.has(extname(reference.target).toLowerCase())) {
            fail("ARTIFACT_EXTENSION_INVALID");
          }
          referenceCount += 1;
        }
      }
    }
  }

  for (const [name, file] of artifact.files) {
    if (!name.endsWith(".css")) continue;
    const source = (await readRegularFile(file.path, file.info, options.maximumFileBytes)).toString(
      "utf8",
    );
    const currentUrl = new URL(posix.join(mode.base, name), options.origin);
    for (const raw of cssUrls(source)) {
      const reference = resolveReference(raw, {
        attribute: "css-url",
        currentUrl,
        files: artifact.files,
        kind: "asset",
        mode,
        origin: options.origin,
        tag: "style",
      });
      if (reference && !CSS_ASSET_EXTENSIONS.has(extname(reference.target).toLowerCase())) {
        fail("ARTIFACT_EXTENSION_INVALID");
      }
      referenceCount += 1;
    }
  }

  if (options.runPublicationScan) {
    let policy;
    let report;
    try {
      policy = await loadPublicationPolicy({ root: PROJECT_ROOT });
      report = await scanPublication({
        root: PROJECT_ROOT,
        mode: "artifact",
        artifactPath: artifact.root,
        policy,
      });
    } catch {
      fail("ARTIFACT_PUBLICATION_SCAN_FAILED");
    }
    if (report.findingCount !== 0) fail("ARTIFACT_PUBLICATION_POLICY_FAILED");
  }

  return Object.freeze({
    name: mode.name,
    base: mode.base,
    fileCount: artifact.files.size,
    htmlCount: documents.size,
    referenceCount,
    totalBytes: artifact.totalBytes,
    routes: Object.freeze([...documents.keys()].sort()),
  });
}

export async function validateBuiltArtifacts({
  modes = DEFAULT_MODES,
  origin = DEFAULT_ORIGIN,
  maximumFiles = MAX_FILES,
  maximumFileBytes = MAX_FILE_BYTES,
  maximumTotalBytes = MAX_TOTAL_BYTES,
  runPublicationScan = true,
} = {}) {
  let normalizedOrigin;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
      fail("ARTIFACT_ORIGIN_INVALID");
    }
    normalizedOrigin = url.origin;
  } catch (error) {
    if (error instanceof ArtifactValidationError) throw error;
    fail("ARTIFACT_ORIGIN_INVALID");
  }
  if (
    !Array.isArray(modes) ||
    modes.length === 0 ||
    modes.length > 4 ||
    !Number.isSafeInteger(maximumFiles) ||
    maximumFiles < 1 ||
    !Number.isSafeInteger(maximumFileBytes) ||
    maximumFileBytes < 1 ||
    !Number.isSafeInteger(maximumTotalBytes) ||
    maximumTotalBytes < 1
  ) {
    fail("ARTIFACT_OPTIONS_INVALID");
  }
  const reports = [];
  for (const mode of modes) {
    reports.push(
      await inspectMode(mode, {
        maximumFileBytes,
        maximumFiles,
        maximumTotalBytes,
        origin: normalizedOrigin,
        runPublicationScan,
      }),
    );
  }
  return Object.freeze({ ok: true, modes: Object.freeze(reports) });
}

async function main() {
  try {
    const result = await validateBuiltArtifacts();
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        modes: result.modes.map(({ name, fileCount, htmlCount, referenceCount }) => ({
          name,
          fileCount,
          htmlCount,
          referenceCount,
        })),
      })}\n`,
    );
  } catch (error) {
    const code =
      error instanceof ArtifactValidationError ? error.code : "ARTIFACT_VALIDATION_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
