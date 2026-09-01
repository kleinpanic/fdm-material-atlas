"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Lighthouse loads this controlled policy as CommonJS.
const policy = require("./performance-budgets.json");

module.exports = {
  ci: {
    collect: {
      numberOfRuns: policy.lighthouse.runs,
      chromePath: process.env.CHROME_PATH || "/usr/bin/chromium",
      settings: {
        onlyCategories: ["performance"],
        chromeFlags: "--headless=new --no-sandbox --disable-dev-shm-usage",
      },
    },
    assert: {
      aggregationMethod: "median",
      assertions: {
        "categories:performance": ["error", { minScore: policy.lighthouse.performanceScore }],
        "first-contentful-paint": [
          "error",
          { maxNumericValue: policy.lighthouse.firstContentfulPaintMs },
        ],
        "largest-contentful-paint": [
          "error",
          { maxNumericValue: policy.lighthouse.largestContentfulPaintMs },
        ],
        "cumulative-layout-shift": [
          "error",
          { maxNumericValue: policy.lighthouse.cumulativeLayoutShift },
        ],
        "total-blocking-time": [
          "error",
          { maxNumericValue: policy.lighthouse.totalBlockingTimeMs },
        ],
        "resource-summary:total:size": ["error", { maxNumericValue: policy.lighthouse.totalBytes }],
        "resource-summary:script:size": [
          "error",
          { maxNumericValue: policy.lighthouse.javascriptBytes },
        ],
        "resource-summary:stylesheet:size": [
          "error",
          { maxNumericValue: policy.lighthouse.cssBytes },
        ],
        "resource-summary:font:size": ["error", { maxNumericValue: policy.lighthouse.fontBytes }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: policy.reports.directory + "/lhci",
      reportFilenamePattern: "%%PATHNAME%%-%%DATETIME%%-report.%%EXTENSION%%",
    },
  },
};
