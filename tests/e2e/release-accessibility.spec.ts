import AxeBuilderImport from "@axe-core/playwright";
import playwrightTest from "@playwright/test";
import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "playwright/types/test";

import { discoverReleaseRoutes } from "./release-route-fixtures.ts";

type Page = PlaywrightTestArgs["page"];
type Browser = PlaywrightWorkerArgs["browser"];

const test = playwrightTest as unknown as TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const expect = (playwrightTest as unknown as { expect: (...args: any[]) => any }).expect;

const mode = process.env.ATLAS_TEST_MODE;
if (mode !== "root" && mode !== "repository") throw new Error("ATLAS_TEST_MODE_INVALID");
const routes = discoverReleaseRoutes(mode);
const AxeBuilder = AxeBuilderImport as unknown as new (options: { page: Page }) => {
  withTags(tags: string[]): {
    analyze(): Promise<{
      violations: readonly { impact?: string | null; id: string }[];
    }>;
  };
};
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

function compareHref(): string {
  const query = new URLSearchParams();
  for (const id of routes.materialIds.slice(0, 2)) query.append("material", id);
  return `${routes.compare.href}?${query.toString()}`;
}

async function waitForInteractiveSurface(page: Page, href: string): Promise<void> {
  await page.goto(href);
  if (href === routes.home.href) {
    await expect(page.getByRole("button", { name: "View recommendations" })).toBeEnabled();
  } else if (href === routes.materials.href) {
    await expect(page.getByLabel("Search material or family")).toBeEnabled();
  } else if (href.startsWith(routes.compare.href)) {
    await expect(page.getByRole("heading", { name: "Comparison of 2 materials" })).toBeVisible();
  } else if (href === routes.data.href) {
    await expect(page.getByRole("button", { name: "Clear filters" })).toBeEnabled();
  } else if (href.startsWith(routes.map.href)) {
    await page.locator(".map-explorer").scrollIntoViewIfNeeded();
    await expect(
      page.getByText("Interactive map controls are ready.", { exact: true }),
    ).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
}

async function axePasses(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const serious = result.violations.filter(({ impact }) =>
    ["serious", "critical"].includes(impact ?? ""),
  );
  expect(serious).toEqual([]);
  expect(result.violations).toEqual([]);
}

async function assertNoDocumentOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function assertVisibleTargets(page: Page, href: string): Promise<void> {
  const targets =
    href === routes.home.href
      ? page.locator(
          ".selector-goal:visible, .selector-controls summary:visible, .selector-controls select:visible, .selector-controls button:visible",
        )
      : href.startsWith(routes.compare.href)
        ? page
            .getByRole("form", { name: "Choose materials to compare" })
            .locator("select:visible, button:visible")
        : href === routes.data.href
          ? page
              .getByRole("main")
              .locator(
                ".data-controls select:visible, .data-controls button:visible, .data-controls input[type='search']:visible",
              )
          : page
              .getByRole("main")
              .locator(
                ".map-page button:visible, .map-page select:visible, .map-page input:visible, .map-page summary:visible",
              );
  const sizes = await targets.evaluateAll((elements: Element[]) =>
    elements.slice(0, 3).map((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );
  expect(sizes.length).toBeGreaterThan(0);
  for (const { width, height } of sizes) {
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  }
}

async function openNoScript(browser: Browser, href: string): Promise<Page> {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(href);
  return page;
}

test("axe passes representative selector, atlas, detail, compare, data, map, and method states", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const surfaces = [
    routes.home.href,
    routes.materials.href,
    routes.representativeMaterial.href,
    compareHref(),
    routes.data.href,
    routes.representativeLane.href,
    routes.method.href,
  ];
  expect(surfaces).toHaveLength(7);
  for (const href of surfaces) {
    await waitForInteractiveSurface(page, href);
    await axePasses(page);
  }
});

test("keyboard changes retain focus and announce selector, atlas, compare, data, and map state", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await waitForInteractiveSurface(page, routes.home.href);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  const difficulty = page.getByLabel("Maximum print difficulty");
  await difficulty.focus();
  await difficulty.selectOption({ index: 1 });
  await expect(difficulty).toBeFocused();
  await expect(page.getByRole("status")).toHaveAttribute("aria-live", "polite");
  await expect(page.getByRole("status")).toContainText(
    /\d+ compatible materials; \d+ eliminated\./u,
  );

  await waitForInteractiveSurface(page, routes.materials.href);
  const search = page.getByLabel("Search material or family");
  await search.focus();
  await search.fill("a");
  await expect(search).toBeFocused();
  await expect(page.getByRole("status")).toContainText(/\d+ matches/u);

  await waitForInteractiveSurface(page, compareHref());
  const third = page.getByLabel("Material 3 (optional)");
  await third.focus();
  await third.selectOption(routes.materialIds[2]!);
  await expect(third).toBeFocused();
  const update = page.getByRole("button", { name: "Update comparison" });
  await update.focus();
  await page.keyboard.press("Enter");
  await expect(update).toBeFocused();
  await expect(page.getByRole("status")).toHaveAttribute("aria-atomic", "true");

  await waitForInteractiveSurface(page, routes.data.href);
  const records = page.getByRole("radio", { name: "Material records" });
  await records.focus();
  await records.check();
  await expect(records).toBeFocused();
  await expect(page.getByRole("status")).toContainText(/\d+ materials shown/u);

  await waitForInteractiveSurface(page, routes.map.href);
  const lane = page.getByRole("button", { name: /^Highlight /u }).first();
  await lane.focus();
  await page.keyboard.press("Enter");
  await expect(lane).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("Decision lane selected.");
});

test("dense data and diagrams expose keyboard-readable table, record, lane, and legend alternatives", async ({
  page,
}) => {
  await waitForInteractiveSurface(page, routes.data.href);
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("rowheader")).toHaveCount(routes.materialIds.length);
  const records = page.getByRole("radio", { name: "Material records" });
  await records.check();
  await expect(page.getByRole("region", { name: /material records$/u })).toBeVisible();

  await waitForInteractiveSurface(page, routes.map.href);
  const laneLinks = page.getByRole("navigation", { name: "Decision path index" }).getByRole("link");
  const laneCount = await laneLinks.count();
  expect(laneCount).toBeGreaterThan(0);
  await expect(page.locator("[data-decision-lane]")).toHaveCount(laneCount);
  await expect(page.locator("[data-service-row]")).toHaveCount(routes.materialIds.length);
  await expect(page.locator("[data-impact-row]")).toHaveCount(routes.materialIds.length);
  await expect(
    page.getByRole("region", { name: "Complete practical service guidance table" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Complete impact and flexibility material table" }),
  ).toBeVisible();
  await expect(page.getByLabel("Process-gate relationship legend")).toContainText(
    "Applies — verify this gate",
  );
  await expect(page.getByLabel("Impact-flex mark legend")).toContainText(
    "Conditional — review conditions",
  );
  await expect(page.locator("svg [tabindex], svg a, svg button")).toHaveCount(0);
});

test("forced colors and reduced motion retain visible focus and non-color decision meaning", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await waitForInteractiveSurface(page, routes.home.href);
  const add = page.getByRole("button", { name: /^Add .+ to shortlist$/u }).first();
  await add.focus();
  expect(await add.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await add.click();
  await expect(page.getByRole("heading", { name: "Shortlist" })).toBeVisible();
  await expect(
    page.getByText("Compatible with selected constraints", { exact: true }).first(),
  ).toBeVisible();

  await waitForInteractiveSurface(page, routes.map.href);
  await page
    .getByRole("button", { name: /^Highlight /u })
    .first()
    .click();
  await expect(page.getByText("Selected decision lane", { exact: true }).first()).toBeVisible();
  const motion = await page.locator(".map-page *").evaluateAll((elements: Element[]) =>
    elements.flatMap((element) => {
      const style = getComputedStyle(element);
      const duration = [
        ...style.transitionDuration.split(","),
        ...style.animationDuration.split(","),
      ]
        .map((value) =>
          value.trim().endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1_000,
        )
        .reduce((maximum, value) => Math.max(maximum, value || 0), 0);
      const positional = /(?:transform|translate|top|right|bottom|left|inset)/u.test(
        style.transitionProperty,
      );
      return duration > 1 || positional ? [{ duration, property: style.transitionProperty }] : [];
    }),
  );
  expect(motion).toEqual([]);
});

test("320 CSS pixels and 200 percent zoom keep representative controls reachable in reading order", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const surfaces = [routes.home.href, compareHref(), routes.data.href, routes.map.href];
  for (const state of [
    { width: 320, zoom: "100%" },
    { width: 640, zoom: "200%" },
  ]) {
    await page.setViewportSize({ width: state.width, height: 900 });
    for (const href of surfaces) {
      await waitForInteractiveSurface(page, href);
      await page.evaluate((zoom) => {
        document.documentElement.style.zoom = zoom;
        document.documentElement.style.scrollbarGutter = "stable";
      }, state.zoom);
      await assertNoDocumentOverflow(page);
      await assertVisibleTargets(page, href);
    }
  }
});

test("no-script selector, data, and map pages retain complete static meaning", async ({
  browser,
}) => {
  const selector = await openNoScript(browser, routes.home.href);
  await expect(selector.getByRole("heading", { level: 1, name: routes.home.label })).toBeVisible();
  expect(await selector.locator(".selector-compatible-list > li").count()).toBeGreaterThan(0);
  await selector.context().close();

  const data = await openNoScript(browser, routes.data.href);
  await expect(data.getByRole("heading", { level: 1, name: routes.data.label })).toBeVisible();
  await expect(data.getByRole("table")).toBeVisible();
  await expect(
    data.getByText("Named thermal tests are not directly interchangeable."),
  ).toBeVisible();
  await data.context().close();

  const map = await openNoScript(browser, routes.map.href);
  await expect(map.getByRole("heading", { level: 1, name: routes.map.label })).toBeVisible();
  await expect(map.locator("[data-decision-lane]")).toHaveCount(
    await map.getByRole("navigation", { name: "Decision path index" }).getByRole("link").count(),
  );
  await expect(map.locator("[data-service-row]")).toHaveCount(routes.materialIds.length);
  await expect(map.getByText(/controls are preparing/u)).toHaveCount(1);
  await map.context().close();
});
