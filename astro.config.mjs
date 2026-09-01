import tailwindcss from "@tailwindcss/vite";
import preact from "@astrojs/preact";
import { defineConfig, fontProviders } from "astro/config";

const DEFAULT_SITE_ORIGIN = "https://atlas.example";

/**
 * Accept only canonical absolute path prefixes. The trailing slash is part of
 * the deployment contract so Astro cannot silently normalize an ambiguous
 * value differently between local and Pages builds.
 *
 * @param {string | undefined} value
 * @returns {string}
 */
export function validateSiteBasePath(value) {
  const candidate = value ?? "/";

  if (candidate === "/") {
    return candidate;
  }

  if (
    !candidate.startsWith("/") ||
    !candidate.endsWith("/") ||
    candidate.includes("//") ||
    candidate.includes("\\") ||
    candidate.includes("%") ||
    candidate.includes("?") ||
    candidate.includes("#")
  ) {
    throw new Error("SITE_BASE_PATH_INVALID");
  }

  const segments = candidate.slice(1, -1).split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9._~-]+$/.test(segment),
    )
  ) {
    throw new Error("SITE_BASE_PATH_INVALID");
  }

  return candidate;
}

/**
 * Accept an already-normalized HTTPS origin only. Paths, credentials, query
 * strings, and fragments are rejected before they can influence public URLs.
 *
 * @param {string | undefined} value
 * @returns {string}
 */
export function validateSiteOrigin(value) {
  const candidate = value ?? DEFAULT_SITE_ORIGIN;
  let parsed;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("SITE_ORIGIN_INVALID");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.origin !== candidate
  ) {
    throw new Error("SITE_ORIGIN_INVALID");
  }

  return candidate;
}

const base = validateSiteBasePath(process.env.SITE_BASE_PATH);
const site = validateSiteOrigin(process.env.SITE_ORIGIN);

export default defineConfig({
  output: "static",
  site,
  base,
  trailingSlash: "always",
  integrations: [preact()],
  build: {
    format: "directory",
  },
  fonts: [
    {
      provider: fontProviders.npm({ remote: false }),
      name: "IBM Plex Sans Variable",
      cssVariable: "--font-plex-sans",
      weights: [400, 600],
      styles: ["normal"],
      subsets: ["latin"],
      formats: ["woff2"],
      fallbacks: ["system-ui", "sans-serif"],
      options: {
        package: "@fontsource-variable/ibm-plex-sans",
        file: "wght.css",
      },
    },
    {
      provider: fontProviders.npm({ remote: false }),
      name: "IBM Plex Mono",
      cssVariable: "--font-plex-mono",
      weights: [400, 600],
      styles: ["normal"],
      subsets: ["latin"],
      formats: ["woff2"],
      fallbacks: ["ui-monospace", "monospace"],
      options: {
        package: "@fontsource/ibm-plex-mono",
      },
    },
  ],
  vite: {
    plugins: [tailwindcss()],
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("/src/domain/selector/") || id.includes("/src/features/selector/")) {
              return "selector-runtime";
            }
          },
        },
      },
    },
  },
});
