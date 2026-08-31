import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/method/MethodReference.astro", "utf8");

describe("method reference component contract", () => {
  it("renders all interpretation sections in approved order", () => {
    const ids = ["evidence-scopes", "thermal-metrics", "selector-scoring", "qualitative-guidance", "starting-profiles", "methods", "sources", "limitations"];
    let previous = -1;
    for (const id of ids) {
      const position = source.indexOf(`id=\"${id}\"`);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
    for (const field of ["model.copy.orientation", "model.copy.evidenceScopes", "model.copy.thermalConcepts", "model.copy.factStates", "model.methods", "model.sources", "model.copy.cautions"]) expect(source).toContain(field);
  });

  it("uses semantic tables and complete safe evidence actions", () => {
    expect(source.match(/<TechnicalTable/g)).toHaveLength(2);
    expect(source).toContain('scope="col"');
    expect(source).toContain("record.anchor");
    expect(source).toContain("record.uses");
    expect(source).toContain("use.href");
    expect(source).toContain("record.externalAction.url");
    expect(source).toContain("record.externalAction.label");
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).toMatch(/opens in a new tab/i);
  });

  it("stays static, escaped, and interpretation-free", () => {
    for (const forbidden of ["client:", "fetch(", "set:html", "dangerouslySetInnerHTML", "loadPublicAtlas", "window.", "document.", "heat score"]) expect(source).not.toContain(forbidden);
  });
});
