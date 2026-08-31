import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/method/index.astro", "utf8");
const css = readFileSync("src/styles/method.css", "utf8");

describe("method page source", () => {
  it("builds one complete static model in the shared shell", () => {
    expect(page).toContain("buildMethodPageModel(loadPublicAtlas(), base)");
    expect(page).toContain("<MethodReference model={model} />");
    expect(page).toContain('canonicalPath={model.href}');
    expect(page).toContain('internalHref(base, { id: "home" })');
    expect(page).toContain('internalHref(base, { id: "materials" })');
    for (const forbidden of ["client:", "fetch(", "set:html", "window.", "document."]) expect(page).not.toContain(forbidden);
  });

  it("provides approved orientation, shell links, and a single h1", () => {
    expect(page.match(/<h1/g)).toHaveLength(1);
    expect(page).toContain("Method and evidence");
    expect(page).toContain("Material selector");
    expect(page).toContain("Material atlas");
    expect(page).toContain("current: true");
  });

  it("keeps dense content readable without changing compact DOM order", () => {
    expect(css).toContain("720px");
    expect(css).toContain("minmax(220px, 280px)");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("@media (max-width: 63.999rem)");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toContain("order:");
    expect(css).not.toContain("position: sticky");
  });
});
