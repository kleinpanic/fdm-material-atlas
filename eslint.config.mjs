import { defineConfig, globalIgnores } from "eslint/config";
import astro from "eslint-plugin-astro";
import tseslint from "typescript-eslint";

const generatedAndPrivatePaths = [
  ".astro/**",
  ".git/**",
  ".planning/**",
  ".lighthouseci/**",
  "artifacts/**",
  "coverage/**",
  "dist/**",
  "dist-*/**",
  "node_modules/**",
  "playwright-report/**",
  "reports/**",
  "test-results/**",
];

const coreCorrectnessRules = {
  "array-callback-return": "error",
  "constructor-super": "error",
  "for-direction": "error",
  "getter-return": "error",
  "no-async-promise-executor": "error",
  "no-class-assign": "error",
  "no-compare-neg-zero": "error",
  "no-cond-assign": "error",
  "no-const-assign": "error",
  "no-constant-binary-expression": "error",
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-control-regex": "error",
  "no-debugger": "error",
  "no-dupe-args": "error",
  "no-dupe-class-members": "error",
  "no-dupe-else-if": "error",
  "no-dupe-keys": "error",
  "no-duplicate-case": "error",
  "no-empty-character-class": "error",
  "no-empty-pattern": "error",
  "no-ex-assign": "error",
  "no-fallthrough": "error",
  "no-func-assign": "error",
  "no-import-assign": "error",
  "no-invalid-regexp": "error",
  "no-irregular-whitespace": "error",
  "no-loss-of-precision": "error",
  "no-misleading-character-class": "error",
  "no-new-native-nonconstructor": "error",
  "no-obj-calls": "error",
  "no-promise-executor-return": "error",
  "no-prototype-builtins": "error",
  "no-self-assign": "error",
  "no-setter-return": "error",
  "no-shadow-restricted-names": "error",
  "no-sparse-arrays": "error",
  "no-unexpected-multiline": "error",
  "no-unreachable": "error",
  "no-unreachable-loop": "error",
  "no-unsafe-finally": "error",
  "no-unsafe-negation": "error",
  "no-unsafe-optional-chaining": "error",
  "no-unused-labels": "error",
  "no-useless-backreference": "error",
  "no-useless-catch": "error",
  "no-useless-escape": "error",
  "no-with": "error",
  "require-yield": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
};

export default defineConfig([
  globalIgnores(generatedAndPrivatePaths, "generated and private paths"),
  {
    name: "repository JavaScript correctness",
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: coreCorrectnessRules,
  },
  ...tseslint.configs.recommended,
  {
    name: "repository JavaScript and TypeScript policy",
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    name: "declaration merging",
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  ...astro.configs.recommended,
  {
    name: "repository Astro policy",
    files: ["**/*.astro"],
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "astro/no-set-html-directive": "error",
    },
  },
  {
    name: "reviewed selector JSON insertion boundary",
    files: ["src/pages/index.astro"],
    rules: {
      // The sole set:html call receives only serializeSelectorDeferredPayload output;
      // a source contract rejects any second use in public source.
      "astro/no-set-html-directive": "off",
    },
  },
]);
