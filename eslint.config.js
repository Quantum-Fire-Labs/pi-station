import js from "@eslint/js"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: ["eslint.config.js", ".worktrees/**", "**/dist/**", "**/coverage/**", "**/node_modules/**", "ops/*.mjs"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["vitest.config.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
    },
  },
)
