import { defineConfig, globalIgnores } from "eslint/config";

const eslintConfig = defineConfig([
  globalIgnores([
    ".agents/**",
    "dist/**",
    "docs/.blume/**",
    "docs/dist/**",
    "node_modules/**",
    "**/*.ts",
    "**/*.tsx",
  ]),
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-constant-binary-expression": "error",
      "no-debugger": "error",
      "no-dupe-else-if": "error",
      "no-duplicate-case": "error",
      "no-unreachable": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "use-isnan": "error",
      "valid-typeof": "error",
    },
  },
]);

export default eslintConfig;
