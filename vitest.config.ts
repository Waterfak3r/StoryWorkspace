import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "src/studio/**/*.test.ts",
      "src/features/studio/**/*.test.ts",
      "src/features/i18n/**/*.test.ts",
    ],
    restoreMocks: true,
    clearMocks: true,
  },
});
