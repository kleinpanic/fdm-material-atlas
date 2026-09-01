import playwrightTest from "@playwright/test";
import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "playwright/types/test";

import { discoverReleaseRoutes } from "./release-route-fixtures.ts";

const test = playwrightTest as unknown as TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const expect = (playwrightTest as unknown as { expect: (...args: any[]) => any }).expect;

const mode = process.env.ATLAS_TEST_MODE;
if (mode !== "root" && mode !== "repository") throw new Error("ATLAS_TEST_MODE_INVALID");

test("representative release surfaces have an explicit accessibility gate", async () => {
  const routes = discoverReleaseRoutes(mode);
  expect([
    routes.home,
    routes.materials,
    routes.representativeMaterial,
    routes.compare,
    routes.data,
    routes.map,
    routes.method,
  ]).toHaveLength(0);
});
