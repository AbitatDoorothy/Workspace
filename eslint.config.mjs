import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/.next/**",
      "**/.open-next/**",
      "**/dist/**",
      "**/node_modules/**",
      "pnpm-lock.yaml"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.ts", "**/*.tsx"],
    languageOptions: {
      globals: {
        React: "readonly",
        clearInterval: "readonly",
        console: "readonly",
        process: "readonly",
        setInterval: "readonly"
      }
    }
  }
];
