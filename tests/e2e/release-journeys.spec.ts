import playwrightTest from "@playwright/test";
import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "playwright/types/test";

import {
  buildNoCompatibleReleaseModel,
  discoverReleaseRoutes,
  discoverSelectorModules,
} from "./release-route-fixtures.ts";

type Page = PlaywrightTestArgs["page"];

const test = playwrightTest as unknown as TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const expect = (playwrightTest as unknown as { expect: (...args: any[]) => any }).expect;

const mode = process.env.ATLAS_TEST_MODE;
if (mode !== "root" && mode !== "repository") throw new Error("ATLAS_TEST_MODE_INVALID");
const routes = discoverReleaseRoutes(mode);

async function openSelector(page: Page): Promise<void> {
  await page.goto(routes.home.href);
  await expect(page.getByRole("heading", { level: 1, name: routes.home.label })).toBeVisible();
  await expect(page.getByRole("button", { name: "View recommendations" })).toBeEnabled();
}

async function mountNoCompatibleState(page: Page): Promise<void> {
  const modules = discoverSelectorModules(routes);
  const pageModel = buildNoCompatibleReleaseModel(routes.basePath);
  await page.evaluate(
    async ({ componentUrl, preactUrl, pageModel: controlledModel }) => {
      const island = document.querySelector("astro-island");
      if (island === null) throw new Error("RELEASE_SELECTOR_ISLAND_MISSING");
      const host = document.createElement("div");
      island.replaceWith(host);
      const component = (await import(componentUrl)) as {
        SelectorIsland: (props: unknown) => unknown;
      };
      const preact = (await import(preactUrl)) as {
        a: (componentType: unknown, props: unknown) => unknown;
        n: (node: unknown, parent: Element) => void;
      };
      preact.n(preact.a(component.SelectorIsland, { pageModel: controlledModel }), host);
    },
    { ...modules, pageModel },
  );
  await expect(
    page.getByRole("heading", { name: "No materials match every selected constraint" }),
  ).toBeVisible();
}

function observeBaseEscapes(page: Page): string[] {
  const escapes: string[] = [];
  page.on("response", (response: { url(): string; ok(): boolean }) => {
    const url = new URL(response.url());
    if (url.hostname !== "127.0.0.1") return;
    if (!url.pathname.startsWith(routes.basePath) || !response.ok()) escapes.push(response.url());
  });
  return escapes;
}

test("release fixtures discover valid routes, material IDs, a lane, and an asset from output", async ({
  page,
}) => {
  expect(routes.materialIds.length).toBeGreaterThanOrEqual(2);
  expect(new Set(routes.materialIds).size).toBe(routes.materialIds.length);
  expect(routes.representativeMaterial.href).toMatch(
    new RegExp(`^${routes.basePath.replaceAll("/", "\\/")}materials/[a-z0-9-]+/$`, "u"),
  );
  expect(routes.representativeLane.href).toMatch(
    new RegExp(`^${routes.basePath.replaceAll("/", "\\/")}map/#lane-[a-z0-9-]+$`, "u"),
  );
  expect(routes.assetHref).toMatch(
    new RegExp(`^${routes.basePath.replaceAll("/", "\\/")}_astro/.+\\.(?:css|js)$`, "u"),
  );

  for (const route of [
    routes.home,
    routes.materials,
    routes.compare,
    routes.data,
    routes.map,
    routes.method,
    routes.representativeMaterial,
  ]) {
    await page.goto(route.href);
    await expect(page.getByRole("heading", { level: 1, name: route.label })).toBeVisible();
  }
  const asset = await page.request.get(routes.assetHref);
  expect(asset.ok()).toBe(true);
});

test("selector choice explains ranking and exclusions before a base-safe compare handoff", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const escapes = observeBaseEscapes(page);
  await openSelector(page);

  const goals = page.getByRole("radio");
  expect(await goals.count()).toBeGreaterThan(1);
  await goals.nth(1).check();
  await expect(goals.nth(1)).toBeChecked();
  await expect(page.locator("[role=status]")).toContainText(
    /\d+ compatible materials; \d+ eliminated\./u,
  );

  const ranked = page.locator(".selector-compatible-list > li");
  expect(await ranked.count()).toBeGreaterThanOrEqual(2);
  await ranked.first().getByText("Why this rank", { exact: true }).click();
  await expect(ranked.first().locator("[data-contribution-state]").first()).toBeVisible();
  const eliminated = page.locator("details.selector-eliminated");
  await expect(eliminated).toBeVisible();
  await eliminated.locator(":scope > summary").click();
  await expect(eliminated.locator("[data-exclusion-state]").first()).toBeVisible();

  const addButtons = page.getByRole("button", { name: /^Add .+ to shortlist$/u });
  const first = (await addButtons.nth(0).innerText()).trim();
  const second = (await addButtons.nth(1).innerText()).trim();
  await page.getByRole("button", { name: first, exact: true }).click();
  await page.getByRole("button", { name: second, exact: true }).click();
  const compare = page.getByRole("link", { name: "Compare shortlisted" });
  const compareHref = await compare.getAttribute("href");
  if (compareHref === null) throw new Error("RELEASE_COMPARE_HREF_MISSING");
  const selectedIds = new URL(compareHref, "https://atlas.invalid").searchParams.getAll("material");
  expect(selectedIds).toHaveLength(2);
  expect(selectedIds.every((id) => routes.materialIds.includes(id))).toBe(true);
  expect(compareHref.startsWith(routes.compare.href)).toBe(true);

  await compare.click();
  await expect(page.getByRole("heading", { level: 1, name: routes.compare.label })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Comparison of 2 materials" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("2 materials");
  expect(new URL(page.url()).searchParams.getAll("material")).toEqual(selectedIds);
  expect(escapes).toEqual([]);
});

test("a controlled hard-constraint no-match state explains elimination and recovers through controls", async ({
  page,
}) => {
  await openSelector(page);
  await mountNoCompatibleState(page);
  await expect(page.locator(".selector-no-compatible dd")).toHaveCount(7);
  await expect(page.locator("details.selector-eliminated")).toHaveAttribute("open", "");
  await expect(page.getByText("Your selections have not changed.", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Review printer and process constraints" }).click();
  await expect(page.locator("details.selector-secondary > summary")).toBeFocused();
  const difficulty = page.getByLabel("Maximum print difficulty");
  await difficulty.selectOption({ index: (await difficulty.locator("option").count()) - 1 });
  await expect(page.getByRole("heading", { name: "Compatible materials" })).toBeVisible();
  expect(await page.locator(".selector-compatible-list > li").count()).toBeGreaterThan(0);
});

test("result onward actions reach detail, profile, evidence, method, atlas, data, and a map lane", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const escapes = observeBaseEscapes(page);
  await openSelector(page);

  const firstResult = page.locator(".selector-compatible-list > li").first();
  const details = firstResult.getByRole("link", { name: "View material details" });
  const detailHref = await details.getAttribute("href");
  if (detailHref === null) throw new Error("RELEASE_DETAIL_HREF_MISSING");
  expect(detailHref.startsWith(`${routes.basePath}materials/`)).toBe(true);
  const profile = firstResult.getByRole("link", { name: "View starting profile" });
  const profileHref = await profile.getAttribute("href");
  if (profileHref === null) throw new Error("RELEASE_PROFILE_HREF_MISSING");
  expect(profileHref.startsWith(detailHref)).toBe(true);
  await profile.click();
  await expect(page.locator(":target")).toHaveAttribute("id", "starting-profile");
  await page.goto(detailHref);
  await expect(page.locator("#starting-profile")).toBeVisible();
  await expect(page.locator("#evidence")).toBeVisible();
  await expect(page.getByText("Evidence scope:", { exact: false }).first()).toBeVisible();

  await page.locator(`a[href^="${routes.method.href}"]`).first().click();
  await expect(page.getByRole("heading", { level: 1, name: routes.method.label })).toBeVisible();
  await expect(page.locator("#evidence-scopes")).toBeVisible();

  for (const route of [routes.materials, routes.data, routes.map]) {
    const link = page.locator(`a[href="${route.href}"]`).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name: route.label })).toBeVisible();
  }

  const lane = page.locator(`a[href="${routes.representativeLane.href}"]`).first();
  await expect(lane).toBeVisible();
  await lane.click();
  await expect(page.locator(":target")).toHaveAttribute(
    "id",
    routes.representativeLane.href.split("#")[1]!,
  );
  expect(escapes).toEqual([]);
});
