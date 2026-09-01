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

  it("neutralizes script termination characters without changing the parsed string", () => {
    const adversarial = [1, ["</script><script>bad()</script>"], [0, 0]] as SelectorClientModel;
    const serialized = serializeSelectorDeferredPayload(adversarial);

    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized)).toEqual(adversarial);
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
