import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Rule E1: the engine is framework-free TypeScript. The browser, API
    // routes, Playwright runner, MCP server and tests all import the same code.
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react/*", "react-dom", "react-dom/*"], message: "src/engine must stay framework-free (rule E1)." },
            { group: ["next", "next/*"], message: "src/engine must stay framework-free (rule E1)." },
            { group: ["@/components/*", "@/app/*", "@/lib/*"], message: "src/engine must not depend on UI code (rule E1)." },
          ],
        },
      ],
      // Rule S1: no dynamic code execution of generated content.
      "no-eval": "error",
      "no-new-func": "error",
      "no-implied-eval": "error",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // The 2009 portal is plain browser JavaScript served as-is.
    files: ["public/legacy/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { window: "readonly", document: "readonly", localStorage: "readonly", sessionStorage: "readonly", location: "readonly", console: "readonly", setTimeout: "readonly", clearTimeout: "readonly", URLSearchParams: "readonly", MutationObserver: "readonly" },
    },
    rules: { "no-var": "off", "prefer-const": "off", "@typescript-eslint/no-unused-vars": "off", "@next/next/no-location-assign-relative-destination": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "public/legacy/**/*.min.js",
    "public/workers/**",
    "runner/dist/**",
    "tests/integration/.out/**",
    "docs/**",
  ]),
]);

export default eslintConfig;
