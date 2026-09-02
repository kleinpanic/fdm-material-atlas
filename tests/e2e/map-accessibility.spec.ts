import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import AxeBuilderImport from "@axe-core/playwright";
import playwrightTest from "@playwright/test";
import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "playwright/types/test";

import { compileMapProjection } from "../../src/features/map/projection.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import { renderMapOmissionRecoveryDocument } from "./fixtures/render-map-state.ts";

type Page = PlaywrightTestArgs["page"];
type Browser = PlaywrightWorkerArgs["browser"];
type BrowserContext = Awaited<ReturnType<Browser["newContext"]>>;

const test = playwrightTest as unknown as TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;
// Astro check currently resolves only the default runtime export for this ESM package.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const expect = (playwrightTest as unknown as { expect: (...args: any[]) => any }).expect;
const AxeBuilder = AxeBuilderImport as unknown as new (options: { page: Page }) => {
  withTags(tags: string[]): { analyze(): Promise<{ violations: unknown[] }> };
};

const mode = process.env.ATLAS_TEST_MODE;
if (mode !== "root" && mode !== "repository") throw new Error("ATLAS_TEST_MODE_INVALID");
const basePath = mode === "root" ? "/" : "/atlas-preview/";
const outputRoot = resolve(`dist-test/${mode}`);
const projection = compileMapProjection(loadPublicAtlas(), basePath);
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

function mapPath(fragment = ""): string {
  return `${basePath}map/${fragment}`;
}

async function openMap(page: Page): Promise<void> {
  await page.goto(mapPath());
  await page.locator(".map-explorer").scrollIntoViewIfNeeded();
  await expect(
    page.getByText("Interactive map controls are ready.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/controls are preparing/u)).toHaveCount(0);
  await page.evaluate(() => scrollTo(0, 0));
}

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

function mapComponentUrl(): string {
  const html = readFileSync(resolve(outputRoot, "map/index.html"), "utf8");
  const island = [...html.matchAll(/<astro-island\b[^>]*\bcomponent-url="([^"]+)"/gu)].find(
    (match) => match[0].includes("MapExplorerIsland"),
  );
  if (island?.[1] === undefined) throw new Error("MAP_COMPONENT_URL_MISSING");
  return island[1].replaceAll("&amp;", "&");
}

async function openWithoutJavaScript(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(mapPath());
  return { context, page };
}

async function openWithMapChunkAborted(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const port = mode === "root" ? 4321 : 4322;
  const url = new URL(mapComponentUrl(), `http://127.0.0.1:${port}`).href;
  await page.route(url, (route: { abort(errorCode?: string): Promise<void> }) =>
    route.abort("blockedbyclient"),
  );
  await page.goto(mapPath());
  return { context, page };
}

test("built map exposes landmarks, structured alternatives, labels, and logical focus without SVG traps", async ({
  page,
}) => {
  await openMap(page);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
    "href",
    "#main-content",
  );
  await expect(
    page.getByRole("navigation", { name: "Explore visualization modes" }).getByRole("link"),
  ).toHaveCount(4);
  await expect(
    page.getByRole("navigation", { name: "Decision path index" }).getByRole("link"),
  ).toHaveCount(8);
  await expect(
    page.getByRole("navigation", { name: "Decision lane index" }).getByRole("link"),
  ).toHaveCount(8);
  await expect(page.getByRole("region", { name: "Lane by process-gate matrix" })).toContainText(
    "Scroll horizontally",
  );
  await expect(
    page.getByRole("region", { name: "Complete impact and flexibility material table" }),
  ).toContainText("Scroll horizontally");
  await expect(page.getByRole("table", { name: "Complete direct-reference matrix" })).toBeVisible();
  await expect(
    page.getByRole("table", { name: /All materials in categorical order/u }),
  ).toBeVisible();
  await expect(page.locator("svg [tabindex], svg a, svg button")).toHaveCount(0);
  const liveStatus = page.locator('.map-explorer [role="status"]');
  await expect(liveStatus).toHaveCount(1);
  await expect(liveStatus).toHaveText("Interactive map controls are ready.");

  await page.getByRole("button", { name: `Highlight ${projection.lanes[0]!.label}` }).click();
  await expect(liveStatus).toHaveText("Decision lane selected.");
  await page.getByLabel("Find a material in the impact-flex view").fill("PLA");
  await expect(liveStatus).toHaveText("Impact and flexibility filter updated.");

  const targets = page.locator(
    ".map-page a:visible, .map-page button:visible, .map-page select:visible, .map-page input:visible, .map-page summary:visible, .breadcrumbs a:visible, .site-identity__name:visible",
  );
  const undersized = await targets.evaluateAll((elements: Element[]) =>
    elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width < 44 || rect.height < 44
        ? [element.textContent?.trim() ?? element.tagName]
        : [];
    }),
  );
  expect(undersized).toEqual([]);

  const thermalSearch = page.getByLabel("Find a material in this thermal view");
  await thermalSearch.focus();
  await thermalSearch.fill(projection.serviceGuidance.records[0]!.material.name);
  await page.waitForTimeout(50);
  await expect(thermalSearch).toBeFocused();
  await page.getByLabel("Service guidance order").focus();
  await page.getByLabel("Service guidance order").selectOption("high-endpoint");
  await expect(page.getByLabel("Service guidance order")).toBeFocused();
  const scrollRegion = page.getByRole("region", { name: "Practical service guidance diagram" });
  await scrollRegion.focus();
  await scrollRegion.evaluate((element: HTMLElement) => (element.scrollLeft = 80));
  await expect(scrollRegion).toBeFocused();

  await page.getByRole("link", { name: "Process gates", exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp("#process-gates$", "u"));
  await expect(page.locator(":target")).toHaveAttribute("id", "process-gates");
});

test("axe passes the default, lane, thermal, and process-gate states", async ({ page }) => {
  test.setTimeout(180_000);
  await openMap(page);
  await axe(page);

  const lane = projection.lanes[0]!;
  await page.getByRole("button", { name: `Highlight ${lane.label}` }).click();
  await axe(page);

  await page.getByRole("radio", { name: "Named thermal observations" }).check();
  await page
    .getByLabel("Named metric and method group", { exact: true })
    .selectOption(projection.thermalGroups[0]!.id);
  await axe(page);

  await page
    .getByLabel("Highlight a process gate")
    .selectOption(projection.processGates.gates[0]!.id);
  await axe(page);
});

test("axe passes filtered impact states and the real-component omission/recovery fixture", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openMap(page);
  const expert = projection.impactFlex.records.find(
    ({ printDifficulty }) => printDifficulty === "expert",
  );
  if (expert === undefined) throw new Error("MAP_EXPERT_RECORD_MISSING");
  await page
    .getByRole("button", {
      name: new RegExp(
        `^Highlight ${expert.material.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\.`,
        "u",
      ),
    })
    .last()
    .click();
  await page.getByLabel("Maximum print difficulty").last().selectOption("easy");
  await expect(
    page.getByText("Selected record is outside the current diagram filter.", { exact: true }),
  ).toBeVisible();
  await axe(page);

  await page
    .getByLabel("Find a material in the impact-flex view")
    .fill("controlled zero result query");
  await axe(page);

  const fixture = renderMapOmissionRecoveryDocument(basePath);
  await page.setContent(fixture.html);
  await expect(page.getByRole("alert")).toContainText(
    "The map view was reset because its previous state is no longer available.",
  );
  await expect(page.getByText(fixture.omissionReason, { exact: false }).last()).toBeVisible();
  expect(
    await page.locator(`[data-material-id="${fixture.omittedMaterialId}"]`).count(),
  ).toBeGreaterThan(0);
  await axe(page);
});

test("no-script and failed hydration retain complete static meaning", async ({ browser }) => {
  const noScript = await openWithoutJavaScript(browser);
  await expect(noScript.page.getByRole("heading", { level: 1 })).toHaveText(
    "Compare materials, then trace the engineering tradeoffs",
  );
  expect(readFileSync(resolve(outputRoot, "map/index.html"), "utf8")).toContain(
    "Interactive highlighting is unavailable. All decision paths and structured visualization data remain readable below.",
  );
  await expect(noScript.page.locator("[data-decision-lane]")).toHaveCount(8);
  await expect(noScript.page.locator("[data-service-row]")).toHaveCount(23);
  await expect(noScript.page.locator("[data-gate-cell]")).toHaveCount(64);
  await expect(noScript.page.locator("[data-impact-row]")).toHaveCount(23);
  expect(await noScript.page.getByText(/controls are preparing/u).count()).toBeGreaterThan(0);
  await noScript.context.close();

  const aborted = await openWithMapChunkAborted(browser);
  expect(await aborted.page.getByText(/controls are preparing/u).count()).toBeGreaterThan(0);
  await expect(aborted.page.locator("[data-decision-lane]")).toHaveCount(8);
  await expect(aborted.page.locator("[data-service-row]")).toHaveCount(23);
  await expect(aborted.page.locator("[data-gate-cell]")).toHaveCount(64);
  await expect(aborted.page.locator("[data-impact-row]")).toHaveCount(23);
  await aborted.context.close();
});

test("320px reflow, 200 percent zoom, and long labels avoid page overflow or clipping", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openMap(page);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).minWidth)).toBe(
    "0px",
  );
  await page.evaluate(() => (document.documentElement.style.scrollbarGutter = "stable"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const compactGeometry = await page.evaluate(() => {
    const body = document.body.getBoundingClientRect();
    return {
      bodyLeft: body.left,
      bodyRight: body.right,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  expect(compactGeometry.bodyLeft).toBeGreaterThanOrEqual(0);
  expect(compactGeometry.bodyRight).toBeLessThanOrEqual(compactGeometry.clientWidth);

  const typeRoles = await page.evaluate(() => ({
    display: getComputedStyle(document.querySelector(".map-hero h1")!).fontSize,
    heading: getComputedStyle(document.querySelector(".map-mode__header h2")!).fontSize,
    diagram: getComputedStyle(document.querySelector(".thermal-service-diagram text")!).fontSize,
  }));
  expect(typeRoles).toEqual({ display: "32px", heading: "24px", diagram: "14px" });
  const longLabel = page
    .getByRole("navigation", { name: "Decision path index" })
    .getByRole("link")
    .first();
  await longLabel.evaluate((element: Element) => {
    const strong = element.querySelector("strong");
    if (strong !== null)
      strong.textContent =
        "A deliberately long decision path label that must wrap without clipping any relevant words";
  });
  const longBox = await longLabel.evaluate((element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      scrollWidth: element.scrollWidth,
      width: rect.width,
      overflow: style.overflow,
      overflowX: style.overflowX,
    };
  });
  expect(longBox.scrollWidth).toBeLessThanOrEqual(Math.ceil(longBox.width));
  expect(["hidden", "clip"]).not.toContain(longBox.overflow);
  expect(["hidden", "clip"]).not.toContain(longBox.overflowX);

  await page.setViewportSize({ width: 640, height: 900 });
  await page.evaluate(() => (document.body.style.zoom = "2"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("forced colors and reduced motion preserve non-color meaning without position animation", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await openMap(page);
  await page.getByRole("button", { name: `Highlight ${projection.lanes[0]!.label}` }).click();
  await expect(page.getByText("Selected decision lane", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Process-gate relationship legend")).toContainText(
    "Applies — verify this gate",
  );
  await expect(page.getByLabel("Process-gate relationship legend")).toContainText(
    "Not listed for this lane",
  );
  await expect(page.getByLabel("Impact-flex mark legend")).toContainText(
    "Conditional — review conditions",
  );
  const motion = await page.locator(".map-page *").evaluateAll((elements: Element[]) =>
    elements.flatMap((element) => {
      const style = getComputedStyle(element);
      const duration = [
        ...style.transitionDuration.split(","),
        ...style.animationDuration.split(","),
      ].map((value) =>
        value.trim().endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000,
      );
      const positional = /(?:transform|translate|top|right|bottom|left|inset)/u.test(
        style.transitionProperty,
      );
      return Math.max(...duration, 0) > 1 || positional
        ? [{ duration: Math.max(...duration, 0), property: style.transitionProperty }]
        : [];
    }),
  );
  expect(motion).toEqual([]);
});

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 1440, height: 1000 },
] as const) {
  test(`map geometry is bounded and labels are complete at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openMap(page);
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      return {
        header: rect(".site-header"),
        hero: rect(".map-hero"),
        title: rect(".map-hero h1"),
        comparison: rect(".map-comparison"),
        firstIndex: rect(".map-lane-directory a"),
        viewportHeight: innerHeight,
        documentHeight: document.documentElement.scrollHeight,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(geometry.header.height).toBeLessThanOrEqual(geometry.viewportHeight * 0.25);
    expect(geometry.hero.height).toBeLessThanOrEqual(geometry.viewportHeight * 0.52);
    expect(geometry.title.height).toBeLessThanOrEqual(geometry.viewportHeight * 0.28);
    expect(geometry.comparison.top).toBeLessThan(geometry.viewportHeight);
    expect(geometry.comparison.height).toBeGreaterThan(0);
    expect(geometry.firstIndex.top).toBeGreaterThan(geometry.comparison.top);
    expect(geometry.firstIndex.bottom).toBeLessThanOrEqual(geometry.documentHeight);
    expect(geometry.firstIndex.bottom).toBeGreaterThan(0);
    expect(geometry.overflow).toBeLessThanOrEqual(0);

    const labels = page.locator(
      ".map-lane-directory a, .decision-lane-index a, [data-decision-lane] > header h3",
    );
    for (let index = 0; index < (await labels.count()); index += 1) {
      const label = labels.nth(index);
      await label.scrollIntoViewIfNeeded();
      const result = await label.evaluate((element: HTMLElement) => {
        const own = element.getBoundingClientRect();
        const textNode = element.querySelector("strong") ?? element;
        const text = textNode.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          contained:
            text.left >= own.left - 1 &&
            text.right <= own.right + 1 &&
            text.top >= own.top - 1 &&
            text.bottom <= own.bottom + 1,
          overflow: style.overflow,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
        };
      });
      expect(result.contained).toBe(true);
      expect(["hidden", "clip"]).not.toContain(result.overflow);
      expect(["hidden", "clip"]).not.toContain(result.overflowX);
      expect(["hidden", "clip"]).not.toContain(result.overflowY);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
}

test("test-only omission harness has no production route or build-graph reference", async () => {
  for (const relative of ["map/index.html", "index.html"]) {
    const html = readFileSync(resolve(outputRoot, relative), "utf8");
    expect(html).not.toContain("render-map-state");
    expect(html).not.toContain("phase8OmissionRecoveryProjection");
    expect(html).not.toContain("controlled test projection");
  }
});
