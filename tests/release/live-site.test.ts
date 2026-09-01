import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { captureLiveSurface } from "../../tools/verify-live-site.mjs";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))));

async function site(routes: Record<string, { type: string; body: string; status?: number; location?: string }>) {
  const server = createServer((request, response) => {
    const route = routes[request.url ?? "/"] ?? { type: "text/plain", body: "missing", status: 404 };
    response.statusCode = route.status ?? 200;
    response.setHeader("content-type", route.type);
    if (route.location) response.setHeader("location", route.location);
    response.end(route.body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server unavailable");
  return `http://127.0.0.1:${address.port}/atlas/`;
}

function document(extra = "") {
  return `<!doctype html><html><head><title>FDM Material Atlas</title><link rel="stylesheet" href="/atlas/_astro/app.12345678.css"></head><body><main id="main-content">FDM Material Atlas ${extra}</main></body></html>`;
}

describe("bounded live surface capture", () => {
  it("captures required routes and recursively referenced same-origin assets", async () => {
    const origin = await site({
      "/atlas/": { type: "text/html", body: document('<a href="/atlas/materials/pla/">PLA</a>') },
      "/atlas/materials/": { type: "text/html", body: document() },
      "/atlas/materials/pla/": { type: "text/html", body: document() },
      "/atlas/compare/": { type: "text/html", body: document() },
      "/atlas/data/": { type: "text/html", body: document() },
      "/atlas/map/": { type: "text/html", body: document() },
      "/atlas/method/": { type: "text/html", body: document() },
      "/atlas/_astro/app.12345678.css": { type: "text/css", body: "body{color:#123}" },
    });
    const result = await captureLiveSurface({ pagesUrl: origin, synthetic: true, exactPatterns: [Buffer.from("protected-value")] });
    expect(result).toMatchObject({ ok: true, routeCount: 7, assetCount: 1, findingCount: 0 });
  });

  it.each([
    ["cross-origin redirect", { "/atlas/": { type: "text/html", body: "", status: 302, location: "https://example.test/" } }, "LIVE_REDIRECT_ORIGIN"],
    ["source map", { "/atlas/_astro/app.12345678.css.map": { type: "application/json", body: "{}" } }, "LIVE_SOURCE_MAP"],
  ])("rejects %s", async (_label, override, code) => {
    const routes: Record<string, { type: string; body: string; status?: number; location?: string }> = {
      "/atlas/": { type: "text/html", body: document() },
      "/atlas/materials/": { type: "text/html", body: document() },
      "/atlas/compare/": { type: "text/html", body: document() },
      "/atlas/data/": { type: "text/html", body: document() },
      "/atlas/map/": { type: "text/html", body: document() },
      "/atlas/method/": { type: "text/html", body: document() },
      "/atlas/materials/pla/": { type: "text/html", body: document() },
      "/atlas/_astro/app.12345678.css": { type: "text/css", body: "body{}" },
      ...override,
    };
    if (code === "LIVE_SOURCE_MAP") routes["/atlas/"].body = document('<script src="/atlas/_astro/app.12345678.css.map"></script>');
    const origin = await site(routes);
    await expect(captureLiveSurface({ pagesUrl: origin, synthetic: true, exactPatterns: [] })).rejects.toMatchObject({ code });
  });

  it("rejects protected bytes without echoing them", async () => {
    const marker = "do-not-echo-private-value";
    const origin = await site({ "/atlas/": { type: "text/html", body: document(marker) } });
    let message = "";
    await captureLiveSurface({ pagesUrl: origin, synthetic: true, exactPatterns: [Buffer.from(marker)] }).catch((error) => { message = String(error); });
    expect(message).toContain("LIVE_PROTECTED_CONTENT");
    expect(message).not.toContain(marker);
  });
});
