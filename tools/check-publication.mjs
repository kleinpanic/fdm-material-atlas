#!/usr/bin/env node

import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import { assertRepository } from './lib/repository-guard.mjs';
import { loadPublicationPolicy } from './lib/publication-policy.mjs';
import { scanPublication } from './scan-publication.mjs';
import { isMainModule } from './lib/main-module.mjs';

const REMOTE_POLICIES = new Set(['absent', 'any']);
const DEFAULT_MODES = Object.freeze(['working', 'tracked', 'history']);

class PublicationBaselineError extends Error {
  constructor(ruleId) {
    super(`Publication baseline failed: ${ruleId}`);
    this.name = 'PublicationBaselineError';
    this.ruleId = ruleId;
  }
}

function controlledRule(error, fallback) {
  if (typeof error?.ruleCode === 'string') return error.ruleCode;
  if (typeof error?.ruleId === 'string') return error.ruleId;
  return fallback;
}

function safeFinding(finding) {
  const result = {
    ruleId: finding.ruleId,
    surface: finding.surface,
    safeLocation: finding.safeLocation,
  };
  if (finding.objectType) result.objectType = finding.objectType;
  return result;
}

function buildReport(surfaces, findings, errors) {
  const ok = findings.length === 0 && errors.length === 0;
  const report = { ok, surfaces };
  if (!ok) {
    report.findings = findings;
    report.errors = errors;
  }
  return Object.freeze(report);
}

/**
 * Run the complete local publication baseline with one in-memory policy.
 * The returned object contains only controlled labels, counts, and opaque locations.
 */
export async function checkPublication({
  root = process.cwd(),
  remotePolicy = 'absent',
  sensitiveFile,
  artifacts = [],
  env = process.env,
} = {}) {
  if (!REMOTE_POLICIES.has(remotePolicy) || !Array.isArray(artifacts)) {
    throw new PublicationBaselineError('arguments-invalid');
  }

  let physicalRoot;
  try {
    physicalRoot = await realpath(resolve(root));
  } catch {
    return buildReport([], [], [{ ruleId: 'repository-inspection-failed', surface: 'repository' }]);
  }

  const surfaces = [];
  const findings = [];
  const errors = [];

  try {
    await assertRepository({
      cwd: physicalRoot,
      expectedRoot: physicalRoot,
      remotePolicy,
    });
    surfaces.push({ surface: 'repository', scannedCount: 1, findingCount: 0 });
  } catch (error) {
    errors.push({ ruleId: controlledRule(error, 'repository-inspection-failed'), surface: 'repository' });
    surfaces.push({ surface: 'repository', scannedCount: 0, findingCount: 0 });
    return buildReport(surfaces, findings, errors);
  }

  let policy;
  try {
    policy = await loadPublicationPolicy({
      root: physicalRoot,
      env,
      sensitiveFile,
    });
  } catch (error) {
    errors.push({ ruleId: controlledRule(error, 'policy-inspection-failed'), surface: 'policy' });
    return buildReport(surfaces, findings, errors);
  }

  const selectedSurfaces = [
    ...DEFAULT_MODES.map((mode) => ({ mode })),
    ...artifacts.map((artifactPath, artifactOrdinal) => ({ mode: 'artifact', artifactPath, artifactOrdinal })),
  ];

  for (const selected of selectedSurfaces) {
    try {
      const report = await scanPublication({
        root: physicalRoot,
        mode: selected.mode,
        artifactPath: selected.artifactPath,
        policy,
      });
      const surfaceReport = {
        surface: report.mode,
        scannedCount: report.scannedCount,
        findingCount: report.findingCount,
      };
      if (report.artifactDigest) {
        surfaceReport.artifactOrdinal = selected.artifactOrdinal;
        surfaceReport.artifactDigest = report.artifactDigest;
      }
      surfaces.push(surfaceReport);
      findings.push(...report.findings.map(safeFinding));
    } catch (error) {
      surfaces.push({ surface: selected.mode, scannedCount: 0, findingCount: 0 });
      errors.push({
        ruleId: controlledRule(error, 'surface-inspection-failed'),
        surface: selected.mode,
      });
    }
  }

  return buildReport(surfaces, findings, errors);
}

function parseArguments(argv) {
  const options = { artifacts: [] };
  const singleUse = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--root', '--remote-policy', '--sensitive-file', '--artifact'].includes(flag)) {
      throw new PublicationBaselineError('arguments-invalid');
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new PublicationBaselineError('arguments-invalid');
    if (flag === '--artifact') {
      options.artifacts.push(value);
    } else {
      if (singleUse.has(flag)) throw new PublicationBaselineError('arguments-invalid');
      singleUse.add(flag);
      if (flag === '--root') options.root = value;
      if (flag === '--remote-policy') options.remotePolicy = value;
      if (flag === '--sensitive-file') options.sensitiveFile = value;
    }
    index += 1;
  }
  if (options.remotePolicy && !REMOTE_POLICIES.has(options.remotePolicy)) {
    throw new PublicationBaselineError('arguments-invalid');
  }
  return options;
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const report = await checkPublication({ ...options, env: process.env });
    const stream = report.ok ? process.stdout : process.stderr;
    stream.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const report = buildReport([], [], [{
      ruleId: controlledRule(error, 'baseline-inspection-failed'),
      surface: 'command',
    }]);
    process.stderr.write(`${JSON.stringify(report)}\n`);
    process.exitCode = 2;
  }
}

if (await isMainModule(import.meta.url)) {
  await main();
}
