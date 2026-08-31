import type { PlaywrightTestConfig } from "playwright/types/test";

const TEST_MODES = {
  root: {
    port: 4321,
    basePath: "/",
    buildOutput: "dist-test/root",
    resultOutput: "test-results/root",
    previewCommand: "npm run preview:root",
  },
  repository: {
    port: 4322,
    basePath: "/atlas-preview/",
    buildOutput: "dist-test/repository",
    resultOutput: "test-results/repository",
    previewCommand: "npm run preview:repository",
  },
} as const;

export type AtlasTestMode = keyof typeof TEST_MODES;

export function readAtlasTestMode(value: string | undefined): AtlasTestMode {
  if (value !== "root" && value !== "repository") {
    throw new Error("ATLAS_TEST_MODE_INVALID");
  }

  return value;
}

const mode = readAtlasTestMode(process.env.ATLAS_TEST_MODE);
const selected = TEST_MODES[mode];
const localOrigin = `http://127.0.0.1:${selected.port}`;
const baseURL = new URL(selected.basePath, localOrigin).href;

const config = {
  testDir: "tests/e2e",
  outputDir: selected.resultOutput,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: {
    command: selected.previewCommand,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  metadata: {
    atlasMode: mode,
    buildOutput: selected.buildOutput,
    basePath: selected.basePath,
    port: selected.port,
  },
} satisfies PlaywrightTestConfig;

export default config;
