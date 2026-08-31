import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/materials/MaterialReference.astro", "utf8");

describe("material reference component contract", () => {
  it("renders every semantic section in the approved order", () => {
    const fragments = ["overview", "thermal", "properties", "process", "uses-tradeoffs", "starting-profile", "evidence", "limitations", "relationships"];
    let previous = -1;
    for (const fragment of fragments) {
      const position = source.indexOf(`id=\"${fragment}\"`);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
    expect(source).toContain("<h1");
    expect(source).toContain("model.thermal.serviceGuidance");
    expect(source).toContain("model.thermal.namedObservations");
    expect(source).toContain("model.startingProfile.cautionBefore");
    expect(source).toContain("model.startingProfile.cautionAfter");
    expect(source).toContain("model.limitations");
  });

  it("keeps claim state, qualification, scope, evidence, and anchors adjacent", () => {
    expect(source).toContain("claim.anchor");
    expect(source).toContain("claim.fact.state");
    expect(source).toContain("claim.qualification");
    expect(source).toContain("claim.scopes");
    expect(source).toContain("claim.evidence");
    expect(source).toContain("basis.href");
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).toContain("External source");
  });

  it("is static, escaped, and interpretation-free", () => {
    for (const forbidden of ["client:", "fetch(", "set:html", "dangerouslySetInnerHTML", "loadPublicAtlas", "atlas.v1.json", "window.", "document."]) expect(source).not.toContain(forbidden);
  });
});
