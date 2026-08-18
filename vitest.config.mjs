import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const testLibraryNodeModules = resolve(dirname(require.resolve("@testing-library/react/package.json")), "../..");

// React and the renderer must use the same physical React module. Nested Git
// worktrees can otherwise resolve the application copy and test renderer copy
// from different node_modules directories.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".worktrees/**"],
  },
  resolve: {
    alias: [
      { find: /^react$/, replacement: resolve(testLibraryNodeModules, "react/index.js") },
      { find: /^react\/(.*)$/, replacement: `${resolve(testLibraryNodeModules, "react")}/$1` },
      { find: /^react-dom$/, replacement: resolve(testLibraryNodeModules, "react-dom/index.js") },
      { find: /^react-dom\/(.*)$/, replacement: `${resolve(testLibraryNodeModules, "react-dom")}/$1` },
    ],
  },
});
