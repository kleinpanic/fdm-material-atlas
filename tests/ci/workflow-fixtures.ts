export const SHAS = Object.freeze({
  checkout: "3d3c42e5aac5ba805825da76410c181273ba90b1",
  setupNode: "820762786026740c76f36085b0efc47a31fe5020",
  configurePages: "45bfe0192ca1faeb007ade9deae92b16b8254a0d",
  uploadPages: "fc324d3547104276b827a68afc52ff2a11cc49c9",
  deployPages: "cd2ce8fcbc39b97be8ca5fce6e763baed58fa128",
  dependencyReview: "a1d282b36b6f3519aa1f3fc636f609c47dddb294",
  uploadArtifact: "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
});

export const LYCHEE_URL =
  "https://github.com/lycheeverse/lychee/releases/download/lychee-v0.24.2/lychee-x86_64-unknown-linux-gnu.tar.gz";
export const LYCHEE_SHA256 = "1f4e0ef7f6554a6ed33dd7ac144fb2e1bbed98598e7af973042fc5cd43951c9a";

export function safeCiWorkflow() {
  return `name: CI
on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:
permissions: {}
jobs:
  quality:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHAS.checkout} # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@${SHAS.setupNode} # v7.0.0
        with:
          node-version: 22.23.1
          cache: npm
          cache-dependency-path: package-lock.json
      - run: node tools/verify-ci-environment.mjs
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm run ci:quality
`;
}

export function safePagesWorkflow() {
  return `name: Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions: {}
concurrency:
  group: pages-production
  cancel-in-progress: false
jobs:
  build:
    permissions:
      contents: read
      pages: read
    outputs:
      origin: \${{ steps.pages.outputs.origin }}
      base-path: \${{ steps.pages.outputs.base_path }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHAS.checkout} # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@${SHAS.setupNode} # v7.0.0
        with:
          node-version: 22.23.1
          cache: npm
          cache-dependency-path: package-lock.json
      - id: pages
        uses: actions/configure-pages@${SHAS.configurePages} # v6.0.0
      - run: node tools/verify-ci-environment.mjs
        env:
          SITE_ORIGIN: \${{ steps.pages.outputs.origin }}
          SITE_BASE_PATH: \${{ steps.pages.outputs.base_path }}
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm run ci:all
      - run: npm exec --no -- astro build --outDir dist-pages
      - run: ATLAS_TEST_MODE=pages npm run verify:exact-artifact
      - uses: actions/upload-pages-artifact@${SHAS.uploadPages} # v5.0.0
        with:
          path: dist-pages
  deploy:
    needs: build
    permissions:
      pages: write
      id-token: write
    outputs:
      page_url: \${{ steps.deployment.outputs.page_url }}
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - id: deployment
        uses: actions/deploy-pages@${SHAS.deployPages} # v5.0.0
  probe:
    needs: deploy
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHAS.checkout} # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@${SHAS.setupNode} # v7.0.0
        with:
          node-version: 22.23.1
      - run: node tools/probe-pages.mjs
        env:
          DEPLOYED_PAGE_URL: \${{ needs.deploy.outputs.page_url }}
`;
}

export function safeDependencyReviewWorkflow() {
  return `name: Dependency review
on:
  pull_request:
permissions: {}
jobs:
  dependency-review:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHAS.checkout} # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/dependency-review-action@${SHAS.dependencyReview} # v5.0.0
        with:
          fail-on-severity: moderate
          comment-summary-in-pr: never
`;
}

export function safeLinkHealthWorkflow() {
  return `name: Public link health
on:
  schedule:
    - cron: '17 6 * * 1'
  workflow_dispatch:
permissions: {}
jobs:
  link-health:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHAS.checkout} # v7.0.1
        with:
          persist-credentials: false
      - name: Download checked Lychee archive
        run: curl --proto '=https' --tlsv1.2 --fail --location --max-time 60 --output "$RUNNER_TEMP/lychee.tar.gz" '${LYCHEE_URL}'
      - name: Verify Lychee archive
        run: echo '${LYCHEE_SHA256}  '":"'$RUNNER_TEMP/lychee.tar.gz' | sha256sum --check --strict
      - name: Extract Lychee archive
        run: tar -xzf "$RUNNER_TEMP/lychee.tar.gz" -C "$RUNNER_TEMP" lychee
      - name: Check public links without credentials
        id: links
        continue-on-error: true
        run: "$RUNNER_TEMP/lychee" --config .github/lychee.toml src/data/public/atlas.v1.json
      - uses: actions/upload-artifact@${SHAS.uploadArtifact} # v7.0.1
        with:
          name: link-health-report
          path: link-health.md
          retention-days: 14
`;
}

export function validWorkflowSet() {
  return {
    "ci.yml": safeCiWorkflow(),
    "pages.yml": safePagesWorkflow(),
    "dependency-review.yml": safeDependencyReviewWorkflow(),
    "link-health.yml": safeLinkHealthWorkflow(),
  };
}
