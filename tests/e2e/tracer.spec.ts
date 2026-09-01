import playwrightTest from "@playwright/test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
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

async function openTracer(page: Page): Promise<void> {
  const mode = process.env.ATLAS_TEST_MODE;
  if (mode !== "root" && mode !== "repository") throw new Error("ATLAS_TEST_MODE_INVALID");
  const basePath = mode === "root" ? "/" : "/atlas-preview/";
  const material = readdirSync(resolve(`dist-test/${mode}/materials`), { withFileTypes: true })
    .find((entry) => entry.isDirectory());
  expect(material?.name).toBeTruthy();
  await page.goto(`${basePath}materials/${material!.name}/`);
  await expect(page).toHaveURL(/\/materials\/[a-z0-9-]+\/$/);
}

test("generated material reference exposes canonical identity and complete static specimens", async ({ page }) => {
  await openTracer(page);
  const identity = page.locator(".material-reference__identity");
  const materialName = (await identity.getByRole("heading", { level: 1 }).textContent())?.trim();
  expect(materialName).toBeTruthy();
  await expect(identity.getByText("Material reference", { exact: true })).toBeVisible();
  await expect(identity.locator(".technical-label")).not.toBeEmpty();
  for (const id of ["overview", "thermal", "properties", "process", "uses-tradeoffs", "starting-profile", "evidence", "limitations", "relationships"]) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  await expect(page.getByText("not directly interchangeable", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("calibration starting points", { exact: false }).first()).toBeVisible();
  await expect(page.locator(".scientific-state__glyph").first()).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".scientific-state__glyph").first()).toHaveAttribute("data-marker-shape", /.+/);
  const pageText = await page.getByRole("main").innerText();
  expect(pageText).toContain(materialName as string);
  expect(pageText).toContain("Public material ID");
  expect(pageText).toContain("Evidence scope");
});

test("breadcrumb and return journeys stay within the selected deployment base", async ({ page }) => {
  await openTracer(page);
  const basePath = process.env.ATLAS_TEST_MODE === "repository" ? "/atlas-preview/" : "/";
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  const materialName = (await page.getByRole("heading", { level: 1 }).textContent())?.trim();
  expect(materialName).toBeTruthy();
  await expect(breadcrumb.getByRole("link", { name: "Home" })).toHaveAttribute("href", basePath);
  await expect(breadcrumb.getByRole("link", { name: "Materials" })).toHaveAttribute("href", `${basePath}materials/`);
  await expect(breadcrumb.getByText(materialName!, { exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Return to the complete material atlas" }).click();
  await expect(page).toHaveURL(new RegExp(`${basePath.replaceAll("/", "\\/")}materials/$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Browse validated material families");
});

test("material-reference meaning remains visible without hover, animation, or color", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await openTracer(page);
  await expect(page.locator(".scientific-state__glyph").first()).toBeVisible();
  await expect(page.locator(".scientific-state__label").first()).toBeVisible();
  await expect(page.getByText("not directly interchangeable", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Evidence scope", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to the complete material atlas" })).toBeVisible();
});
