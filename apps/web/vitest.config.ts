import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "**/.next/**", "**/.open-next/**", "**/dist/**"]
  }
});
