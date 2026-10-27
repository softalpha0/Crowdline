import { defineConfig } from "vitest/config";

// Tests never touch the network: every API response is a recorded fixture.
export default defineConfig({
  test: {
    projects: [
      { test: { name: "core", root: "packages/core", include: ["test/**/*.test.ts"] } },
      { test: { name: "oneclick", root: "packages/oneclick", include: ["test/**/*.test.ts"] } },
      { test: { name: "server", root: "apps/server", include: ["test/**/*.test.ts"] } },
    ],
  },
});
