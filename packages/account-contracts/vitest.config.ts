import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/account-contracts/src/**/*.test.ts"],
  },
});
