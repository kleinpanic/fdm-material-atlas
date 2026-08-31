# FDM Material Atlas

FDM Material Atlas is a public, static reference for comparing common FDM/FFF material families. It combines a transparent constraint-based selector with material reference pages, process guidance, evidence notes, and decision-oriented visualizations.

The selector is a screening tool. Its score measures alignment with the criteria that a user selects; it does not measure universal material quality. Exact filament formulations differ, and starting profiles are calibration starting points rather than guaranteed settings or maxima. Check current TDS and SDS documents before safety-critical or engineering use.

## Local development

Use Node.js 22 and npm.

```sh
npm ci
npm run validate:data
npm test
npm run typecheck
npm run build:root
```

Run `npm run test:e2e` after `npm run build:test-modes` for the browser suite.

## Architecture

- Astro generates the public routes as static HTML.
- TypeScript and Zod validate the canonical public dataset at build time.
- Preact islands provide bounded interactivity for the selector and data tools.
- Shared view models supply the selector, atlas, detail, comparison, map, and method surfaces.
- CSS tokens define typography, spacing, process states, caution states, and data encodings.

The canonical publishable dataset is `src/data/public/atlas.v1.json`. It contains normalized material facts, controlled vocabularies, source records, methodology records, selector rules, process gates, and decision lanes. Application routes do not contact a private data service or external spreadsheet.

## Quality checks

The test suite covers data integrity, deterministic selector ranking and exclusions, route generation, visualization transforms, keyboard behavior, responsive layout, and accessibility states. GitHub Actions validates data, runs unit tests and type checks, builds the repository-path deployment, and publishes GitHub Pages only after the deployment checks pass.

## Data maintenance

Authorized maintainers update the canonical public snapshot locally, review the resulting diff, run the complete validation suite, and submit the change through a pull request. Private acquisition credentials and upstream-source metadata do not belong in this repository, its Actions configuration, or build output.

## Method limits

Service-temperature guidance and named thermal tests such as Tg, HDT, Vicat softening temperature, and melting point are distinct concepts. Values from unlike methods are not directly interchangeable. Geometry, moisture, load, print orientation, annealing, chamber conditions, and process history can materially change part behavior. This project is a selection aid, not an engineering safety certification.
