import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import packageManifest from "../../package.json";
import { loadPublicationPolicy } from "../../tools/lib/publication-policy.mjs";
import { scanBytes } from "../../tools/scan-publication.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const README_PATH = resolve(ROOT, "README.md");
const MAINTAINING_PATH = resolve(ROOT, "docs/MAINTAINING.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function expectSubjects(document: string, subjects: readonly RegExp[]): void {
  subjects.forEach((subject) => expect(document).toMatch(subject));
}

function markdownLinks(document: string): readonly string[] {
  return [...document.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)].map((match) => match[1]!);
}

function documentedCommands(document: string): readonly string[] {
  return [...document.matchAll(/npm run ([a-z0-9:-]+)/gu)].map((match) => match[1]!);
}

const readmeSubjects = [
  /selector-first/iu,
  /\/materials\/.*\/materials\/<slug>\/.*\/map\/.*\/compare\/.*\/data\/.*\/method\//isu,
  /Node\.js 22/iu,
  /Astro.*TypeScript.*Tailwind/isu,
  /src\/data\/public\/atlas\.v1\.json/u,
  /schemaVersion/iu,
  /GitHub Pages/iu,
  /primary.*two points.*secondary.*one point/isu,
  /hard (?:constraints|gates).*remove/isu,
  /score-desc-material-asc|score.*material ID/isu,
  /direct product-specific.*representative product.*family-level guidance.*qualitative heuristic.*starting-profile guidance.*derived selector logic/isu,
  /Tg.*HDT.*Vicat.*melting point.*not directly (?:comparable|interchangeable)/isu,
  /formulations differ/iu,
  /geometry.*moisture.*load.*print orientation.*annealing.*chamber.*process history/isu,
  /calibration starting point/iu,
  /not.*engineering safety certification/isu,
  /docs\/MAINTAINING\.md/u,
  /no license has been selected/iu,
] as const;

const maintainerSubjects = [
  /schemaVersion.*migration/isu,
  /stable (?:public )?(?:IDs|identifiers)/iu,
  /reference integrity/iu,
  /evidence scope/iu,
  /public (?:HTTPS )?links?/iu,
  /thermal.*metric.*method.*compar/isu,
  /primary.*weight.*2.*secondary.*weight.*1/isu,
  /hard (?:constraint|gate)/iu,
  /score-desc-material-asc/iu,
  /deterministic.*serializ/isu,
  /human-readable diff/iu,
  /pull request/iu,
  /Git revert.*forward fix/isu,
  /committed public data.*no external system access/isu,
] as const;

describe("public documentation contract", () => {
  it("covers the public product, architecture, method, and limitation subjects", () => {
    expect(existsSync(README_PATH)).toBe(true);
    expectSubjects(read(README_PATH), readmeSubjects);
  });

  it("covers canonical-data maintenance, review, release, and recovery", () => {
    expect(existsSync(MAINTAINING_PATH)).toBe(true);
    expectSubjects(read(MAINTAINING_PATH), maintainerSubjects);
  });

  it("uses only real npm scripts and repository-relative links", () => {
    const documents = [README_PATH, MAINTAINING_PATH];
    for (const path of documents) {
      const document = read(path);
      documentedCommands(document).forEach((script) => {
        expect(
          packageManifest.scripts,
          `${path} documents missing script ${script}`,
        ).toHaveProperty(script);
      });
      markdownLinks(document).forEach((href) => {
        if (/^https?:\/\//u.test(href)) {
          expect(href).toMatch(/^https:\/\//u);
          return;
        }
        if (href.startsWith("#")) return;
        expect(existsSync(resolve(dirname(path), href)), `${path} has broken link ${href}`).toBe(
          true,
        );
      });
    }
  });

  it("keeps public documents source-neutral and clear of publication findings", async () => {
    const policy = await loadPublicationPolicy({ root: ROOT });
    const internalTerms = new RegExp(
      [
        "(?:^|\\W)" + ["G", "S", "D"].join("") + "(?:\\W|$)",
        ["A", "I", "[- ]agent"].join(""),
        ["spread", "sheet"].join(""),
        ["work", "book"].join(""),
        ["upstream", "(?: runtime| connection| system)"].join(""),
        ["source", "[- ]refresh"].join(""),
      ].join("|"),
      "iu",
    );

    for (const path of [README_PATH, MAINTAINING_PATH]) {
      const document = read(path);
      expect(document).not.toMatch(internalTerms);
      expect(
        scanBytes(Buffer.from(document), {
          policy,
          surface: "documentation-contract",
          location: Buffer.from("public-document"),
        }),
      ).toEqual([]);
      expect(document).not.toMatch(
        /(?:generated|deployed|published) (?:successfully|at https?:)/iu,
      );
    }
  });
});
