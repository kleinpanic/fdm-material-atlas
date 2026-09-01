import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import playwrightTest from "@playwright/test";
import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "playwright/types/test";

const test = playwrightTest as unknown as TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const expect = (playwrightTest as unknown as { expect: (...args: any[]) => any }).expect;
const mode = process.env.ATLAS_TEST_MODE;
if (mode !== "root" && mode !== "repository") throw new Error("ATLAS_TEST_MODE_INVALID");
const basePath = mode === "root" ? "/" : "/atlas-preview/";
const slugs = readdirSync(resolve(`dist-test/${mode}/materials`), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map(({ name }) => name)
  .sort();

test("the no-script atlas lists every canonical material and links to static references", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${basePath}materials/`);
  await expect(page.locator(".atlas-row")).toHaveCount(23);
  await expect(page.locator(".atlas-fallback")).toContainText(
    "All validated materials remain listed",
  );
  const hrefs = await page
    .locator(".atlas-row__action")
    .evaluateAll((links: Element[]) => links.map((link: Element) => link.getAttribute("href")));
  expect([...hrefs].sort()).toEqual(slugs.map((slug) => `${basePath}materials/${slug}/`).sort());
  await context.close();
});

test("hydrated filters announce results, expose active state, and recover from no results", async ({
  page,
}) => {
  await page.goto(`${basePath}materials/`);
  const search = page.getByLabel("Search material or family");
  await expect(search).toBeEnabled();
  await search.fill("no-material-has-this-name");
  await expect(
    page.getByRole("heading", { name: "No materials match these filters" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("0 matches");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("status")).toContainText("23 matches");
  await page.getByLabel("Print difficulty").selectOption({ index: 1 });
  await expect(page.locator(".atlas-active-filters")).toContainText("Print difficulty");
  await expect(page.locator(".atlas-outside")).toBeVisible();
});

test("every generated material route exposes the complete reference contract", async ({ page }) => {
  test.setTimeout(90_000);
  expect(slugs).toHaveLength(23);
  for (const slug of slugs) {
    await page.goto(`${basePath}materials/${slug}/`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const id of [
      "overview",
      "thermal",
      "properties",
      "process",
      "uses-tradeoffs",
      "starting-profile",
      "evidence",
      "limitations",
      "relationships",
    ]) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
    await expect(
      page.getByText("not directly interchangeable", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("calibration starting points", { exact: false }).first(),
    ).toBeVisible();
  }
});
