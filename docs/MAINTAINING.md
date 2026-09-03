# Maintaining the FDM Material Atlas

This guide covers safe changes to the committed public application and its canonical data. Read the [project overview](../README.md) first.

## Maintenance boundary

Maintenance uses the committed public data in `src/data/public/atlas.v1.json` and requires no external system access. Treat that file as reviewed product source code. Do not add acquisition locations, account details, access material, or local operating records to repository files, commits, workflow output, browser assets, or generated artifacts.

Make changes on a branch. Submit every material-data change through a pull request. A reviewer must be able to understand the public fact change and its evidence from the repository diff alone.

## Schema evolution

The `schemaVersion` field identifies the accepted Atlas envelope. Version 1 is defined by `src/data/schema/atlas.ts` and its referenced schema modules.

- Keep a compatible field change within the current version only when old valid records retain the same meaning.
- Use a schema migration when a field is renamed, removed, split, or given new semantics.
- Change the version deliberately. Update schemas, canonical data, types, validation tests, consumers, and documentation in the same pull request.
- Reject unknown fields. Do not retain legacy aliases that create two meanings for one fact.

Stable public IDs and material slugs are durable references. Do not change an ID to improve wording or sort order. Use `displayOrder` or labels for presentation changes. When an identity must change, treat it as a migration and update every reference and route test.

## Record and reference integrity

The canonical envelope contains materials, sources, methods, selector criteria, process gates, decision lanes, visualization references, and vocabularies. Preserve reference integrity across them:

- Every referenced ID must resolve to exactly one compatible record.
- Every material ID, slug, claim ID, source ID, method ID, gate ID, lane ID, and vocabulary ID must remain unique.
- A visualization or lane candidate must derive from canonical facts; do not add a handwritten candidate list in a page component.
- Remove a record only after all inbound references are removed or migrated.
- Keep public evidence links on HTTPS. Open each changed link, confirm that it supports the described claim, and reject links with embedded account information.

Run `npm run validate:data` after each logical data edit. The validator reports stable issue codes and JSON pointers. Fix the canonical record; do not weaken an invariant to accept an accidental shape.

## Evidence scopes

Every claim basis uses an evidence scope that states what the evidence can support:

- `direct-product` — a value for the named product or grade
- `representative-product` — an example that must not be presented as universal family behavior
- `family-guidance` — broad family-level screening guidance
- `qualitative-heuristic` — a controlled comparative aid, not a standardized property
- `starting-profile-guidance` — a calibration starting point
- `derived-selector-logic` — a transparent rule derived from controlled facts

Review the scope, qualification, public link, record title, and claim together. Do not promote a representative example or heuristic to a universal specification. Keep source and method records first-class so a user can reach the method page from a claim.

## Thermal claims

Practical service-temperature guidance and named thermal observations are separate data shapes. A named thermal metric is comparable only when its metric and represented method dimensions are compatible. Check the test identity, load, conditioning, specimen, product grade, and annealing state. Do not compare Tg, HDT, Vicat softening temperature, melting point, or service guidance as if they were one scale.

Preserve the qualification and evidence basis with each thermal value. A change that only replaces a number but leaves an incompatible metric label or method is invalid.

## Selector invariants

The selector is public deterministic logic, not editorial ranking.

- The primary preference has weight `2`; each applicable secondary preference has weight `1`.
- A selected hard gate runs before preference scoring. A definite incompatibility or indeterminate required capability excludes the material.
- A score reports alignment with selected criteria. It does not report universal quality.
- Equal scores use `score-desc-material-asc`: score descending, then public material ID ascending.
- Explanations must be generated from the same contribution and exclusion records used by the engine.
- UI code must consume engine results. It must not duplicate scoring or exclusion rules.

When selector rules or controlled facts change, update or add a regression fixture in `tests/selector/fixtures.ts`. Cover the changed ranking, its explanation, its exclusions, and deterministic ordering. Run `npm run test:selector` and `npm run test:selector-smoke`.

## Canonical edit workflow

1. Edit `src/data/public/atlas.v1.json` without reordering unrelated records.
2. Run `npm run validate:data` and fix all schema, vocabulary, ID, reference, and invariant failures.
3. Run `npm run summarize:data-change` to produce a bounded human-readable diff summary.
4. Inspect `git diff -- src/data/public/atlas.v1.json`. Confirm that the change contains only intended public facts.
5. Run selector and visualization tests that depend on the changed fields.
6. Run the release checks below.
7. Open a pull request. Describe changed claims, evidence scope, affected selector behavior, routes, and visualizations.

Keep deterministic serialization: UTF-8 JSON, two-space indentation, one final newline, stable IDs, and canonical record ordering. Do not accept a diff that rewrites unrelated records. The validator enforces the accepted canonical representation and fails on unexpected structure.

## Release checks

Start from an exact install with `npm ci`. Then run:

```sh
npm run audit:dependencies
npm run ci:quality
npm run test:ci-contracts
npm run build:test-modes
npm run validate:html
npm run validate:routes
npm run test:browser
npm run test:accessibility
npm run test:performance
npm run test:probe-pages
```

`npm run ci:all` runs the same local release gate as one aggregate command. Do not describe a deployment as complete until the checked commit, workflow run, deployed artifact, and live route probes have been observed at the same revision.

The pull-request reviewer must inspect the public-data diff, evidence scope, external links, selector effects, generated route effects, and test results. Release configuration changes also require review of workflow permissions and publication checks.

## Automated maintenance

Routine maintenance is designed to need attention only when an automated check finds a real problem.

- Dependabot groups npm and GitHub Actions updates. Only minor and patch groups can enter the automatic merge workflow. Major updates remain open for deliberate review.
- Automatic merge is limited to Dependabot-authored branches in this repository and still requires every protected-branch check to pass. It cannot bypass branch protection.
- Dependency installs disable lifecycle scripts. `npm run audit:dependencies` checks a closed allowlist, exact manifest and lockfile versions, registry origin, SHA-512 integrity, package repository, package directory, and lifecycle-script behavior against current registry metadata.
- The weekly repository-health workflow performs a clean install, vulnerability and dependency-policy audits, quality checks, both deployment-mode builds, route validation, and a live Pages probe.
- A failed weekly health run opens or updates one GitHub Actions-authored issue. A later successful run closes that issue. The reporting job has issue-only write permission and never checks out repository code.

If a maintenance issue opens, use its linked workflow run as the starting point. Do not weaken a check to make the issue disappear. Fix the failing dependency, source link, test, build, or deployment condition through a normal pull request.

## Recovery

Use Git revert for a released commit when a clean inverse change restores valid data and behavior. For a schema migration, reference change, or later dependent edit that cannot be reversed safely, make a forward fix with its own validation, diff summary, tests, and pull request.

Do not repair a public data problem by rewriting shared history. Keep the correction reviewable and preserve the reason for the change in normal Git history.
