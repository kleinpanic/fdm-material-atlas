import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};

describe("Phase 7 smoke script", () => {
  it("includes comparison, explorer, detail-continuity, and its own contract suites", () => {
    const smoke = packageJson.scripts["test:phase7-smoke"] ?? "";
    expect(smoke).toContain("tests/app/material-detail-continuity.test.ts");
    expect(smoke).toContain("tests/app/material-detail-model.test.ts");
    expect(smoke).toContain("tests/components/material-detail-contract.test.ts");
    expect(smoke).toContain("tests/app/phase7-smoke-script.test.ts");
  });
});
