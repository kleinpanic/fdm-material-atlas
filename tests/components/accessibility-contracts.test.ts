import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";

import FactStateValue from "../../src/components/data/FactStateValue.astro";
import StateMarker from "../../src/components/data/StateMarker.astro";

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

describe("state marker accessibility contract", () => {
  const variants = [
    ["information", "Information", "circle-information"],
    ["verify", "Verify", "triangle-warning"],
    ["incompatible", "Incompatible", "octagon-cross"],
    ["unknown", "Unknown", "dashed-question"],
    ["not-applicable", "Not applicable", "dash"],
    ["available", "Available", "circle-check"],
    ["blocked", "Blocked", "octagon-cross"],
  ] as const;

  it.each(variants)("renders %s as visible text plus a hidden duplicate glyph", async (variant, label, shape) => {
    const html = await container.renderToString(StateMarker, {
      props: { variant, label },
    });

    expect(html).toContain(`>${label}</span>`);
    expect(html).toContain(`data-marker-shape="${shape}"`);
    expect(html).toContain("aria-hidden=\"true\"");
    expect(html).not.toContain("role=\"status\"");
    expect(html).not.toContain(" title=");
  });

  it("escapes state label text instead of accepting source HTML", async () => {
    const html = await container.renderToString(StateMarker, {
      props: {
        variant: "verify",
        label: '<img src=x onerror="alert(1)">',
      },
    });

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img");
  });
});

describe("fact state accessibility contract", () => {
  it.each([
    [{ state: "known", value: 0 }, "0"],
    [{ state: "known", value: false }, "False"],
  ] as const)("preserves a known falsey value", async (fact, expected) => {
    const html = await container.renderToString(FactStateValue, { props: { fact } });

    expect(html).toContain('data-fact-state="known"');
    expect(html).toContain(`class="fact-state-value__value">${expected}</span>`);
    expect(html).toContain(">Available</span>");
  });

  it.each([
    [{ state: "unknown", reason: "No comparable test was reported." }, "Unknown"],
    [{ state: "conditional", condition: "Only after annealing." }, "Conditional"],
    [{ state: "not-applicable", reason: "The process does not use a heated bed." }, "Not applicable"],
    [{ state: "missing", reason: "The source does not report this field." }, "Not reported"],
  ] as const)("renders the approved explanatory state label", async (fact, label) => {
    const html = await container.renderToString(FactStateValue, { props: { fact } });

    expect(html).toContain(`data-fact-state="${fact.state}"`);
    expect(html).toContain(`>${label}</span>`);
    expect(html).toContain("data-marker-shape=");
    expect(html).not.toContain("role=\"status\"");
  });

  it("renders a conditional value and its condition without conflating either with known data", async () => {
    const html = await container.renderToString(FactStateValue, {
      props: {
        fact: { state: "conditional", condition: "When printed dry.", value: "Stable" },
      },
    });

    expect(html).toContain(">Conditional</span>");
    expect(html).toContain(">Stable</span>");
    expect(html).toContain(">When printed dry.</span>");
  });
});
