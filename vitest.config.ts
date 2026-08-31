/// <reference types="vitest/config" />

import { getViteConfig } from "astro/config";

export default getViteConfig({
  test: {
    environment: "node",
    include: [
      "tests/data/**/*.test.ts",
      "tests/app/**/*.test.ts",
      "tests/components/**/*.test.ts",
    ],
  },
});
