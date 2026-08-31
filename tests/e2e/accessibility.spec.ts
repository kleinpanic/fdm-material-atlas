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

async function tracerHref(page: Page): Promise<string> {
  await page.goto("./");
  const href = await page.getByRole("link", { name: "Open material tracer" }).getAttribute("href");
  expect(href).toBeTruthy();
  return href as string;
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: string): number {
  const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match === null) throw new Error("COLOR_FORMAT_INVALID");
  return 0.2126 * channel(Number(match[1])) + 0.7152 * channel(Number(match[2])) + 0.0722 * channel(Number(match[3]));
}

function contrast(first: string, second: string): number {
  const firstValue = luminance(first);
  const secondValue = luminance(second);
  return (Math.max(firstValue, secondValue) + 0.05) / (Math.min(firstValue, secondValue) + 0.05);
}

test("home and generated tracer have no detectable WCAG A or AA violations", async ({ page }) => {
  const tracer = await tracerHref(page);
  for (const path of ["./", tracer]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }
});

test("focus indicators, target sizes, and declared foreground pairs meet the UI contract", async ({ page }) => {
  await page.goto("./");
  const action = page.getByRole("link", { name: "Open material tracer" });
  await action.focus();
  const actionContract = await action.evaluate((element: HTMLElement) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return { outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle, width: rect.width, height: rect.height, color: style.color, background: style.backgroundColor };
  });
  expect(actionContract.outlineWidth).toBe("3px");
  expect(actionContract.outlineStyle).not.toBe("none");
  expect(actionContract.width).toBeGreaterThanOrEqual(44);
  expect(actionContract.height).toBeGreaterThanOrEqual(44);
  expect(contrast(actionContract.color, actionContract.background)).toBeGreaterThanOrEqual(4.5);
  const bodyContract = await page.locator("body").evaluate((element: HTMLElement) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
  expect(contrast(bodyContract.color, bodyContract.background)).toBeGreaterThanOrEqual(4.5);
});

test("reduced motion removes meaningful timing while retaining all content", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tracer = await tracerHref(page);
  await page.goto(tracer);
  const transitionDurations = await page.getByRole("link", { name: "Return to atlas home" }).evaluate((element: HTMLElement) => getComputedStyle(element).transitionDuration.split(",").map((duration) => duration.endsWith("ms") ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1000));
  expect(Math.max(...transitionDurations)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Verify capability", { exact: false })).toBeVisible();
});

test("forced colors retains textual and shape encodings for every tracer decision state", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  const tracer = await tracerHref(page);
  await page.goto(tracer);
  for (const locator of [page.locator(".family-fill-marker"), page.locator(".process-marker__shape")]) {
    const box = await locator.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  }
  await expect(page.getByText("Family or filler", { exact: true })).toBeVisible();
  await expect(page.getByText("Verify capability", { exact: false })).toBeVisible();
  await expect(page.getByText("Unlike thermal metrics are not directly interchangeable.", { exact: false })).toBeVisible();
  await expect(page.getByText("Evidence applicability specimen", { exact: true })).toBeVisible();
});
