import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import playwrightTest from "@playwright/test";
import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "playwright/types/test";

type Page = PlaywrightTestArgs["page"];
type Browser = PlaywrightWorkerArgs["browser"];
type BrowserContext = Awaited<ReturnType<Browser["newContext"]>>;

import { presentSelectorOutcome } from "../../src/features/selector/presentation.ts";
import { buildSelectorPageModel } from "../../src/features/selector/page-model.ts";
import { decodeSelectorClientModel } from "../../src/features/selector/client-model.ts";
import { selectProjectedMaterials } from "../../src/domain/selector/index.ts";
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
const pageModel = decodeSelectorClientModel(
  buildSelectorPageModel(loadPublicAtlas(), basePath, PUBLIC_ROUTE_REGISTRY),
);
const defaultOutcome = selectProjectedMaterials(pageModel.projection, pageModel.defaults);
const defaultPresentation = presentSelectorOutcome(pageModel, defaultOutcome);
if (defaultPresentation.kind !== "ranked") throw new Error("SELECTOR_DEFAULT_NOT_RANKED");

function compatibleItems(page: Page) {
  return page.locator(".selector-compatible-list > li");
}

async function waitForSelector(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.getByRole("button", { name: "View recommendations" })).toBeEnabled();
}

async function openWithoutJavaScript(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("./");
  return { context, page };
}

function selectorComponentUrl(): string {
  const html = readFileSync(resolve(outputRoot, "index.html"), "utf8");
  const match = html.match(/<astro-island\b[^>]*\bcomponent-url="([^"]+)"/u);
  if (!match?.[1]) throw new Error("SELECTOR_COMPONENT_URL_MISSING");
  return match[1].replaceAll("&amp;", "&");
}

async function openWithSelectorChunkAborted(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const componentUrl = new URL(selectorComponentUrl(), `http://127.0.0.1:${mode === "root" ? 4321 : 4322}`).href;
  await page.route(componentUrl, (route: { abort(errorCode?: string): Promise<void> }) => route.abort("blockedbyclient"));
  await page.goto("./");
  return { context, page };
}

async function displayedRanking(page: Page): Promise<readonly string[]> {
  return compatibleItems(page).evaluateAll((items: Element[]) => items.map((item: Element) => {
    const rank = item.querySelector("article > p:first-child")?.textContent?.trim() ?? "";
    const name = item.querySelector("h3")?.textContent?.trim() ?? "";
    const score = [...item.querySelectorAll("p")]
      .map((node) => node.textContent?.trim() ?? "")
      .find((text) => /^\d+ of \d+ alignment points$/u.test(text)) ?? "";
    return `${rank}|${name}|${score}`;
  }));
}

async function selectRelaxedHardware(page: Page): Promise<void> {
  await page.getByRole("radio", { name: "High heat or sustained load" }).check();
  await page.getByLabel("Maximum print difficulty").selectOption("option-difficulty-expert");
  await page.getByLabel("Enclosure capability").selectOption("option-enclosure-available");
  await page.getByLabel("Wear-resistant nozzle capability").selectOption("option-hardened-nozzle-available");
  await page.getByLabel("Dryer or drybox capability").selectOption("option-dryer-available");
  await page.getByLabel("Cooling-shrink tolerance").selectOption("option-shrink-any");
  await page.getByLabel("Ventilation capability").selectOption("option-ventilation-engineered");
  await expect(compatibleItems(page)).toHaveCount(10);
  await expect(page.getByRole("button", { name: "Show all 23 compatible materials" })).toBeVisible();
}

test("selector keeps complete default meaning without JavaScript and when only its island aborts", async ({ browser }) => {
  const noScript = await openWithoutJavaScript(browser);
  await expect(noScript.page.getByRole("heading", { level: 1 })).toHaveText("Choose a material that fits your process");
  await expect(noScript.page.locator("h1")).toHaveCount(1);
  await expect(noScript.page.getByLabel("What the score means").getByText("Alignment scores reflect only the criteria you selected.", { exact: false })).toBeVisible();
  expect(readFileSync(resolve(outputRoot, "index.html"), "utf8")).toContain(
    "Interactive filtering needs JavaScript. The published default results remain available below.",
  );
  await expect(noScript.page.getByRole("radio", { checked: true })).toHaveValue(pageModel.defaults["selector-primary-goal"]);
  for (const criterion of pageModel.projection.criteria.filter(({ role }) => role === "secondary")) {
    await expect(noScript.page.getByLabel(criterion.label)).toHaveValue(criterion.defaultOptionId);
  }
  expect(await displayedRanking(noScript.page)).toEqual(defaultPresentation.compatible.map((material) =>
    `Rank ${material.rank}|${material.materialLabel}|${material.scoreLabel}`));
  await noScript.context.close();

  const aborted = await openWithSelectorChunkAborted(browser);
  await expect(aborted.page.getByText("Interactive filtering needs JavaScript.", { exact: false })).toHaveCount(0);
  await expect(aborted.page.getByText("Selector is preparing", { exact: true })).toBeVisible();
  await expect(aborted.page.getByRole("button", { name: "View recommendations" })).toBeDisabled();
  expect(await displayedRanking(aborted.page)).toEqual(defaultPresentation.compatible.map((material) =>
    `Rank ${material.rank}|${material.materialLabel}|${material.scoreLabel}`));
  await aborted.context.close();
});

test("hydration preserves SSR ranking and controls drive transparent engine records without data requests", async ({ browser, page }) => {
  const aborted = await openWithSelectorChunkAborted(browser);
  const ssrRanking = await displayedRanking(aborted.page);
  await aborted.context.close();

  const dataRequests: string[] = [];
  page.on("request", (request: { resourceType(): string }) => {
    if (["fetch", "xhr"].includes(request.resourceType())) dataRequests.push(request.resourceType());
  });
  await waitForSelector(page);
  expect(await displayedRanking(page)).toEqual(ssrRanking);
  await expect(page.getByRole("radio", { checked: true })).toHaveValue(pageModel.defaults["selector-primary-goal"]);

  const firstExpected = defaultPresentation.compatible[0]!;
  const firstResult = compatibleItems(page).first();
  await firstResult.getByText("Why this rank").click();
  const renderedContributions = await firstResult.locator("details li").allInnerTexts();
  expect(renderedContributions).toEqual(firstExpected.contributions.map((record) =>
    `${record.pointsLabel}\n${record.criterionLabel}: ${record.optionLabel}\n${record.explanation}`));

  await expect(page.locator(".selector-compatible-count")).toHaveText(
    `${defaultPresentation.compatible.length} Compatible`,
  );
  await expect(firstResult).toHaveAttribute("data-alignment", "highest");
  await expect(firstResult.locator(".selector-family-marker")).toBeVisible();
  await expect(firstResult.locator("[data-contribution-state]")).toHaveCount(firstExpected.contributions.length);

  await expect(page.locator("details.selector-secondary")).toHaveAttribute("open", "");
  const enclosure = page.getByLabel("Enclosure capability");
  await enclosure.focus();
  await enclosure.selectOption("option-enclosure-available");
  await expect(enclosure).toBeFocused();
  await expect(firstResult.locator("details")).toHaveAttribute("open", "");
  await expect(page.locator("[role=status]")).toContainText(/compatible materials; \d+ eliminated\./u);

  const eliminated = page.locator("details.selector-eliminated");
  await eliminated.locator(":scope > summary").click();
  const currentSelection = { ...pageModel.defaults, "selector-enclosure-capability": "option-enclosure-available" };
  const currentOutcome = selectProjectedMaterials(pageModel.projection, currentSelection);
  const currentPresentation = presentSelectorOutcome(pageModel, currentOutcome);
  if (currentPresentation.kind !== "ranked") throw new Error("SELECTOR_CURRENT_NOT_RANKED");
  const expectedEliminated = currentPresentation.eliminated[0]!;
  const eliminatedItem = eliminated.locator("article").filter({ has: page.getByRole("heading", { name: expectedEliminated.materialLabel }) });
  await expect(eliminatedItem).toBeVisible();
  const renderedReasons = await eliminatedItem.locator("li").allInnerTexts();
  expect(renderedReasons.length).toBeGreaterThan(0);
  await expect(eliminated.locator(".selector-eliminated-help")).toHaveText(
    "Open to review every hard constraint that removed a material.",
  );
  await expect(eliminatedItem.locator("[data-exclusion-state]")).toHaveCount(expectedEliminated.reasons.length);
  await expect(eliminatedItem.getByText(/Rank \d+|alignment points/u)).toHaveCount(0);

  await page.getByRole("button", { name: "View recommendations" }).click();
  await expect(page.getByRole("heading", { name: "Compatible materials" })).toBeFocused();
  expect(dataRequests).toEqual([]);
  const currentFirst = currentPresentation.compatible[0]!;
  for (const action of [
    currentFirst.routes.details,
    currentFirst.routes.startingProfile,
    currentFirst.routes.methodEvidence,
    ...currentFirst.routes.decisionMaps.map(({ action }) => action),
  ]) {
    const item = page.getByText(action.label, { exact: true }).first();
    await expect(item).toBeVisible();
    if (action.kind === "link") await expect(item).toHaveAttribute("href", action.href);
    else expect(await item.evaluate((element: Element) => element.tagName)).not.toBe("A");
  }
});

test("shortlist is ordered, bounded, retained across exclusions, and returns focus deterministically", async ({ page }) => {
  await waitForSelector(page);
  await selectRelaxedHardware(page);
  await page.getByRole("button", { name: "Show all 23 compatible materials" }).click();

  const addButtons = page.getByRole("button", { name: /^Add .+ to shortlist$/u });
  const labels = await addButtons.evaluateAll((buttons: Element[]) => buttons.slice(0, 5).map((button: Element) => button.textContent?.trim() ?? ""));
  for (let index = 0; index < 4; index += 1) {
    await page.getByRole("button", { name: labels[index], exact: true }).click();
  }
  const shortlist = page.locator(".selector-shortlist");
  await expect(shortlist.locator("li")).toHaveCount(4);
  const shortlistedNames = await shortlist.locator("li > span:first-child").allInnerTexts();
  expect(shortlistedNames).toEqual(labels.slice(0, 4).map((label: string) => label.replace(/^Add /u, "").replace(/ to shortlist$/u, "")));

  await page.getByRole("button", { name: labels[4], exact: true }).click();
  await expect(shortlist.locator("li")).toHaveCount(4);
  await expect(page.locator("[role=status]")).toHaveText("Shortlist holds up to 4 materials. Remove one before adding another.");

  const firstName = shortlistedNames[0]!;
  await shortlist.getByRole("button", { name: `Remove ${firstName} from shortlist` }).click();
  await expect(page.getByRole("button", { name: `Add ${firstName} to shortlist` })).toBeFocused();

  await page.getByRole("button", { name: "Reset criteria" }).click();
  await expect(page.locator("[role=status]")).toHaveText("Selector reset to published defaults.");
  await page.waitForTimeout(400);
  await expect(page.locator("[role=status]")).toHaveText("Selector reset to published defaults.");
  await expect(shortlist.getByText("Now eliminated by current constraints").first()).toBeVisible();
  await expect(shortlist.getByRole("link", { name: "Review exclusion" }).first()).toHaveAttribute("href", /^#eliminated-material-/u);
  await shortlist.getByRole("button", { name: "Clear shortlist" }).click();
  await expect(shortlist).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Compatible materials" })).toBeFocused();
});

test("removing the final retained eliminated item focuses the mounted results heading", async ({ page }) => {
  await waitForSelector(page);
  await selectRelaxedHardware(page);
  await page.getByRole("button", { name: "Show all 23 compatible materials" }).click();

  const add = page.getByRole("button", { name: /^Add .+ to shortlist$/u }).first();
  await add.click();
  await page.getByRole("button", { name: "Reset criteria" }).click();

  const shortlist = page.locator(".selector-shortlist");
  await expect(shortlist.getByText("Now eliminated by current constraints")).toBeVisible();
  await shortlist.locator("button").filter({ hasText: "Remove" }).click();
  await expect(shortlist).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Compatible materials" })).toBeFocused();
  await expect(page.locator("body")).not.toBeFocused();
});

test("show-all preserves order and every browser resource maps to the built deployment base", async ({ page }) => {
  const badResources: string[] = [];
  page.on("response", (response: { url(): string; ok(): boolean }) => {
    const url = new URL(response.url());
    if (url.origin !== `http://127.0.0.1:${mode === "root" ? 4321 : 4322}` || !response.ok()) {
      badResources.push("remote-or-failed");
      return;
    }
    if (!url.pathname.startsWith(basePath)) badResources.push("base-path-missing");
    const logical = url.pathname.slice(basePath.length);
    const relativeFile = logical === "" || logical.endsWith("/") ? `${logical}index.html` : logical;
    if (!existsSync(resolve(outputRoot, relativeFile))) badResources.push("inventory-miss");
  });
  await waitForSelector(page);
  await selectRelaxedHardware(page);
  await page.getByRole("button", { name: "Show all 23 compatible materials" }).click();
  await expect(compatibleItems(page)).toHaveCount(23);
  await expect(page.getByText("Showing all 23 compatible materials", { exact: true })).toBeVisible();
  const ranks = await compatibleItems(page).locator("article > p:first-child").allInnerTexts();
  expect(ranks).toEqual(Array.from({ length: 23 }, (_, index) => `Rank ${index + 1}`));
  expect(badResources).toEqual([]);
});
