#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { isMainModule } from "./lib/main-module.mjs";
import { parseReleaseEvidence, ReleaseEvidenceError } from "./lib/release-evidence.mjs";

export class ReleaseReportError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReleaseReportError";
    this.code = code;
  }
}

function fail(code) {
  throw new ReleaseReportError(code);
}

function reportObject(evidence) {
  const product = evidence.candidate.product;
  return {
    observed: {
      commitSha: evidence.commitSha,
      repository: evidence.publication.repository,
      pagesUrl: evidence.deployment.pages.url,
      materialCount: product.materialCount,
      sourceRecordCount: product.sourceRecordCount,
      stack: product.stack,
      routes: product.routes,
      selector: {
        contractVersion: product.selectorContractVersion,
        architecture: product.selectorArchitecture,
      },
      visualizations: {
        modes: product.visualizationModes,
        architecture: product.visualizationArchitecture,
      },
      workflows: product.workflows,
      majorDirectories: product.majorDirectories,
      checks: evidence.candidate.quality.checks,
      privacy: {
        localFindingCount: evidence.publication.history.findingCount,
        remoteFindingCount: evidence.verification.remote.findingCount,
        scanStatus: evidence.publication.policy.status,
      },
    },
    scopedManualObservations: {
      accessibility: evidence.verification.accessibility,
      live: evidence.verification.live,
    },
    unresolvedLimitations: product.limitations,
  };
}

function markdown(report) {
  const observed = report.observed;
  return [
    "# FDM Material Atlas Release",
    "",
    `Verified commit: \`${observed.commitSha}\``,
    `Repository: ${observed.repository.url}`,
    `GitHub Pages: ${observed.pagesUrl}`,
    `Dataset: ${observed.materialCount} materials and ${observed.sourceRecordCount} source records.`,
    "",
    "## Observed product",
    "",
    `Stack: ${observed.stack.join(", ")}.`,
    `Routes: ${observed.routes.map((route) => `\`${route}\``).join(", ")}.`,
    `Selector: ${observed.selector.architecture}`,
    `Visualizations: ${observed.visualizations.architecture} Modes: ${observed.visualizations.modes.join(", ")}.`,
    `Workflows: ${observed.workflows.join(", ")}.`,
    `Major directories: ${observed.majorDirectories.map((path) => `\`${path}\``).join(", ")}.`,
    "",
    "## Scoped manual observations",
    "",
    `Accessibility: ${report.scopedManualObservations.accessibility.status} (${report.scopedManualObservations.accessibility.scope}).`,
    `Live audit: ${report.scopedManualObservations.live.status}; ${report.scopedManualObservations.live.routeCount} routes and ${report.scopedManualObservations.live.assetCount} assets observed.`,
    "",
    "## Unresolved limitations",
    "",
    ...report.unresolvedLimitations.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

export function renderReleaseReport(value, { format = "markdown" } = {}) {
  if (typeof value !== "object" || value === null || value.stage !== "verified")
    fail("RELEASE_REPORT_NOT_VERIFIED");
  let evidence;
  try {
    evidence = parseReleaseEvidence(value);
  } catch (error) {
    if (error instanceof ReleaseEvidenceError) throw error;
    fail("RELEASE_REPORT_INPUT_INVALID");
  }
  const report = reportObject(evidence);
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "markdown") return markdown(report);
  fail("RELEASE_REPORT_FORMAT_INVALID");
}

async function main() {
  if (process.argv.length !== 3) fail("RELEASE_REPORT_INPUT_INVALID");
  const evidence = JSON.parse(await readFile(process.argv[2], "utf8"));
  process.stdout.write(renderReleaseReport(evidence, { format: "markdown" }));
}

if (await isMainModule(import.meta.url)) {
  main().catch((error) => {
    const code = typeof error?.code === "string" ? error.code : "RELEASE_REPORT_INPUT_INVALID";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  });
}
