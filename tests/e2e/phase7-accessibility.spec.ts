import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import AxeBuilderImport from "@axe-core/playwright";
import playwrightTest from "@playwright/test";
import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "playwright/types/test";

import { buildComparisonModel } from "../../src/features/comparison/model.ts";
import { buildDataExplorerModel } from "../../src/features/data-explorer/model.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

type Page = PlaywrightTestArgs["page"];
type Browser = PlaywrightWorkerArgs["browser"];

const test = playwrightTest as unknown as TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;
// Astro check currently resolves only the default runtime export for this ESM package.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const expect = (playwrightTest as unknown as { expect: (...args: any[]) => any }).expect;
const AxeBuilder = AxeBuilderImport as unknown as new (options: { page: Page }) => {
  withTags(tags: string[]): { analyze(): Promise<{ violations: unknown[] }> };
};

const mode = process.env.ATLAS_TEST_MODE;
if (mode !== "root" && mode !== "repository") throw new Error("ATLAS_TEST_MODE_INVALID");
const basePath = mode === "root" ? "/" : "/atlas-preview/";
const outputRoot = resolve(`dist-test/${mode}`);
const atlas = loadPublicAtlas();
const comparison = buildComparisonModel(atlas, basePath);
const explorer = buildDataExplorerModel(atlas, basePath);
const ids = comparison.materials.map(({ id }) => id);

function comparePath(materialIds: readonly string[]): string {
  const query = new URLSearchParams();
  for (const id of materialIds) query.append("material", id);
  return `${basePath}compare/?${query.toString()}#comparison-matrix`;
}

async function axePasses(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

function islandComponentPath(route: "compare" | "data"): string {
  const html = readFileSync(resolve(outputRoot, route, "index.html"), "utf8");
  const path = html.match(/<astro-island\b[^>]*\bcomponent-url="([^"]+)"/u)?.[1]?.replaceAll("&amp;", "&");
  if (path === undefined) throw new Error("PHASE7_COMPONENT_URL_MISSING");
  return path;
}

async function openWithoutJavaScript(browser: Browser, route: "compare" | "data") {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${basePath}${route}/`);
  return { context, page };
}

async function assertSingleDocumentStructure(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
  await expect(page.getByRole("navigation").first()).toBeVisible();
}

test("axe passes empty, invalid, two-material, and four-material comparison states", async ({ page }) => {
  test.setTimeout(120_000);
  for (const path of [
    `${basePath}compare/`,
    `${basePath}compare/?material=${ids[0]}&material=${ids[0]}`,
    comparePath(ids.slice(0, 2)),
    comparePath(ids.slice(0, 4)),
  ]) {
    await page.goto(path);
    await expect(page.getByRole("form", { name: "Choose materials to compare" })).toBeVisible();
    await assertSingleDocumentStructure(page);
    await axePasses(page);
  }
});

test("axe passes default, zero-result, and record data explorer states", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`${basePath}data/`);
  await axePasses(page);
  await page.getByLabel("Search materials and visible values").fill("no-public-material-matches-this-query");
  await expect(page.getByRole("heading", { name: "No materials match" })).toBeVisible();
  await axePasses(page);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("radio", { name: "Material records" }).check();
  await expect(page.getByRole("region", { name: /material records$/u })).toBeVisible();
  await axePasses(page);
  await assertSingleDocumentStructure(page);
});

test("keyboard focus and aggregate status remain stable through comparison and explorer updates", async ({ page }) => {
  await page.goto(comparePath(ids.slice(0, 2)).split("#")[0]!);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  const third = page.getByLabel("Material 3 (optional)");
  await third.focus();
  await third.selectOption(ids[2]);
  await expect(third).toBeFocused();
  const update = page.getByRole("button", { name: "Update comparison" });
  await update.focus();
  await page.keyboard.press("Enter");
  await expect(update).toBeFocused();
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(page.getByRole("status")).toHaveAttribute("aria-live", "polite");
  await expect(page.getByRole("status")).toHaveAttribute("aria-atomic", "true");

  await page.goto(`${basePath}data/`);
  const group = page.getByRole("combobox", { name: /^Attribute group/u });
  await group.focus();
  await group.selectOption(explorer.groups[1]!.key);
  await expect(group).toBeFocused();
  const sort = page.getByLabel("Sort field");
  await sort.focus();
  await sort.selectOption({ index: 1 });
  await expect(sort).toBeFocused();
  const direction = page.getByRole("radio", { name: "Descending" });
  await direction.focus();
  await direction.check();
  await expect(direction).toBeFocused();
  const records = page.getByRole("radio", { name: "Material records" });
  await records.focus();
  await records.check();
  await expect(records).toBeFocused();
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(page.getByRole("status")).toHaveAttribute("aria-live", "polite");
});

test("320px and 200 percent zoom retain 44px controls, local table overflow, and reading order", async ({ page }) => {
  for (const state of [
    { width: 320, zoom: "100%" },
    { width: 640, zoom: "200%" },
  ]) {
    await page.setViewportSize({ width: state.width, height: 900 });
    await page.goto(comparePath(ids.slice(0, 4)));
    await page.evaluate((zoom: string) => { document.documentElement.style.zoom = zoom; }, state.zoom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const compareTargets = page.getByRole("form", { name: "Choose materials to compare" }).locator("select, button");
    const compareBoxes = await compareTargets.evaluateAll((elements: Element[]) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    compareBoxes.forEach(({ width, height }: { width: number; height: number }) => {
      expect(width).toBeGreaterThanOrEqual(44);
      expect(height).toBeGreaterThanOrEqual(44);
    });
    const order = await page.getByRole("definition").first().evaluateAll((elements: Element[]) => elements.map((element) => element.textContent));
    expect(order.length).toBeGreaterThan(0);

    await page.goto(`${basePath}data/`);
    await page.evaluate((zoom: string) => { document.documentElement.style.zoom = zoom; }, state.zoom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const tableRegion = page.getByRole("region", { name: /data table; scroll horizontally/u });
    await tableRegion.focus();
    await expect(tableRegion).toBeFocused();
    const geometry = await tableRegion.evaluate((element: HTMLElement) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
      outline: getComputedStyle(element).outlineStyle,
    }));
    expect(geometry.scroll).toBeGreaterThan(geometry.client);
    expect(geometry.outline).not.toBe("none");
    const controls = page.getByRole("main").locator("input, select, button");
    const boxes = await controls.evaluateAll((elements: Element[]) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }).filter(({ width, height }) => width > 0 && height > 0));
    boxes.forEach(({ width, height }: { width: number; height: number }) => {
      expect(width).toBeGreaterThanOrEqual(44);
      expect(height).toBeGreaterThanOrEqual(44);
    });
  }
});

test("long content, forced colors, reduced motion, and non-color text preserve meaning", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto(comparePath(ids.slice(0, 2)));
  await page.getByText("Difference", { exact: true }).first().evaluate((element: Element) => {
    element.textContent = `Difference ${"long-state-".repeat(80)}`;
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.getByText("Difference", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Evidence scope:", { exact: false }).first()).toBeVisible();
  const comparisonTransition = await page.getByRole("form", { name: "Choose materials to compare" }).evaluate((element: Element) =>
    getComputedStyle(element).transitionDuration.split(",").map((value) => Number.parseFloat(value) || 0));
  expect(Math.max(...comparisonTransition)).toBeLessThanOrEqual(0.001);
  await page.getByRole("button", { name: "Update comparison" }).focus();
  expect(await page.getByRole("button", { name: "Update comparison" }).evaluate((element: Element) => getComputedStyle(element).outlineStyle)).not.toBe("none");

  await page.goto(`${basePath}data/`);
  await expect(page.getByText("Evidence scope:", { exact: false }).first()).toBeVisible();
  await page.getByRole("columnheader").first().evaluate((element: Element) => {
    element.textContent = `Material ${"unbroken-public-label-".repeat(80)}`;
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const transition = await page.getByRole("button", { name: "Clear filters" }).evaluate((element: Element) =>
    getComputedStyle(element).transitionDuration.split(",").map((value) => Number.parseFloat(value) || 0));
  expect(Math.max(...transition)).toBeLessThanOrEqual(0.001);
});

test("tables expose captions and headers while decision states never rely on color alone", async ({ page }) => {
  await page.goto(`${basePath}data/`);
  const table = page.getByRole("table");
  await expect(table).toHaveAccessibleName(`${explorer.materials.length} materials · ${explorer.groups[0]!.label}`);
  await expect(table.getByRole("columnheader")).toHaveCount(explorer.groups[0]!.fieldKeys.length + 1);
  await expect(table.getByRole("rowheader")).toHaveCount(explorer.materials.length);
  await expect(page.getByText("Named thermal tests are not directly interchangeable.", { exact: true })).toBeVisible();
  await page.goto(comparePath(ids.slice(0, 2)));
  await expect(page.getByText("Difference", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^Same across selected materials/u).first()).toBeVisible();
  await expect(page.getByText("does not rank a universally better material", { exact: false }).first()).toBeVisible();
});

test("no-script and failed hydration preserve orientation, cautions, and safe onward links", async ({ browser }) => {
  for (const route of ["compare", "data"] as const) {
    const noScript = await openWithoutJavaScript(browser, route);
    await assertSingleDocumentStructure(noScript.page);
    await expect(noScript.page.getByText("Named thermal tests are not directly interchangeable.", { exact: true })).toBeVisible();
    await expect(noScript.page.getByRole("link", { name: /methodology|comparison method/u }).first()).toHaveAttribute("href", new RegExp(`^${basePath.replaceAll("/", "\\/")}method/`, "u"));
    await noScript.context.close();

    const context = await browser.newContext();
    const page = await context.newPage();
    const component = new URL(islandComponentPath(route), `http://127.0.0.1:${mode === "root" ? 4321 : 4322}`).href;
    let componentAborted = false;
    await page.route(`**/${component.split("/").at(-1)}`, (intercepted: { abort(code?: string): Promise<void> }) => {
      componentAborted = true;
      return intercepted.abort("blockedbyclient");
    });
    await page.goto(`${basePath}${route}/`);
    await assertSingleDocumentStructure(page);
    await expect(page.getByText("Named thermal tests are not directly interchangeable.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(componentAborted).toBe(true);
    await expect(page.getByRole("button", { name: route === "compare" ? "Update comparison" : "Clear filters" })).toBeVisible();
    await context.close();
  }
});
