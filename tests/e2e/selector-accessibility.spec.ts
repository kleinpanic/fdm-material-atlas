import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import AxeBuilderImport from "@axe-core/playwright";
import playwrightTest from "@playwright/test";
import type {
  Page,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "playwright/types/test";

import { buildSelectorPageModel } from "../../src/features/selector/page-model.ts";
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
const canonicalPageModel = buildSelectorPageModel(loadPublicAtlas(), basePath, PUBLIC_ROUTE_REGISTRY);

function noCompatiblePageModel() {
  const model = structuredClone(canonicalPageModel);
  model.projection.materials = model.projection.materials.map((material) => ({
    ...material,
    fields: material.fields.map((field) => field.field === "process.printDifficulty.order"
      ? { ...field, state: "resolved" as const, value: 3 }
      : field),
  }));
  const outcome = selectProjectedMaterials(model.projection, model.defaults);
  if (outcome.kind !== "no-compatible") throw new Error("SYNTHETIC_NO_COMPATIBLE_INVALID");
  return model;
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

async function mountNoCompatibleState(page: Page): Promise<void> {
  const modules = emittedModuleUrls();
  const model = noCompatiblePageModel();
  await page.evaluate(async ({ componentUrl, preactUrl, pageModel }) => {
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

  const secondarySummary = page.getByText("Printer and process constraints", { exact: true });
  await secondarySummary.focus();
  await page.keyboard.press("Enter");
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
  await page.getByRole("button", { name: "View recommendations" }).click();
  await expect(page.getByRole("heading", { name: "Compatible materials" })).toBeFocused();
  const outline = await page.getByRole("heading", { name: "Compatible materials" })
    .evaluate((element) => getComputedStyle(element).outlineWidth);
  expect(outline).toBe("3px");
});

test("selector reflows at 320px and 200 percent zoom with 44px actions in DOM order", async ({ page }) => {
  for (const state of [
    { width: 320, zoom: "100%" },
    { width: 640, zoom: "200%" },
  ]) {
    await page.setViewportSize({ width: state.width, height: 900 });
    await waitForSelector(page);
    await page.evaluate((zoom) => { document.documentElement.style.zoom = zoom; }, state.zoom);
    await page.getByText("Printer and process constraints", { exact: true }).click();
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      orderValues: [...document.querySelectorAll<HTMLElement>(".selector-island form, .selector-island [role=status], .selector-island .selector-results")]
        .map((element) => getComputedStyle(element).order),
      nowrap: [...document.querySelectorAll<HTMLElement>(".selector-goal span")]
        .some((element) => getComputedStyle(element).whiteSpace === "nowrap"),
    }));
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.orderValues.every((value) => value === "0")).toBe(true);
    expect(layout.nowrap).toBe(false);

    const targets = page.locator(".selector-controls label.selector-goal, .selector-controls summary, .selector-controls select, .selector-controls button, .selector-results button, .selector-results summary");
    const boxes = await targets.evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height, visible: rect.width > 0 && rect.height > 0 };
    }).filter(({ visible }) => visible));
    expect(boxes.length).toBeGreaterThan(0);
    boxes.forEach(({ width, height }) => {
      expect(width).toBeGreaterThanOrEqual(44);
      expect(height).toBeGreaterThanOrEqual(44);
    });
  }
});

test("reduced motion and forced colors retain text, borders, shapes, and focus meaning", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await waitForSelector(page);
  await page.getByText("Printer and process constraints", { exact: true }).click();
  await page.locator("details.selector-eliminated > summary").click();
  await page.getByRole("button", { name: /^Add .+ to shortlist$/u }).first().click();
  await expect(page.getByText("Shortlisted", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Compatible with selected constraints", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Blocked by selected constraint", { exact: true }).first()).toBeVisible();
  const indeterminate = page.getByText("Cannot verify — treated as incompatible", { exact: true });
  if (await indeterminate.count() > 0) await expect(indeterminate.first()).toBeVisible();
  const transitions = await page.locator(".selector-goal").first().evaluate((element) =>
    getComputedStyle(element).transitionDuration.split(",").map((value) => Number.parseFloat(value) || 0));
  expect(Math.max(...transitions)).toBeLessThanOrEqual(0.001);
  const selectedBorder = await page.locator(".selector-goal:has(input:checked)").evaluate((element) => getComputedStyle(element).borderLeftStyle);
  expect(selectedBorder).not.toBe("none");
  await page.getByRole("button", { name: "View recommendations" }).focus();
  expect(await page.getByRole("button", { name: "View recommendations" }).evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
});

test("axe passes default, changed, elimination, shortlist, and no-compatible states", async ({ page }) => {
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
  await expect(page.getByText("Printer and process constraints", { exact: true })).toBeFocused();
});
