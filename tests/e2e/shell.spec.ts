import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import playwrightTest from "@playwright/test";
import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "playwright/types/test";

type Page = PlaywrightTestArgs["page"];
type Browser = PlaywrightWorkerArgs["browser"];

const test = playwrightTest as unknown as TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;
// Astro check currently resolves only the default runtime export for this ESM
// package. The suite still receives fixture types from Playwright's public
// declarations; this narrow cast keeps the runtime matcher surface intact.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const expect = (playwrightTest as unknown as { expect: (...args: any[]) => any }).expect;

const mode = process.env.ATLAS_TEST_MODE;
if (mode !== "root" && mode !== "repository") throw new Error("ATLAS_TEST_MODE_INVALID");

const basePath = mode === "root" ? "/" : "/atlas-preview/";
const port = mode === "root" ? 4321 : 4322;
const origin = `http://127.0.0.1:${port}`;
const baseURL = new URL(basePath, origin).href;
const outputRoot = resolve(`dist-test/${mode}`);

function generatedTracerPath(): string {
  const material = readdirSync(resolve(outputRoot, "materials"), { withFileTypes: true })
    .find((entry) => entry.isDirectory());
  expect(material?.name).toBeTruthy();
  return `${basePath}materials/${material!.name}/`;
}

async function openNoScriptPage(browser: Browser, path: string): Promise<Page> {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

function attachNetworkGate(page: Page): () => void {
  const failures: string[] = [];
  page.on("requestfailed", (request: { url(): string }) => {
    if (new URL(request.url()).origin === origin) failures.push("request-failed");
  });
  page.on("response", (response: { url(): string; ok(): boolean; request(): { resourceType(): string } }) => {
    const url = new URL(response.url());
    if (url.origin !== origin) {
      failures.push("remote-request");
      return;
    }
    if (!response.ok()) failures.push("response-failed");
    if (!url.pathname.startsWith(basePath)) {
      failures.push("base-path-missing");
      return;
    }
    const logical = url.pathname.slice(basePath.length);
    const relativeFile = logical === "" || logical.endsWith("/") ? `${logical}index.html` : logical;
    if (!existsSync(resolve(outputRoot, relativeFile))) failures.push("inventory-miss");
  });
  return () => expect(failures, "all browser requests must be local, successful, static, and inventoried").toEqual([]);
}

async function expectFocusedAndVisible(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return { visible: false, outline: "0px" };
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const center = document.elementFromPoint(
      Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2)),
      Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2)),
    );
    return {
      visible:
        rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 &&
        rect.right <= innerWidth && rect.bottom <= innerHeight && center !== null &&
        (center === element || element.contains(center) || center.contains(element)),
      outline: style.outlineWidth,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      viewport: { width: innerWidth, height: innerHeight },
      centerTag: center?.tagName ?? null,
    };
  });
  expect(result.visible, JSON.stringify(result)).toBe(true);
  expect(result.outline).toBe("3px");
}

test("home and tracer remain complete semantic documents without JavaScript", async ({ browser }) => {
  const home = await openNoScriptPage(browser, "./");
  const homeTitle = await home.title();
  await expect(home.locator(".site-header")).toHaveCount(1);
  await expect(home.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(1);
  await expect(home.getByRole("main")).toHaveCount(1);
  await expect(home.locator("footer")).toHaveCount(1);
  await expect(home.locator("h1:visible")).toHaveCount(1);
  await expect(home.getByRole("link", { name: "Material selector" }).first()).toHaveAttribute("aria-current", "page");
  await expect(home.getByRole("button", { name: "View recommendations" })).toBeDisabled();

  const tracer = await openNoScriptPage(browser, new URL(generatedTracerPath(), origin).href);
  expect(await tracer.title()).not.toBe(homeTitle);
  await expect(tracer.locator("h1:visible")).toHaveCount(1);
  await expect(tracer.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
  await expect(tracer.getByRole("link", { name: "Material tracer" }).first()).toHaveAttribute("aria-current", "page");
  await expect(tracer.getByRole("link", { name: "Return to atlas home" })).toBeVisible();
  await home.context().close();
  await tracer.context().close();
});

test("skip navigation and focus order work at wide, compact, and reflow sizes", async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 800, zoom: "100%" },
    { width: 320, height: 720, zoom: "100%" },
    { width: 640, height: 720, zoom: "200%" },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("./");
    await page.evaluate((zoom: string) => { document.documentElement.style.zoom = zoom; }, viewport.zoom);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await expectFocusedAndVisible(page);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose a material that fits your process");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test("home and a generated tracer load only successful inventoried same-origin resources", async ({ page }) => {
  const assertNetwork = attachNetworkGate(page);
  await page.goto("./");
  await page.goto(generatedTracerPath());
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  assertNetwork();
});
