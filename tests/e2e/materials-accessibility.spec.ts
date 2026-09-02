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
const test = playwrightTest as unknown as TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const expect = (playwrightTest as unknown as { expect: (...args: any[]) => any }).expect;
const AxeBuilder = AxeBuilderImport as unknown as new (options: { page: Page }) => {
  withTags(tags: string[]): { analyze(): Promise<{ violations: unknown[] }> };
};
const mode = process.env.ATLAS_TEST_MODE;
if (mode !== "root" && mode !== "repository") throw new Error("ATLAS_TEST_MODE_INVALID");
const basePath = mode === "root" ? "/" : "/atlas-preview/";

async function axePasses(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

async function expectMaterialAnchorToRemainSettled(
  page: Page,
  targetSelector: string,
): Promise<void> {
  await expect(page.locator(targetSelector)).toBeInViewport();
  await page.locator(targetSelector).evaluate(async (target: Element) => {
    const sections = target.closest(".material-reference__sections");
    if (!(sections instanceof HTMLElement)) {
      throw new Error("MATERIAL_ANCHOR_SECTIONS_MISSING");
    }

    await document.fonts.ready;
    const settledUntil = performance.now() + 5_000;

    while (performance.now() < settledUntil) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const bounds = target.getBoundingClientRect();
      const visible =
        bounds.bottom > 0 &&
        bounds.right > 0 &&
        bounds.top < window.innerHeight &&
        bounds.left < window.innerWidth;
      if (!visible) {
        throw new Error(
          `MATERIAL_ANCHOR_LEFT_VIEWPORT:${bounds.top.toFixed(1)}:${bounds.bottom.toFixed(1)}`,
        );
      }
    }
  });
}

async function activateMaterialRailAnchor(
  page: Page,
  linkName: string,
  targetSelector: string,
): Promise<void> {
  const link = page
    .getByRole("navigation", { name: "On this page" })
    .getByRole("link", { name: linkName });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#${targetSelector.slice(1)}$`, "u"));
  await expect(page.locator(targetSelector)).toBeFocused();
  await expectMaterialAnchorToRemainSettled(page, `${targetSelector} > h2`);
}

test("atlas default, filtered, zero-result, material, and method states pass axe", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(`${basePath}materials/`);
  await axePasses(page);
  await page.getByLabel("Print difficulty").selectOption({ index: 1 });
  await axePasses(page);
  await page.getByLabel("Search material or family").fill("no-material-has-this-name");
  await axePasses(page);
  await page.goto(`${basePath}materials/pla/`);
  await axePasses(page);
  await page.goto(`${basePath}method/`);
  await axePasses(page);
});

test("keyboard, narrow reflow, reduced motion, and forced colors retain meaning", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.goto(`${basePath}materials/`);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByText("public evidence records", { exact: false }).first()).toBeVisible();
  const transition = await page
    .locator(".atlas-row")
    .first()
    .evaluate((element: Element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(transition)).toBeLessThanOrEqual(0.001);
});

test("material rail anchors reveal contained sections without changing accessible order", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${basePath}materials/abs/`);

  const overview = page.locator("#overview");
  const thermal = page.locator("#thermal");
  await expect(overview).toHaveCSS("content-visibility", "visible");
  await expect(thermal).toHaveCSS("content-visibility", "auto");
  expect(
    await thermal.evaluate(
      (element: Element) => getComputedStyle(element).containIntrinsicBlockSize,
    ),
  ).toBe("auto 1045px");
  await expect(page.locator(".material-reference__sections > section")).toHaveCount(9);

  await activateMaterialRailAnchor(page, "Evidence", "#evidence");
  await axePasses(page);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${basePath}materials/abs/`);
  await activateMaterialRailAnchor(page, "Evidence", "#evidence");

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${basePath}materials/abs/#starting-profile`);
  await expect(page.locator("#starting-profile > h2")).toBeInViewport();
  const readingOrder = await page.evaluate(() => {
    const rail = document.querySelector(".material-reference__rail");
    const sections = document.querySelector(".material-reference__sections");
    if (!rail || !sections) throw new Error("material reference structure missing");
    return rail.compareDocumentPosition(sections) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(readingOrder).toBeTruthy();

  await page.emulateMedia({ media: "print" });
  await expect(thermal).toHaveCSS("content-visibility", "visible");
});
