import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import {
  decodeSelectorClientModel,
  encodeSelectorClientModel,
} from "../../src/features/selector/client-model.ts";
import { buildSelectorPageModel } from "../../src/features/selector/page-model.ts";
import { selectProjectedMaterials } from "../../src/domain/selector/index.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import { PUBLIC_ROUTE_REGISTRY } from "../../src/lib/public-route-registry.ts";

export type ReleaseMode = "root" | "repository";

type EmittedLink = Readonly<{
  href: string;
  label: string;
}>;

export type ReleaseRoutes = Readonly<{
  mode: ReleaseMode;
  basePath: string;
  outputRoot: string;
  home: EmittedLink;
  materials: EmittedLink;
  compare: EmittedLink;
  data: EmittedLink;
  map: EmittedLink;
  method: EmittedLink;
  materialIds: readonly string[];
  representativeMaterial: EmittedLink;
  representativeProfile: EmittedLink;
  representativeLane: EmittedLink;
  assetHref: string;
}>;

const REQUIRED_ROUTES = ["", "materials/", "compare/", "data/", "map/", "method/"] as const;

function fail(code: string): never {
  throw new Error(code);
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function plainText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

function assertInsideOutput(outputRoot: string, candidate: string): void {
  const pathFromRoot = relative(outputRoot, candidate);
  if (pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..")) {
    return;
  }
  fail("RELEASE_FIXTURE_PATH_ESCAPE");
}

function readEmittedFile(outputRoot: string, logicalPath: string): string {
  const candidate = resolve(outputRoot, logicalPath);
  assertInsideOutput(outputRoot, candidate);
  const stat = lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("RELEASE_FIXTURE_FILE_UNSAFE");
  assertInsideOutput(realpathSync(outputRoot), realpathSync(candidate));
  return readFileSync(candidate, "utf8");
}

function htmlPathFromHref(basePath: string, href: string): string {
  const parsed = new URL(href, "https://atlas.invalid");
  if (parsed.origin !== "https://atlas.invalid") fail("RELEASE_FIXTURE_EXTERNAL_ROUTE");
  if (!parsed.pathname.startsWith(basePath)) fail("RELEASE_FIXTURE_BASE_ESCAPE");
  const logical = parsed.pathname.slice(basePath.length);
  if (logical.includes("..") || logical.includes("\\")) fail("RELEASE_FIXTURE_ROUTE_UNSAFE");
  return logical === "" || logical.endsWith("/") ? `${logical}index.html` : logical;
}

function readRouteHtml(outputRoot: string, basePath: string, href: string): string {
  return readEmittedFile(outputRoot, htmlPathFromHref(basePath, href));
}

function heading(html: string): string {
  const value = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/u)?.[1];
  if (value === undefined) fail("RELEASE_FIXTURE_H1_MISSING");
  return plainText(value);
}

function hrefs(html: string): EmittedLink[] {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gu)].map(
    ([, href, label]) => ({ href: decodeHtml(href!), label: plainText(label!) }),
  );
}

function materialLinks(html: string, basePath: string): EmittedLink[] {
  const prefix = `${basePath}materials/`;
  return hrefs(html).filter(({ href }, index, all) => {
    if (!href.startsWith(prefix) || href === prefix || href.includes("#")) return false;
    return all.findIndex((candidate) => candidate.href === href) === index;
  });
}

function compareIds(html: string): string[] {
  return [...html.matchAll(/<option\b[^>]*\bvalue="([^"]+)"/gu)]
    .map(([, id]) => decodeHtml(id!))
    .filter((id, index, all) => id.length > 0 && all.indexOf(id) === index);
}

function localAsset(html: string, basePath: string): string {
  const candidates = [
    ...html.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)="([^"]+\.(?:css|js))"/gu),
  ].map(([, href]) => decodeHtml(href!));
  const asset = candidates.find((href) => href.startsWith(`${basePath}_astro/`));
  if (asset === undefined) fail("RELEASE_FIXTURE_ASSET_MISSING");
  return asset;
}

function route(outputRoot: string, basePath: string, pathname: string): EmittedLink {
  const href = `${basePath}${pathname}`;
  return { href, label: heading(readRouteHtml(outputRoot, basePath, href)) };
}

export function discoverReleaseRoutes(mode: ReleaseMode): ReleaseRoutes {
  const basePath = mode === "root" ? "/" : "/atlas-preview/";
  const outputRoot = realpathSync(resolve(`dist-test/${mode}`));
  for (const pathname of REQUIRED_ROUTES) {
    readRouteHtml(outputRoot, basePath, `${basePath}${pathname}`);
  }

  const homeHtml = readRouteHtml(outputRoot, basePath, basePath);
  const atlasHtml = readRouteHtml(outputRoot, basePath, `${basePath}materials/`);
  const compareHtml = readRouteHtml(outputRoot, basePath, `${basePath}compare/`);
  const mapHtml = readRouteHtml(outputRoot, basePath, `${basePath}map/`);
  const representatives = materialLinks(atlasHtml, basePath);
  const representativeMaterial = representatives[0];
  if (representativeMaterial === undefined) fail("RELEASE_FIXTURE_MATERIAL_MISSING");
  const representativeHtml = readRouteHtml(outputRoot, basePath, representativeMaterial.href);
  const representative = {
    href: representativeMaterial.href,
    label: heading(representativeHtml),
  };

  const profile = hrefs(homeHtml).find(
    ({ href }) => href.startsWith(`${basePath}materials/`) && href.endsWith("#starting-profile"),
  );
  if (profile === undefined) fail("RELEASE_FIXTURE_PROFILE_LINK_MISSING");

  const representativeLane = hrefs(mapHtml).find(({ href }) =>
    new RegExp(
      `^${basePath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}map/#lane-[a-z0-9-]+$`,
      "u",
    ).test(href),
  );
  if (representativeLane === undefined) fail("RELEASE_FIXTURE_LANE_MISSING");

  const assetHref = localAsset(homeHtml, basePath);
  readEmittedFile(outputRoot, htmlPathFromHref(basePath, assetHref));

  return Object.freeze({
    mode,
    basePath,
    outputRoot,
    home: { href: basePath, label: heading(homeHtml) },
    materials: route(outputRoot, basePath, "materials/"),
    compare: route(outputRoot, basePath, "compare/"),
    data: route(outputRoot, basePath, "data/"),
    map: route(outputRoot, basePath, "map/"),
    method: route(outputRoot, basePath, "method/"),
    materialIds: Object.freeze(compareIds(compareHtml)),
    representativeMaterial: representative,
    representativeProfile: profile,
    representativeLane,
    assetHref,
  });
}

export function buildNoCompatibleReleaseModel(basePath: string) {
  const model = structuredClone(
    decodeSelectorClientModel(
      buildSelectorPageModel(loadPublicAtlas(), basePath, PUBLIC_ROUTE_REGISTRY),
    ),
  );
  for (const material of model.projection.materials) {
    const difficulty = material.fields.find(
      ({ field }) => field === "process.printDifficulty.order",
    );
    if (difficulty === undefined) fail("RELEASE_FIXTURE_DIFFICULTY_MISSING");
    Object.assign(difficulty, { state: "resolved", value: 3 });
  }
  const outcome = selectProjectedMaterials(model.projection, model.defaults);
  if (outcome.kind !== "no-compatible") fail("RELEASE_FIXTURE_NO_MATCH_INVALID");
  return encodeSelectorClientModel(model);
}

export function discoverSelectorModules(routes: ReleaseRoutes): Readonly<{
  componentUrl: string;
  preactUrl: string;
}> {
  const html = readRouteHtml(routes.outputRoot, routes.basePath, routes.home.href);
  const componentUrl = html
    .match(/<astro-island\b[^>]*\bcomponent-url="([^"]+)"/u)?.[1]
    ?.replaceAll("&amp;", "&");
  if (componentUrl === undefined) fail("RELEASE_FIXTURE_SELECTOR_COMPONENT_MISSING");
  const componentPath = htmlPathFromHref(routes.basePath, componentUrl);
  readEmittedFile(routes.outputRoot, componentPath);
  const preactFile = readdirSync(resolve(routes.outputRoot, "_astro")).find((entry) =>
    /^preact\.module\.[A-Za-z0-9_-]+\.js$/u.test(entry),
  );
  if (preactFile === undefined) fail("RELEASE_FIXTURE_PREACT_MODULE_MISSING");
  return Object.freeze({
    componentUrl,
    preactUrl: `${routes.basePath}_astro/${preactFile}`,
  });
}
