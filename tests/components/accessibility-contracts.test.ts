import { readFile, readdir } from "node:fs/promises";

import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";

import FactStateValue from "../../src/components/data/FactStateValue.astro";
import MeaningfulFigure from "../../src/components/data/MeaningfulFigure.astro";
import StateMarker from "../../src/components/data/StateMarker.astro";
import TechnicalTable from "../../src/components/data/TechnicalTable.astro";
import AccessibilitySpecimens from "../fixtures/accessibility-specimens.astro";

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

  it.each(variants)(
    "renders %s as visible text plus a hidden duplicate glyph",
    async (variant, label, shape) => {
      const html = await container.renderToString(StateMarker, {
        props: { variant, label },
      });

      expect(html).toContain(`>${label}</span>`);
      expect(html).toContain(`data-marker-shape="${shape}"`);
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toContain('role="status"');
      expect(html).not.toContain(" title=");
    },
  );

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
    expect(html).toMatch(new RegExp(`class="fact-state-value__value"[^>]*>${expected}</span>`));
    expect(html).toContain(">Available</span>");
  });

  it.each([
    [{ state: "unknown", reason: "No comparable test was reported." }, "Unknown"],
    [{ state: "conditional", condition: "Only after annealing." }, "Conditional"],
    [
      { state: "not-applicable", reason: "The process does not use a heated bed." },
      "Not applicable",
    ],
    [{ state: "missing", reason: "The source does not report this field." }, "Not reported"],
  ] as const)("renders the approved explanatory state label", async (fact, label) => {
    const html = await container.renderToString(FactStateValue, { props: { fact } });

    expect(html).toContain(`data-fact-state="${fact.state}"`);
    expect(html).toContain(`>${label}</span>`);
    expect(html).toContain("data-marker-shape=");
    expect(html).not.toContain('role="status"');
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

describe("technical table accessibility contract", () => {
  it("owns a named overflow region and native captioned table structure", async () => {
    const html = await container.renderToString(TechnicalTable, {
      props: {
        id: "process-window",
        caption: "Starting process window",
        scrollLabel: "Starting process window table",
        scrollGuidance: "Scroll horizontally to read all process settings.",
      },
      slots: {
        header: '<tr><th scope="col">Material</th><th scope="col">Nozzle</th></tr>',
        body: '<tr><th scope="row">Specimen polymer</th><td>Not reported</td></tr>',
      },
    });

    expect(html).toContain('class="data-overflow"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Starting process window table"');
    expect(html).toContain('aria-describedby="process-window-scroll-guidance"');
    expect(html).toContain('id="process-window-scroll-guidance"');
    expect(html).toContain("Scroll horizontally to read all process settings.");
    expect(html).toContain("<table");
    expect(html).toContain("<caption>Starting process window</caption>");
    expect(html).toContain("<thead>");
    expect(html).toContain('scope="col"');
    expect(html).toContain("<tbody>");
    expect(html).toContain('scope="row"');
    expect(html).toContain(">Not reported</td>");
  });
});

describe("meaningful figure accessibility contract", () => {
  it("binds one SVG title and description to a complete static alternative", async () => {
    const html = await container.renderToString(MeaningfulFigure, {
      props: {
        id: "thermal-observation",
        title: "Named thermal observations",
        description: "Separate markers show unlike thermal metrics.",
        legendLabel: "Thermal metric legend",
        alternativeLabel: "Thermal observations as text",
      },
      slots: {
        graphic: '<circle cx="10" cy="10" r="4"></circle>',
        legend: '<ul><li><span aria-hidden="true">●</span> Glass transition</li></ul>',
        alternative: "<dl><dt>Glass transition</dt><dd>Named observation</dd></dl>",
      },
    });

    expect(html.match(/<title\b/gu)).toHaveLength(1);
    expect(html.match(/<desc\b/gu)).toHaveLength(1);
    expect(html).toContain('role="img"');
    expect(html).toContain(
      'aria-labelledby="thermal-observation-title thermal-observation-description"',
    );
    expect(html).toContain('id="thermal-observation-title">Named thermal observations</title>');
    expect(html).toContain(
      'id="thermal-observation-description">Separate markers show unlike thermal metrics.</desc>',
    );
    expect(html).toContain('focusable="false"');
    expect(html).not.toContain('tabindex="0"');
    expect(html).toContain('class="meaningful-figure__marks" aria-hidden="true"');
    expect(html).toContain('aria-label="Thermal metric legend"');
    expect(html).toContain("Glass transition");
    expect(html).toContain('aria-label="Thermal observations as text"');
    expect(html).toContain("<dl>");
  });
});

describe("non-routed accessibility specimens", () => {
  it("keeps required popover information in an inline fallback", async () => {
    const html = await container.renderToString(AccessibilitySpecimens);

    expect(html).toContain(
      '<button type="button" aria-expanded="false" aria-controls="verification-popover"',
    );
    expect(html).toContain(">Explain verification status</button>");
    expect(html).toContain('id="verification-popover"');
    expect(html).toContain("popover");
    expect(html).toContain('data-static-fallback="verification-popover"');
    expect(html).toContain(
      "Verify the manufacturer data sheet before a safety-critical selection.",
    );
  });

  it("demonstrates a named native dialog with the safe action first", async () => {
    const html = await container.renderToString(AccessibilitySpecimens);

    expect(html).toContain('<dialog aria-labelledby="comparison-dialog-title"');
    expect(html).toContain('id="comparison-dialog-title"');
    const safeAction = html.indexOf(">Keep editing</button>");
    const continueAction = html.indexOf(">Continue to comparison</button>");
    expect(safeAction).toBeGreaterThan(-1);
    expect(continueAction).toBeGreaterThan(safeAction);
    expect(html).not.toMatch(/delete|remove|discard/iu);
  });

  it("composes the production primitives while remaining static and outside routes", async () => {
    const html = await container.renderToString(AccessibilitySpecimens);
    const fixtureUrl = new URL("../fixtures/accessibility-specimens.astro", import.meta.url);
    const source = await readFile(fixtureUrl, "utf8");
    const pageFiles = await readdir(new URL("../../src/pages/", import.meta.url), {
      recursive: true,
    }).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    });

    expect(html).toContain('data-marker-variant="verify"');
    expect(html).toContain('data-fact-state="missing"');
    expect(html).toContain("<table");
    expect(html).toContain('class="meaningful-figure"');
    expect(source).not.toMatch(/client:/u);
    expect(source).not.toMatch(/<script\b/iu);
    expect(source).not.toMatch(/theme\s*toggle|global\s*store/iu);
    expect(fixtureUrl.pathname).toContain("/tests/fixtures/");
    expect(fixtureUrl.pathname).not.toContain("/src/pages/");
    expect(pageFiles).not.toContain("accessibility-specimens.astro");
  });
});
