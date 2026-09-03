# FDM Material Atlas

FDM Material Atlas is a public, static decision aid for FDM/FFF material selection. Its selector-first experience ranks compatible material families, explains every score and exclusion, and links each result to reference data, process guidance, evidence, and interactive decision maps.

The atlas supports early screening and comparison. It does not declare one material universally best.

**Live site:** [kleinpanic.github.io/fdm-material-atlas](https://kleinpanic.github.io/fdm-material-atlas/)

## Product routes

- `/` — interactive selector and explained recommendations
- `/materials/` — searchable material atlas
- `/materials/<slug>/` — one generated detail page for each material family
- `/map/` — selected comparison, decision paths, and scientific visualizations in one workbench
- `/compare/` — compatibility route for existing comparison links
- `/data/` — advanced table and data explorer
- `/method/` — definitions, evidence, scoring method, and limitations

All routes are generated as static files. Internal links support both root deployment and a GitHub Pages repository base path.

## Local setup

Use Node.js 22 and npm.

```sh
npm ci
npm run validate:data
npm run test:unit
npm run typecheck
npm run build:root
```

Useful focused and release checks are:

- `npm run test:selector` for deterministic recommendation rules and regression cases.
- `npm run test:integration` for repository publication boundaries.
- `npm run build:test-modes` followed by `npm run test:e2e` for root-path and repository-path browser tests.
- `npm run ci:quality` for formatting, lint, types, canonical-data validation, unit tests, and integration tests.
- `npm run ci:all` for the complete local release gate.

## Architecture

Astro, TypeScript, and Tailwind CSS form the static application foundation. Zod validates public data at build time. Small Preact islands add interaction only where a static page needs it. Shared domain and view-model modules supply the selector, atlas, detail, comparison, map, data, and method surfaces. The browser does not query a content service.

The canonical public Atlas is [`src/data/public/atlas.v1.json`](src/data/public/atlas.v1.json). Its `schemaVersion` identifies the accepted envelope. The envelope holds materials, evidence sources, method records, selector rules, process gates, decision lanes, visualization references, and controlled vocabularies. Schema modules in [`src/data/schema/`](src/data/schema/) validate structure, identifiers, references, and cross-record invariants. Pages and visualizations derive from this one committed artifact; they do not keep separate copies of material facts.

## Selector method

The engine is deterministic and independently tested. A selected primary goal has a weight of two points. Each applicable secondary preference has a weight of one point. Hard constraints remove incompatible or indeterminate materials before preference scoring. The result explains awarded points and every exclusion.

Scores measure alignment with the selected criteria. They do not measure universal quality or engineering superiority. Equal scores use the stable `score-desc-material-asc` order: score descending, then public material ID ascending. UI components render the engine result and do not implement a second ranking algorithm.

## Evidence and limits

Claims identify their evidence basis. The supported scopes distinguish direct product-specific values, representative product examples, family-level guidance, qualitative heuristic guidance, starting-profile guidance, and derived selector logic. A representative value does not become a universal family specification.

Service-temperature guidance is separate from named observations such as Tg, HDT, Vicat softening temperature, and melting point. Values from different metrics or methods are not directly comparable or interchangeable. Check the metric, method, load, conditioning, and grade before comparison.

Exact filament formulations differ. Geometry, moisture, load, print orientation, annealing, chamber conditions, and process history can change part behavior. Every starting profile is a calibration starting point, not a guaranteed setting or maximum. Check current TDS and SDS documents for the exact product. This atlas is not an engineering safety certification.

## Deployment and publication boundary

The Pages workflow installs exact dependencies, runs the release checks, builds the repository-path artifact, and permits deployment only after its required jobs pass. The deployed application is available at [kleinpanic.github.io/fdm-material-atlas](https://kleinpanic.github.io/fdm-material-atlas/).

The committed public Atlas is the application’s complete content input. Repository files, browser bundles, build output, and workflow logs must not contain acquisition locations, account details, access material, or internal engineering records. Publication checks scan the tracked tree, history, artifacts, and release logs before closure.

## Maintenance

Read [Maintaining the Atlas](docs/MAINTAINING.md) before changing the schema, material facts, evidence, selector rules, or release configuration. Data changes use a reviewed pull request and the same deterministic validation path as application changes.

Dependabot groups dependency updates. Minor and patch groups may merge automatically only after all protected checks pass; major upgrades require deliberate review. A weekly least-privilege health workflow audits dependencies, builds both deployment modes, validates routes, probes the live Pages site, and maintains one actionable issue only while attention is required.

## License status

No license has been selected. Copyright law therefore reserves the rights that are not expressly granted.
