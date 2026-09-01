import playwrightTest from "@playwright/test";
import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "playwright/types/test";

import { buildComparisonModel } from "../../src/features/comparison/model.ts";
import { safeCompare } from "../../src/features/comparison/safe-compare.ts";
import { buildMaterialDetailModels } from "../../src/features/materials/detail-model.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

type Page = PlaywrightTestArgs["page"];

const test = playwrightTest as unknown as TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;
// Astro check currently resolves only the default runtime export for this ESM package.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const expect = (playwrightTest as unknown as { expect: (...args: any[]) => any }).expect;

const mode = process.env.ATLAS_TEST_MODE;
if (mode !== "root" && mode !== "repository") throw new Error("ATLAS_TEST_MODE_INVALID");
const basePath = mode === "root" ? "/" : "/atlas-preview/";
const atlas = loadPublicAtlas();
const model = buildComparisonModel(atlas, basePath);
const detailModels = buildMaterialDetailModels(atlas, basePath);
const ids = model.materials.map(({ id }) => id);
const names = new Map(model.materials.map(({ id, name }) => [id, name]));

function comparePath(materialIds: readonly string[], extra = ""): string {
  const query = new URLSearchParams();
  for (const id of materialIds) query.append("material", id);
  if (extra !== "") query.append("unexpected", extra);
  return `${basePath}compare/?${query.toString()}#comparison-matrix`;
}

function rejectRuntimeDataRequests(page: Page): string[] {
  const violations: string[] = [];
  page.on("request", (request: { resourceType(): string }) => {
    if (!["fetch", "xhr"].includes(request.resourceType())) return;
    violations.push("runtime-data-request");
  });
  void page.route("**/*", async (route: {
    request(): { resourceType(): string };
    abort(code?: string): Promise<void>;
    continue(): Promise<void>;
  }) => {
    if (["fetch", "xhr"].includes(route.request().resourceType())) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  return violations;
}

async function waitForComparison(page: Page, count: number): Promise<void> {
  await expect(page.getByRole("heading", { name: `Comparison of ${count} materials` })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(`${count} materials`);
}

test("empty and every invalid URL state fail closed with fixed recovery copy", async ({ page }) => {
  const invalidPaths = [
    comparePath([ids[0]!.toString()]),
    comparePath([ids[0]!.toString(), ids[0]!.toString()]),
    comparePath([ids[0]!.toString(), "material-stale"]),
    comparePath(ids.slice(0, 5)),
    comparePath(ids.slice(0, 2), "value"),
    `${basePath}compare/?material=%E0%A4%A#comparison-matrix`,
  ];

  await page.goto(`${basePath}compare/`);
  await expect(page.getByRole("form", { name: "Choose materials to compare" })).toBeVisible();
  await expect(page.getByText("Choose two to four materials, then update the comparison.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Comparison of/u })).toHaveCount(0);

  for (const path of invalidPaths) {
    await page.goto(path);
    const alert = page.getByRole("alert");
    await expect(alert.getByRole("heading", { name: "Comparison link is not valid" })).toBeVisible();
    await expect(alert).toContainText("Choose two to four different materials and update the comparison.");
    await expect(page.getByRole("heading", { name: /Comparison of/u })).toHaveCount(0);
    await expect(page.getByLabel("Material 1")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("body")).not.toContainText("material-stale");
  }
});

test("two, three, and four material URLs preserve order and complete semantic disclosures", async ({ page }) => {
  test.setTimeout(90_000);
  const violations = rejectRuntimeDataRequests(page);
  for (const count of [2, 3, 4]) {
    const selected = ids.slice(0, count);
    const expected = safeCompare(model, selected);
    if (expected.kind !== "comparison") throw new Error("PUBLIC_COMPARISON_FIXTURE_INVALID");
    await page.goto(comparePath(selected));
    await waitForComparison(page, count);
    await expect(page.getByText(`${expected.differenceCount} differing attributes across ${expected.groups.length} groups.`, { exact: true })).toBeVisible();
    const selectedOptions = await Promise.all(Array.from({ length: count }, (_, index) =>
      page.getByLabel(`Material ${index + 1}${index > 1 ? " (optional)" : ""}`).inputValue()));
    expect(selectedOptions).toEqual(selected);
    const materialLinks = page.getByRole("link", { name: /^Open .+ material reference$/u });
    await expect(materialLinks).toHaveCount(count);
    expect(await materialLinks.allInnerTexts()).toEqual(selected.map((id) => `Open ${names.get(id)} material reference`));
    await expect(page.getByText(/^Same across selected materials \(\d+\)$/u).first()).toBeVisible();
    await expect(page.getByText("Difference", { exact: true }).first()).toBeVisible();
    for (const group of expected.groups) {
      await expect(page.getByRole("heading", { name: group.label, exact: true })).toBeVisible();
      if (group.differing.length === 0) {
        await expect(page.getByText("No differences in this group.", { exact: true })).toBeVisible();
      }
    }
    await expect(page.getByText("Evidence scope:", { exact: false }).first()).toBeVisible();
    const evidence = expected.groups
      .flatMap((group) => [...group.differing, ...group.equal])
      .flatMap((row) => row.values)
      .flatMap((value) => value.kind === "no-comparable-observation"
        ? []
        : value.kind === "value" ? value.cell.evidence : value.member.evidence)[0];
    if (evidence !== undefined) {
      await expect(page.getByRole("link", { name: evidence.label, exact: true }).first()).toHaveAttribute("href", evidence.href);
    }
  }
  expect(violations).toEqual([]);
});

test("slot updates replace history and retain scientific limitations", async ({ page }) => {
  await page.goto(comparePath(ids.slice(0, 2)));
  await waitForComparison(page, 2);
  const initialHistory = await page.evaluate(() => history.length);
  await page.getByLabel("Material 2").selectOption(ids[2]);
  await expect(page.getByRole("heading", { name: "Comparison of 2 materials" })).toBeVisible();
  await page.getByRole("button", { name: "Update comparison" }).click();
  await page.waitForFunction(
    ([first, second]: [string, string]) => new URL(location.href).searchParams.getAll("material").join("|") === `${first}|${second}`,
    [ids[0], ids[2]],
  );
  expect(new URL(page.url()).searchParams.getAll("material")).toEqual([ids[0], ids[2]]);
  expect(await page.evaluate(() => history.length)).toBe(initialHistory);
  await expect(page.getByText("Named thermal tests are not directly interchangeable.", { exact: true })).toBeVisible();
  await expect(page.getByText("does not rank a universally better material", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to the material selector" })).toHaveAttribute("href", basePath);
  await expect(page.getByRole("link", { name: "Browse all materials" })).toHaveAttribute("href", `${basePath}materials/`);
  await expect(page.getByRole("link", { name: "Read sources, definitions, and methodology" })).toHaveAttribute("href", `${basePath}method/`);
});

test("selector handoff preserves shortlist insertion order", async ({ page }) => {
  await page.goto(basePath);
  await expect(page.getByRole("button", { name: "View recommendations" })).toBeEnabled();
  const addButtons = page.getByRole("button", { name: /^Add .+ to shortlist$/u });
  const firstLabel = (await addButtons.nth(0).innerText()).trim();
  const secondLabel = (await addButtons.nth(1).innerText()).trim();
  await page.getByRole("button", { name: firstLabel }).click();
  await page.getByRole("button", { name: secondLabel }).click();
  const compare = page.getByRole("link", { name: "Compare shortlisted" });
  const href = await compare.getAttribute("href");
  if (href === null) throw new Error("SELECTOR_COMPARE_HREF_MISSING");
  const expectedOrder = new URL(href, "https://atlas.invalid").searchParams.getAll("material");
  expect(expectedOrder).toHaveLength(2);
  await compare.click();
  await waitForComparison(page, 2);
  expect(new URL(page.url()).searchParams.getAll("material")).toEqual(expectedOrder);
  await expect(page.getByLabel("Material 1")).toHaveValue(expectedOrder[0]!);
  await expect(page.getByLabel("Material 2")).toHaveValue(expectedOrder[1]!);
});

test("material details submit current-first pairs and every displayed continuity link resolves", async ({ page }) => {
  test.setTimeout(120_000);
  const detail = detailModels.find(({ continuity }) => continuity.relatedMaterials.length > 0);
  if (detail === undefined) throw new Error("DETAIL_CONTINUITY_FIXTURE_MISSING");
  const path = `${basePath}materials/${detail.slug}/`;
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: detail.name })).toBeVisible();
  const select = page.getByLabel(`Compare ${detail.name} with`);
  const related = detail.continuity.relatedMaterials[0]!;
  await select.selectOption(related.id);
  await page.getByRole("button", { name: "Add to comparison" }).click();
  await waitForComparison(page, 2);
  expect(new URL(page.url()).searchParams.getAll("material")).toEqual([detail.id, related.id]);

  for (const item of detail.continuity.relatedMaterials) {
    if (item.details.kind !== "link") continue;
    await page.goto(path);
    await page.getByRole("link", { name: item.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${item.details.href.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u"));
    await expect(page.getByRole("heading", { level: 1, name: item.name })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: detail.name })).toBeVisible();
  }

  for (const lane of detail.relationships) {
    if (lane.action.kind !== "link") continue;
    await page.goto(path);
    await page.getByRole("link", { name: lane.label, exact: true }).click();
    expect(page.url().endsWith(lane.action.href)).toBe(true);
    await expect(page.locator(":target")).toHaveCount(1);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: detail.name })).toBeVisible();
  }

  const unavailable = detailModels.find(({ continuity }) => continuity.relatedMaterials.length === 0);
  if (unavailable !== undefined) {
    await page.goto(`${basePath}materials/${unavailable.slug}/#relationships`);
    await expect(page.getByText("No shared decision-lane relationship is currently reported, so no comparison pair is suggested.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add to comparison" })).toHaveCount(0);
  }
});
