import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import playwrightTest from "@playwright/test";
import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "playwright/types/test";

import { defaultExplorerState, exploreData, type ExplorerState } from "../../src/features/data-explorer/explore.ts";
import { buildDataExplorerModel } from "../../src/features/data-explorer/model.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

type Browser = PlaywrightWorkerArgs["browser"];

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
const model = buildDataExplorerModel(loadPublicAtlas(), basePath);

function islandComponentPath(): string {
  const html = readFileSync(resolve(outputRoot, "data/index.html"), "utf8");
  const path = html.match(/<astro-island\b[^>]*\bcomponent-url="([^"]+)"/u)?.[1]?.replaceAll("&amp;", "&");
  if (path === undefined) throw new Error("DATA_EXPLORER_COMPONENT_URL_MISSING");
  return path;
}

async function openWithoutJavaScript(browser: Browser) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${basePath}data/`);
  return { context, page };
}

async function displayedMaterialNames(page: PlaywrightTestArgs["page"]): Promise<readonly string[]> {
  const table = page.getByRole("table");
  if (await table.count() > 0) {
    return table.getByRole("row").filter({ has: page.getByRole("rowheader") })
      .getByRole("rowheader").getByRole("link").allInnerTexts();
  }
  return page.getByRole("region", { name: /material records$/u }).getByRole("heading", { level: 2 }).allInnerTexts();
}

test("the SSR default and no-script fallback expose the complete identity and thermal table", async ({ browser, page }) => {
  await page.goto(`${basePath}data/`);
  await expect(page.getByRole("heading", { level: 1, name: "Explore every material attribute" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(1);
  await expect(page.getByRole("table")).toHaveAccessibleName(`${model.materials.length} materials · ${model.groups[0]!.label}`);
  await expect(page.getByRole("columnheader")).toHaveCount(model.groups[0]!.fieldKeys.length + 1);
  await expect(page.getByRole("rowheader")).toHaveCount(model.materials.length);
  await expect(page.getByRole("heading", { name: "Attribute group guide" })).toBeVisible();
  const guide = page.getByRole("heading", { name: "Attribute group guide" }).locator("..");
  await expect(guide.getByRole("listitem")).toHaveCount(8);
  expect((await guide.getByRole("listitem").allInnerTexts()).map((text) => text.replaceAll(/\s+/gu, " ").trim()))
    .toEqual(model.groups.map((group) => `${group.label} ${group.fieldKeys.length} attributes`));

  const noScript = await openWithoutJavaScript(browser);
  await expect(noScript.page.getByText("Interactive filters require JavaScript. The complete default identity and thermal table remains available in this page.", { exact: true })).toBeVisible();
  await expect(noScript.page.getByRole("table")).toHaveCount(1);
  await expect(noScript.page.getByRole("rowheader")).toHaveCount(model.materials.length);
  await noScript.context.close();
});

test("search, every state and scope, and exact thermal metrics produce deterministic results", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`${basePath}data/`);
  const search = page.getByLabel("Search materials and visible values");
  const searchFixture = model.materials.find((material) => exploreData(model, {
    ...defaultExplorerState(model),
    query: material.name,
  }).resultCount === 1);
  if (searchFixture === undefined) throw new Error("UNIQUE_PUBLIC_SEARCH_FIXTURE_MISSING");
  await search.fill(searchFixture.name);
  await expect(page.getByRole("status")).toContainText("1 materials shown");
  expect(await displayedMaterialNames(page)).toEqual([searchFixture.name]);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("status")).toContainText(`${model.materials.length} materials shown`);

  for (const value of ["known", "conditional", "unknown", "missing", "not-applicable"]) {
    const expected = exploreData(model, { ...defaultExplorerState(model), factState: value } as ExplorerState);
    await page.getByLabel("Fact state").selectOption(value);
    await expect(page.getByRole("status")).toContainText(`${expected.resultCount} materials shown`);
    expect(await displayedMaterialNames(page)).toEqual(expected.materials.map(({ name }) => name));
  }
  await page.getByLabel("Fact state").selectOption("all");

  for (const value of [
    "product-specific",
    "representative-product",
    "family-guidance",
    "qualitative-heuristic",
    "starting-profile-guidance",
    "derived-selector-logic",
  ]) {
    const expected = exploreData(model, { ...defaultExplorerState(model), evidenceScope: value } as ExplorerState);
    await page.getByLabel("Evidence scope").selectOption(value);
    await expect(page.getByRole("status")).toContainText(`${expected.resultCount} materials shown`);
    expect(await displayedMaterialNames(page)).toEqual(expected.materials.map(({ name }) => name));
  }
  await page.getByLabel("Evidence scope").selectOption("all");

  for (const metric of model.thermalMetrics) {
    const expected = exploreData(model, { ...defaultExplorerState(model), thermalMetric: metric.id });
    await page.getByLabel("Exact named thermal metric").selectOption(metric.id);
    await expect(page.getByRole("status")).toContainText(`${expected.resultCount} materials shown`);
    expect(await displayedMaterialNames(page)).toEqual(expected.materials.map(({ name }) => name));
    if (expected.resultCount > 0) {
      await expect(page.getByRole("table").getByText(metric.label, { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("table").getByText(metric.methodLabel, { exact: true }).first()).toBeVisible();
    }
  }
});

test("all groups offer valid sorting while named thermal values remain unsortable", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`${basePath}data/`);
  for (const group of model.groups) {
    await page.getByRole("combobox", { name: /^Attribute group/u }).selectOption(group.key);
    const sortable = group.fieldKeys.flatMap((key) => {
      const field = model.fields.find((candidate) => candidate.key === key);
      return field !== undefined && field.sort !== "none" ? [field] : [];
    });
    expect(await page.getByLabel("Sort field").locator("option").allInnerTexts()).toEqual(sortable.map(({ label }) => label));
    for (const field of sortable) {
      await page.getByLabel("Sort field").selectOption(field.key);
      for (const direction of ["asc", "desc"] as const) {
        await page.getByRole("radio", { name: direction === "asc" ? "Ascending" : "Descending" }).check();
        const state = {
          ...defaultExplorerState(model),
          group: group.key,
          thermalMetric: "all",
          sort: { field: field.key, direction },
        } as ExplorerState;
        const expected = exploreData(model, state);
        expect(await displayedMaterialNames(page)).toEqual(expected.materials.map(({ name }) => name));
      }
    }
  }
  await page.getByRole("combobox", { name: /^Attribute group/u }).selectOption("identity-thermal");
  await expect(page.getByLabel("Sort field").locator('option[value="thermal-value"]')).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Named thermal value" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Named thermal value/u })).toHaveCount(0);
});

test("table and record views retain identical row membership, values, and evidence actions", async ({ page }) => {
  await page.goto(`${basePath}data/`);
  await page.getByRole("combobox", { name: /^Attribute group/u }).selectOption("print-process");
  const expected = exploreData(model, {
    ...defaultExplorerState(model),
    group: "print-process",
    sort: { field: "print-difficulty", direction: "asc" },
  });
  expect(await displayedMaterialNames(page)).toEqual(expected.materials.map(({ name }) => name));
  const tableText = (await page.getByRole("table").innerText()).replaceAll(/\s+/gu, " ").trim();
  const evidence = page.getByRole("table").getByRole("group", { name: /evidence action/u }).first();
  if (await evidence.count() > 0) {
    await evidence.click();
    const link = evidence.getByRole("link").first();
    await expect(link).toHaveAttribute("href", new RegExp(`^${basePath.replaceAll("/", "\\/")}(materials|method)/`, "u"));
  }

  await page.getByRole("radio", { name: "Material records" }).check();
  await expect(page.getByRole("region", { name: `${expected.group.label} material records` })).toBeVisible();
  expect(await displayedMaterialNames(page)).toEqual(expected.materials.map(({ name }) => name));
  const recordsText = (await page.getByRole("region", { name: /material records$/u }).innerText()).replaceAll(/\s+/gu, " ").trim();
  for (const field of expected.fields) {
    expect(tableText).toContain(field.label);
    expect(recordsText).toContain(field.label);
  }
  for (const material of expected.materials) {
    expect(tableText).toContain(material.name);
    expect(recordsText).toContain(material.name);
  }
});

test("zero results, clear, active summary, local overflow, and invalid-state reset remain usable", async ({ page }) => {
  await page.goto(`${basePath}data/`);
  const search = page.getByLabel("Search materials and visible values");
  await search.fill("no-public-material-matches-this-query");
  await expect(page.getByRole("heading", { name: "No materials match" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("0 materials shown");
  await expect(page.getByRole("heading", { name: "Current data view" }).locator("..")).toContainText("Identity and thermal behavior");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("table")).toBeVisible();

  const overflow = page.getByRole("region", { name: /data table; scroll horizontally/u });
  const geometry = await overflow.evaluate((element: HTMLElement) => ({
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    localOverflow: element.scrollWidth - element.clientWidth,
  }));
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
  expect(geometry.localOverflow).toBeGreaterThan(0);

  await page.getByRole("combobox", { name: /^Attribute group/u }).evaluate((select: HTMLSelectElement) => {
    const option = document.createElement("option");
    option.value = "invalid-group";
    option.textContent = "Invalid group";
    select.append(option);
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const alert = page.getByRole("alert");
  await expect(alert.getByRole("heading", { name: "Data view reset" })).toBeVisible();
  await expect(alert).toContainText("No previous rows are shown.");
  await alert.getByRole("button", { name: "Reset explorer" }).click();
  await expect(page.getByRole("table")).toBeVisible();
});

test("an aborted island chunk leaves truthful static orientation without a stale interactive claim", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const componentPath = islandComponentPath();
  let componentAborted = false;
  await page.route(
    `**/${componentPath.split("/").at(-1)}`,
    (route: { abort(code?: string): Promise<void> }) => {
      componentAborted = true;
      return route.abort("blockedbyclient");
    },
  );
  await page.goto(`${basePath}data/`);
  await expect(page.getByRole("heading", { level: 1, name: "Explore every material attribute" })).toBeVisible();
  await expect(page.getByText("Named thermal tests are not directly interchangeable.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Read sources, definitions, and methodology" })).toHaveAttribute("href", `${basePath}method/`);
  await expect(page.getByRole("table")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("table")).toHaveCount(1);
  expect(componentAborted).toBe(true);
  await expect(page.getByRole("status")).toContainText(`${model.materials.length} materials`);
  await context.close();
});
