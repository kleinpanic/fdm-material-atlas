import { expect, type Page, test } from "@playwright/test";

async function openTracer(page: Page): Promise<void> {
  await page.goto("./");
  const entry = page.getByRole("link", { name: "Open material tracer" });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/materials\/[a-z0-9-]+\/$/);
}

test("generated tracer exposes canonical identity and complete static specimens", async ({ page }) => {
  await openTracer(page);
  const identity = page.locator(".tracer-identity");
  const materialName = (await identity.getByRole("heading", { level: 1 }).textContent())?.trim();
  expect(materialName).toBeTruthy();
  await expect(identity.getByText("Generated material route")).toBeVisible();
  await expect(identity.locator(".family-fill-marker")).toHaveAttribute("aria-hidden", "true");
  await expect(identity.locator(".family-fill-value span").last()).not.toBeEmpty();
  await expect(identity.locator(".technical-label")).not.toBeEmpty();
  await expect(page.getByRole("heading", { name: "Thermal metric" })).toBeVisible();
  await expect(page.getByText("Unlike thermal metrics are not directly interchangeable.", { exact: false })).toBeVisible();
  await expect(page.getByText("Verify capability", { exact: false })).toBeVisible();
  await expect(page.getByText("Evidence applicability specimen")).toBeVisible();
  await expect(page.locator(".process-marker__shape")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".process-marker__shape")).toHaveAttribute("data-marker-shape", /.+/);
  const pageText = await page.getByRole("main").innerText();
  expect(pageText).toContain(materialName as string);
  expect(pageText).toContain("Family or filler");
  expect(pageText).toContain("Public material ID");
  expect(pageText).toContain("Applicability and evidence scope");
});

test("breadcrumb and return journeys stay within the selected deployment base", async ({ page }) => {
  await openTracer(page);
  const basePath = process.env.ATLAS_TEST_MODE === "repository" ? "/atlas-preview/" : "/";
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb.getByRole("link", { name: "Home" })).toHaveAttribute("href", basePath);
  await expect(breadcrumb.getByText("Material tracer", { exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Return to atlas home" }).click();
  await expect(page).toHaveURL(new RegExp(`${basePath.replaceAll("/", "\\/")}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose a material by what the part must do");
});

test("tracer meaning remains visible without hover, animation, or color", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await openTracer(page);
  await expect(page.locator(".family-fill-marker")).toBeVisible();
  await expect(page.locator(".process-marker__shape")).toBeVisible();
  await expect(page.getByText("Verify capability", { exact: false })).toBeVisible();
  await expect(page.getByText("Unlike thermal metrics are not directly interchangeable.", { exact: false })).toBeVisible();
  await expect(page.getByText("Scope", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to atlas home" })).toBeVisible();
});
