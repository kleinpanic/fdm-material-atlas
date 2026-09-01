import { existsSync } from "node:fs";
import { resolve } from "node:path";

import playwrightTest from "@playwright/test";
import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "playwright/types/test";

import { decodeSelectorClientModel } from "../../src/features/selector/client-model.ts";
import { buildSelectorPageModel } from "../../src/features/selector/page-model.ts";
import { compileMapProjection } from "../../src/features/map/projection.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import { PUBLIC_ROUTE_REGISTRY } from "../../src/lib/public-route-registry.ts";

const test = playwrightTest as unknown as TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;
// Astro check currently resolves only the default runtime export for this ESM package.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const expect = (playwrightTest as unknown as { expect: (...args: any[]) => any }).expect;

const mode = process.env.ATLAS_TEST_MODE;
if (mode !== "root" && mode !== "repository") throw new Error("ATLAS_TEST_MODE_INVALID");
const basePath = mode === "root" ? "/" : "/atlas-preview/";
const outputRoot = resolve(`dist-test/${mode}`);
const atlas = loadPublicAtlas();
const projection = compileMapProjection(atlas, basePath);
const selectorModel = decodeSelectorClientModel(
  buildSelectorPageModel(atlas, basePath, PUBLIC_ROUTE_REGISTRY),
);

function mapPath(fragment = ""): string {
  return `${basePath}map/${fragment}`;
}

function outputPath(href: string): string {
  const withoutBase = href.slice(basePath.length).split("#", 1)[0]!;
  return resolve(outputRoot, withoutBase.endsWith("/") ? `${withoutBase}index.html` : withoutBase);
}

function denyPrivateRuntimeRequests(page: PlaywrightTestArgs["page"]): string[] {
  const blocked: string[] = [];
  page.route("**/*", async (route: {
    request(): { url(): string };
    abort(errorCode?: string): Promise<void>;
    continue(): Promise<void>;
  }) => {
    const url = new URL(route.request().url());
    const logical = url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) : url.pathname;
    const sensitive = /(?:^|\/)(?:data|source|sources|trusted|credential|credentials|private)(?:\/|$)|\.json(?:$|\?)/iu.test(logical);
    if (sensitive) {
      blocked.push("blocked-private-runtime-request");
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  return blocked;
}

async function openMap(page: PlaywrightTestArgs["page"]): Promise<void> {
  await page.goto(mapPath());
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Trace material choices through properties and process gates",
  );
  await page.locator(".map-explorer").scrollIntoViewIfNeeded();
  await expect(page.getByText("Interactive map controls are ready.", { exact: true })).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
}

async function exposeEverySelectorResult(page: PlaywrightTestArgs["page"]): Promise<void> {
  await page.goto(basePath);
  await expect(page.getByRole("button", { name: "View recommendations" })).toBeEnabled();
  await page.getByRole("radio", { name: "High heat or sustained load" }).check();
  await page.getByLabel("Maximum print difficulty").selectOption("option-difficulty-expert");
  await page.getByLabel("Enclosure capability").selectOption("option-enclosure-available");
  await page.getByLabel("Wear-resistant nozzle capability").selectOption("option-hardened-nozzle-available");
  await page.getByLabel("Dryer or drybox capability").selectOption("option-dryer-available");
  await page.getByLabel("Cooling-shrink tolerance").selectOption("option-shrink-any");
  await page.getByLabel("Ventilation capability").selectOption("option-ventilation-engineered");
  await page.getByRole("button", { name: "Show all 23 compatible materials" }).click();
}

test("selector exposes every exact lane handoff and all four-stage paths retain canonical parity", async ({ page }) => {
  const blocked = denyPrivateRuntimeRequests(page);
  await exposeEverySelectorResult(page);
  const expectedActions = selectorModel.routes.materials.flatMap(({ decisionMaps }) =>
    decisionMaps.flatMap(({ action }) => action.kind === "link" ? [action] : []));
  for (const lane of projection.lanes) {
    const action = expectedActions.find(({ href }) => href === lane.href);
    expect(action).toBeDefined();
    const handoff = page.getByRole("link", { name: action!.label, exact: true }).first();
    await expect(handoff).toHaveAttribute("href", lane.href);
  }
  for (const lane of projection.lanes) {
    await page.goto(lane.href);
    await expect(page).toHaveURL(new RegExp(`${lane.href.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u"));
    await expect(page.locator(":target")).toHaveAttribute("data-lane-id", lane.id);
  }

  await openMap(page);
  await expect(page.getByRole("navigation", { name: "Decision lane index" }).getByRole("listitem")).toHaveCount(8);
  for (const lane of projection.lanes) {
    const path = page.locator(`[data-lane-id="${lane.id}"][data-decision-lane="true"]`);
    await expect(path.getByRole("heading", { level: 3, name: lane.label })).toBeVisible();
    await expect(path.locator("[data-decision-stage]")).toHaveCount(4);
    await expect(path.locator("[data-candidate-control]")).toHaveCount(lane.candidates.length);
    for (const candidate of lane.candidates) {
      await expect(path.locator(`a[href="${candidate.href}"]`).filter({ hasText: "Open material reference" })).toHaveCount(1);
      expect(existsSync(outputPath(candidate.href))).toBe(true);
    }
    for (const gate of lane.processGates) await expect(path.getByRole("link", { name: gate.label, exact: true })).toHaveAttribute("href", gate.href);
  }
  expect(blocked).toEqual([]);
});

test("decision controls preserve keyboard, pointer, hover, clear, and touch parity", async ({ browser, page }) => {
  await openMap(page);
  const lane = projection.lanes[0]!;
  const laneControl = page.getByRole("button", { name: `Highlight ${lane.label}` });
  await laneControl.focus();
  await laneControl.press("Enter");
  await expect(laneControl).toHaveAttribute("aria-pressed", "true");
  const candidate = lane.candidates[0]!;
  const candidateControl = page.getByRole("button", { name: new RegExp(`^Highlight ${candidate.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")} in`, "u") });
  await candidateControl.hover();
  await expect(page.getByText("Selected", { exact: true }).first()).toBeVisible();
  await candidateControl.click();
  await expect(candidateControl).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Clear lane highlight" }).click();
  await expect(laneControl).toHaveAttribute("aria-pressed", "false");

  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const touchPage = await context.newPage();
  await touchPage.goto(mapPath());
  await touchPage.locator(".map-explorer").scrollIntoViewIfNeeded();
  await expect(touchPage.getByText("Interactive map controls are ready.", { exact: true })).toBeVisible();
  const touchLane = touchPage.getByRole("button", { name: `Highlight ${lane.label}` });
  await touchLane.tap();
  await expect(touchLane).toHaveAttribute("aria-pressed", "true");
  await context.close();
});

test("thermal views keep service guidance separate from exact named groups", async ({ page }) => {
  await openMap(page);
  await expect(page.getByRole("row", { name: /Practical service guidance/u })).toHaveCount(projection.serviceGuidance.records.length);
  const firstService = projection.serviceGuidance.records[0]!;
  const serviceControl = page.locator(`[data-service-control][data-material-id="${firstService.material.id}"]`);
  await serviceControl.click();
  await expect(page.getByRole("heading", { name: firstService.material.name, exact: true })).toBeVisible();
  const search = page.getByLabel("Find a material in this thermal view");
  await search.fill(firstService.material.name);
  await expect(search).toBeFocused();
  await expect(page.locator("[data-service-row]")).toHaveCount(projection.serviceGuidance.records.length);
  await page.getByLabel("Service guidance order").selectOption("low-endpoint");
  await page.getByRole("radio", { name: "Named thermal observations" }).check();
  await expect(page.getByRole("heading", { name: "Choose a named metric and method group to inspect its records." })).toBeVisible();
  for (const group of projection.thermalGroups) {
    await page.getByLabel("Named metric and method group", { exact: true }).selectOption(group.id);
    await expect(page.getByText(`${group.members.length} observations in this exact group;`, { exact: false })).toBeVisible();
    await expect(page.locator("[data-named-row]")).toHaveCount(projection.serviceGuidance.records.length);
  }
  await expect(page.getByRole("link", { name: "Review method and thermal definitions" }).last()).toHaveAttribute("href", projection.methodHref);
});

test("process gates retain all 64 direct relationships and selected context", async ({ page }) => {
  await openMap(page);
  const lane = projection.processGates.lanes[0]!;
  const gate = projection.processGates.gates[0]!;
  await expect(page.locator("[data-gate-row]")).toHaveCount(8);
  await expect(page.locator("[data-gate-cell]")).toHaveCount(64);
  await expect(page.locator("[data-stacked-relationship]")).toHaveCount(64);
  await page.getByLabel("Highlight a decision lane").selectOption(lane.id);
  await expect(page.getByText("Selected decision lane", { exact: true }).last()).toBeVisible();
  await page.getByLabel("Highlight a process gate").selectOption(gate.id);
  await expect(page.getByText("Selected process gate", { exact: true })).toBeVisible();
  const cell = page.getByRole("button", { name: new RegExp(`${gate.label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}.*Highlight this process gate`, "u") }).first();
  await cell.click({ force: true });
  await expect(cell).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Clear gate highlight" }).click();
  await expect(page.getByLabel("Highlight a process gate")).toHaveValue("");
});

test("impact and flexibility filters preserve all records, selected-outside state, and a zero-result view", async ({ page }) => {
  await openMap(page);
  await expect(page.locator("[data-impact-cell]")).toHaveCount(20);
  await expect(page.locator("[data-impact-row]")).toHaveCount(projection.impactFlex.records.length);
  const expert = projection.impactFlex.records.find(({ printDifficulty }) => printDifficulty === "expert");
  if (expert === undefined) throw new Error("MAP_EXPERT_RECORD_MISSING");
  const materialControl = page.getByRole("button", { name: new RegExp(`^Highlight ${expert.material.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\.`, "u") }).last();
  await materialControl.click();
  await page.getByLabel("Maximum print difficulty").last().selectOption("easy");
  await expect(page.getByText("Selected record is outside the current diagram filter.", { exact: true })).toBeVisible();
  await page.getByLabel("Encode print difficulty with mark shape").check();
  for (const term of projection.impactFlex.difficultyTerms) await expect(page.getByLabel("Impact-flex mark legend").getByText(term.label, { exact: true })).toBeVisible();
  const search = page.getByLabel("Find a material in the impact-flex view");
  await search.fill("no material has this controlled browser query");
  await expect(page.getByText(new RegExp(`0 plotted; ${projection.impactFlex.records.length} filtered from the diagram`, "u"))).toBeVisible();
  await expect(page.locator("[data-impact-row]")).toHaveCount(projection.impactFlex.records.length);
  await page.getByRole("button", { name: "Clear property-space filters" }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByLabel("Maximum print difficulty").last()).toHaveValue("");
});
