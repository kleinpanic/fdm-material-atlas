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
          SITE_BASE_PATH: \${{ format('{0}/', steps.pages.outputs.base_path) }}
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

export function safeDependabotAutomergeWorkflow() {
  return `name: Dependabot auto-merge
on:
  pull_request_target:
    types: [opened, synchronize, reopened, ready_for_review]
permissions: {}
jobs:
  dependabot-automerge:
    if: >-
      github.actor == 'dependabot[bot]' &&
      github.event.pull_request.user.login == 'dependabot[bot]' &&
      github.event.pull_request.head.repo.full_name == github.repository &&
      startsWith(github.event.pull_request.head.ref, 'dependabot/') &&
      (startsWith(github.event.pull_request.head.ref, 'dependabot/npm_and_yarn/npm-minor-patch-') ||
      startsWith(github.event.pull_request.head.ref, 'dependabot/github_actions/actions-minor-patch-'))
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - name: Queue protected squash merge
        env:
          GH_TOKEN: \${{ github.token }}
          PR_URL: \${{ github.event.pull_request.html_url }}
        run: gh pr merge "$PR_URL" --auto --squash
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

export function safeMaintenanceHealthWorkflow() {
  return `name: Repository health
on:
  schedule:
    - cron: '43 7 * * 3'
  workflow_dispatch:
permissions: {}
jobs:
  health:
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
        env:
          CI_CONTEXT: maintenance
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm audit --audit-level=high
      - run: npm run audit:dependencies
      - run: npm run ci:quality && npm run test:ci-contracts
      - run: npm run build:test-modes && npm run validate:html && npm run validate:routes
      - run: node tools/probe-pages.mjs
        env:
          DEPLOYED_PAGE_URL: https://kleinpanic.github.io/fdm-material-atlas/
  report:
    if: always()
    needs: health
    permissions:
      issues: write
    runs-on: ubuntu-latest
    steps:
      - name: Maintain one actionable health issue
        env:
          GH_REPO: \${{ github.repository }}
          GH_TOKEN: \${{ github.token }}
          HEALTH_RESULT: \${{ needs.health.result }}
        run: |
          issue_number="$(gh issue list --search 'author:app/github-actions' --json number --jq '.[0].number // empty')"
          if [ "$HEALTH_RESULT" = "success" ]; then
            if [ -n "$issue_number" ]; then
              gh issue close "$issue_number"
            fi
          else
            if [ -n "$issue_number" ]; then
              gh issue edit "$issue_number" --body failure
            else
              gh issue create --title health --body failure
            fi
          fi
`;
}

export function validWorkflowSet() {
  return {
    "ci.yml": safeCiWorkflow(),
    "pages.yml": safePagesWorkflow(),
    "dependency-review.yml": safeDependencyReviewWorkflow(),
    "dependabot-automerge.yml": safeDependabotAutomergeWorkflow(),
    "link-health.yml": safeLinkHealthWorkflow(),
    "maintenance-health.yml": safeMaintenanceHealthWorkflow(),
  };
}
