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

type Page = PlaywrightTestArgs["page"];

import { buildSelectorPageModel } from "../../src/features/selector/page-model.ts";
import { decodeSelectorClientModel, encodeSelectorClientModel } from "../../src/features/selector/client-model.ts";
import { selectProjectedMaterials } from "../../src/domain/selector/index.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import { PUBLIC_ROUTE_REGISTRY } from "../../src/lib/public-route-registry.ts";

const test = playwrightTest as unknown as TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const expect = (playwrightTest as unknown as { expect: (...args: any[]) => any }).expect;
const AxeBuilder = AxeBuilderImport as unknown as new (options: { page: Page }) => {
  withTags(tags: string[]): { analyze(): Promise<{ violations: unknown[]; incomplete: unknown[] }> };
};

const mode = process.env.ATLAS_TEST_MODE;
if (mode !== "root" && mode !== "repository") throw new Error("ATLAS_TEST_MODE_INVALID");
const basePath = mode === "root" ? "/" : "/atlas-preview/";
const outputRoot = resolve(`dist-test/${mode}`);
const canonicalPageModel = decodeSelectorClientModel(
  buildSelectorPageModel(loadPublicAtlas(), basePath, PUBLIC_ROUTE_REGISTRY),
);

function noCompatiblePageModel() {
  const model = structuredClone(canonicalPageModel);
  for (const material of model.projection.materials) {
    const field = material.fields.find((candidate) => candidate.field === "process.printDifficulty.order");
    if (!field) throw new Error("SYNTHETIC_DIFFICULTY_FIELD_MISSING");
    Object.assign(field, { state: "resolved", value: 3 });
  }
  const outcome = selectProjectedMaterials(model.projection, model.defaults);
  if (outcome.kind !== "no-compatible") throw new Error("SYNTHETIC_NO_COMPATIBLE_INVALID");
  return encodeSelectorClientModel(model);
}

function emittedModuleUrls(): { componentUrl: string; preactUrl: string } {
  const html = readFileSync(resolve(outputRoot, "index.html"), "utf8");
  const componentPath = html.match(/<astro-island\b[^>]*\bcomponent-url="([^"]+)"/u)?.[1]?.replaceAll("&amp;", "&");
  if (!componentPath) throw new Error("SELECTOR_COMPONENT_URL_MISSING");
  const logicalPath = componentPath.startsWith(basePath) ? componentPath.slice(basePath.length) : componentPath.replace(/^\//u, "");
  const source = readFileSync(resolve(outputRoot, logicalPath), "utf8");
  const preactFile = source.match(/from"\.\/(preact\.module\.[^"]+\.js)"/u)?.[1];
  if (!preactFile) throw new Error("PREACT_MODULE_URL_MISSING");
  return {
    componentUrl: componentPath,
    preactUrl: `${basePath}_astro/${preactFile}`,
  };
}

async function waitForSelector(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.getByRole("button", { name: "View recommendations" })).toBeEnabled();
}

async function axePasses(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  expect(result.incomplete).toEqual([]);
}

function colorChannel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(value: string): number {
  const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/u);
  if (!match) throw new Error("COLOR_FORMAT_INVALID");
  return 0.2126 * colorChannel(Number(match[1]))
    + 0.7152 * colorChannel(Number(match[2]))
    + 0.0722 * colorChannel(Number(match[3]));
}

function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function mountNoCompatibleState(page: Page): Promise<void> {
  const modules = emittedModuleUrls();
  const model = noCompatiblePageModel();
  await page.evaluate(async ({ componentUrl, preactUrl, pageModel }: {
    componentUrl: string;
    preactUrl: string;
    pageModel: ReturnType<typeof noCompatiblePageModel>;
  }) => {
    const island = document.querySelector("astro-island");
    const host = document.createElement("div");
    island?.replaceWith(host);
    const component = await import(componentUrl) as { SelectorIsland: (props: unknown) => unknown };
    const preact = await import(preactUrl) as {
      a: (component: unknown, props: unknown) => unknown;
      n: (node: unknown, parent: Element) => void;
    };
    preact.n(preact.a(component.SelectorIsland, { pageModel }), host);
  }, { ...modules, pageModel: model });
  await expect(page.getByRole("heading", { name: "No materials match every selected constraint" })).toBeVisible();
}

test("selector keyboard flow preserves focus and uses one aggregate polite status", async ({ page }) => {
  await waitForSelector(page);
  const firstGoal = page.getByRole("radio", { name: "Easy prototypes" });
  await firstGoal.focus();
  await expect(firstGoal).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const outdoor = page.getByRole("radio", { name: "Outdoor and UV exposure" });
  await expect(outdoor).toBeChecked();
  await expect(outdoor).toBeFocused();

  const secondarySummary = page.locator("details.selector-secondary > summary");
  await expect(page.locator("details.selector-secondary")).toHaveAttribute("open", "");
  await secondarySummary.focus();
  const select = page.getByLabel("Maximum print difficulty");
  await select.focus();
  await select.selectOption("option-difficulty-advanced");
  await expect(select).toBeFocused();
  await expect(page.locator("[role=status]")).toHaveCount(1);
  await expect(page.locator("[role=status]")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("[role=status]")).toHaveAttribute("aria-atomic", "true");
  await expect(page.locator("[role=status]")).toContainText(/compatible materials; \d+ eliminated\./u);
  await expect(page.locator(".selector-compatible-list[aria-live], .selector-compatible-list [aria-live]")).toHaveCount(0);

  await secondarySummary.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(select).not.toBeFocused();
  await page.getByRole("button", { name: "View recommendations" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Compatible materials" })).toBeFocused();
  const outline = await page.getByRole("heading", { name: "Compatible materials" })
    .evaluate((element: Element) => getComputedStyle(element).outlineWidth);
  expect(outline).toBe("3px");
});

test("selector reflows at 320px and 200 percent zoom with 44px actions in DOM order", async ({ page }) => {
  for (const state of [
    { width: 320, zoom: "100%" },
    { width: 640, zoom: "200%" },
  ]) {
    await page.setViewportSize({ width: state.width, height: 900 });
    await waitForSelector(page);
    await page.evaluate((zoom: string) => { document.documentElement.style.zoom = zoom; }, state.zoom);
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      orderValues: [...document.querySelectorAll<HTMLElement>(".selector-island form, .selector-island [role=status], .selector-island .selector-results")]
        .map((element) => getComputedStyle(element).order),
      nowrap: [...document.querySelectorAll<HTMLElement>(".selector-goal span")]
        .some((element) => getComputedStyle(element).whiteSpace === "nowrap"),
    }));
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.orderValues.every((value: string) => value === "0")).toBe(true);
    expect(layout.nowrap).toBe(false);

    const targets = page.locator(".selector-controls label.selector-goal, .selector-controls summary, .selector-controls select, .selector-controls button, .selector-results button, .selector-results summary");
    const boxes = await targets.evaluateAll((elements: Element[]) => elements.map((element: Element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height, visible: rect.width > 0 && rect.height > 0 };
    }).filter(({ visible }: { visible: boolean }) => visible));
    expect(boxes.length).toBeGreaterThan(0);
    boxes.forEach(({ width, height }: { width: number; height: number }) => {
      expect(width).toBeGreaterThanOrEqual(44);
      expect(height).toBeGreaterThanOrEqual(44);
    });
  }
});

test("wide layout keeps controls narrow, results broad, and native radio glyphs compact", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForSelector(page);

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`MISSING_LAYOUT_ELEMENT:${selector}`);
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    };
    return {
      controls: rect(".selector-controls"),
      status: rect('.selector-island > [role="status"]'),
      results: rect(".selector-results"),
      goal: rect(".selector-goal"),
      radio: rect('.selector-goal input[type="radio"]'),
    };
  });

  expect(geometry.controls.width).toBeLessThanOrEqual(400);
  expect(geometry.results.left).toBeGreaterThan(geometry.controls.left + geometry.controls.width);
  expect(Math.abs(geometry.results.left - geometry.status.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.results.width - geometry.status.width)).toBeLessThanOrEqual(1);
  expect(geometry.results.width).toBeGreaterThan(geometry.controls.width);
  expect(geometry.results.top).toBeGreaterThanOrEqual(geometry.status.top + geometry.status.height);
  expect(geometry.goal.height).toBeGreaterThanOrEqual(44);
  expect(geometry.radio.width).toBeLessThanOrEqual(24);
  expect(geometry.radio.height).toBeLessThanOrEqual(24);
});

test("reduced motion and forced colors retain text, borders, shapes, and focus meaning", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await waitForSelector(page);
  await page.locator("details.selector-eliminated > summary").click();
  const addButton = page.getByRole("button", { name: /^Add .+ to shortlist$/u }).first();
  const addName = (await addButton.textContent())!.trim();
  const materialName = addName.replace(/^Add /u, "").replace(/ to shortlist$/u, "");
  await addButton.click();
  await expect(page.getByRole("heading", { name: "Shortlist" })).toBeVisible();
  await expect(page.locator(".selector-shortlist").getByRole("button", {
    name: `Remove ${materialName} from shortlist`,
    exact: true,
  })).toBeVisible();
  await expect(page.getByText("Compatible with selected constraints", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Blocked by selected constraint", { exact: true }).first()).toBeVisible();
  const indeterminate = page.getByText("Cannot verify — treated as incompatible", { exact: true });
  if (await indeterminate.count() > 0) await expect(indeterminate.first()).toBeVisible();
  const transitions = await page.locator(".selector-goal").first().evaluate((element: Element) =>
    getComputedStyle(element).transitionDuration.split(",").map((value) => Number.parseFloat(value) || 0));
  expect(Math.max(...transitions)).toBeLessThanOrEqual(0.001);
  const selectedBorder = await page.locator(".selector-goal:has(input:checked)").evaluate((element: Element) => getComputedStyle(element).borderLeftStyle);
  expect(selectedBorder).not.toBe("none");
  await page.getByRole("button", { name: "View recommendations" }).focus();
  await page.keyboard.press("Enter");
  expect(await page.getByRole("heading", { name: "Compatible materials" }).evaluate((element: Element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
  const routeContrast = await page.getByRole("link", { name: "View material details" }).first()
    .evaluate((element: Element) => {
      const style = getComputedStyle(element);
      const background = getComputedStyle(document.body).backgroundColor;
      return { foreground: style.color, background };
    });
  expect(contrast(routeContrast.foreground, routeContrast.background)).toBeGreaterThanOrEqual(4.5);
});

test("axe passes default, changed, elimination, shortlist, and no-compatible states", async ({ page }) => {
  test.setTimeout(90_000);
  await waitForSelector(page);
  await axePasses(page);
  await page.getByRole("radio", { name: "Outdoor and UV exposure" }).check();
  await axePasses(page);
  await page.locator("details.selector-eliminated > summary").click();
  await axePasses(page);
  await page.getByRole("button", { name: /^Add .+ to shortlist$/u }).first().click();
  await axePasses(page);
  await mountNoCompatibleState(page);
  await axePasses(page);
  await expect(page.locator("details.selector-eliminated")).toHaveAttribute("open", "");
  await expect(page.getByText("Your selections have not changed.", { exact: false })).toBeVisible();
  const values = await page.locator(".selector-no-compatible dd").allInnerTexts();
  expect(values).toHaveLength(7);
  await page.getByRole("button", { name: "Review printer and process constraints" }).click();
  await expect(page.locator("details.selector-secondary > summary")).toBeFocused();
});
