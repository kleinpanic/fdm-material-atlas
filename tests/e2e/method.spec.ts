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

test("method fragments explain evidence, thermal distinctions, scoring, profiles, and limitations", async ({
  page,
}) => {
  await page.goto(`${basePath}method/`);
  for (const id of [
    "evidence-scopes",
    "thermal-metrics",
    "selector-scoring",
    "qualitative-guidance",
    "starting-profiles",
    "methods",
    "sources",
    "limitations",
  ]) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  await expect(page.getByText("not directly interchangeable", { exact: false })).toBeVisible();
  for (const term of ["Tg", "HDT", "Vicat", "Melting point"])
    await expect(page.getByText(term, { exact: false }).first()).toBeVisible();
  await expect(page.getByText("universal material quality", { exact: false })).toBeVisible();
  await expect(
    page.getByText("not an engineering safety certification", { exact: false }),
  ).toBeVisible();
});

test("source actions are isolated HTTPS links and supporting claims return to exact material anchors", async ({
  page,
}) => {
  await page.goto(`${basePath}method/#sources`);
  const external = page.locator("#sources a[target='_blank']");
  expect(await external.count()).toBeGreaterThan(0);
  for (const link of await external.all()) {
    expect(await link.getAttribute("href")).toMatch(/^https:\/\//u);
    expect(await link.getAttribute("rel")).toBe("noopener noreferrer");
  }
  const supportingDetails = page
    .locator("#sources details")
    .filter({ has: page.locator("a[href*='/materials/']") })
    .first();
  await supportingDetails.locator("summary").click();
  const supporting = supportingDetails.locator("a[href*='/materials/']").first();
  await supporting.click();
  expect(page.url()).toMatch(/\/materials\/[a-z0-9-]+\/#claim-[a-z0-9-]+$/u);
  await expect(page.locator(":target")).toHaveCount(1);
});
