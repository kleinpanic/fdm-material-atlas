import { globSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import { PUBLIC_ROUTE_REGISTRY } from "../../src/lib/public-route-registry.ts";
import { buildSelectorPageModel } from "../../src/features/selector/page-model.ts";
import {
  SELECTOR_PAYLOAD_ID,
  decodeSelectorDeferredPayload,
  serializeSelectorDeferredPayload,
} from "../../src/features/selector/deferred-payload.ts";
import type { SelectorClientModel } from "../../src/features/selector/client-model.ts";

const pageModel = buildSelectorPageModel(loadPublicAtlas(), "/", PUBLIC_ROUTE_REGISTRY);

function documentWith(...contents: string[]) {
  return {
    querySelectorAll(selector: string) {
      expect(selector).toBe(`script#${SELECTOR_PAYLOAD_ID}[type="application/json"]`);
      return contents.map((textContent) => ({ tagName: "SCRIPT", textContent }));
    },
  };
}

describe("selector deferred payload", () => {
  it("round-trips the closed client model through one bounded same-document record", () => {
    const serialized = serializeSelectorDeferredPayload(pageModel);

    expect(serialized).not.toContain("<");
    expect(decodeSelectorDeferredPayload(documentWith(serialized))).toEqual(
      expect.objectContaining({ defaults: expect.any(Object), projection: expect.any(Object) }),
    );
  });

  it.each([
    "</script><script>bad()</script>",
    "</ScRiPt><script>bad()</script>",
    "> & \u2028 \u2029",
  ])("neutralizes script text %j without changing the parsed string", (value) => {
    const adversarial = [1, [value], [0, 0]] as SelectorClientModel;
    const serialized = serializeSelectorDeferredPayload(adversarial);

    expect(serialized).not.toMatch(/[<>&\u2028\u2029]/u);
    expect(serialized).not.toMatch(/<\/script/iu);
    expect(JSON.parse(serialized)).toEqual(adversarial);
  });

  it("limits raw insertion to the one reviewed generated-JSON boundary", () => {
    const uses = globSync("src/**/*.{astro,ts,tsx}").filter((file) =>
      readFileSync(file, "utf8").includes("set:html"),
    );

    expect(uses).toEqual(["src/pages/index.astro"]);
    expect(readFileSync(uses[0]!, "utf8").match(/set:html/gu)).toHaveLength(1);
  });

  it.each([
    ["missing", documentWith()],
    ["duplicate", documentWith("[]", "[]")],
    ["malformed", documentWith("not-json")],
    ["oversize", documentWith(JSON.stringify("x".repeat(70 * 1024)))],
  ])("fails closed for a %s payload", (_label, root) => {
    expect(() => decodeSelectorDeferredPayload(root)).toThrowError(
      "SELECTOR_DEFERRED_PAYLOAD_INVALID",
    );
  });
});
