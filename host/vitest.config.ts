import { defineConfig } from "vitest/config";
import { hostTestSelection } from "../scripts/checks/host-test-selection.mjs";

export default defineConfig({
  test: {
    environment: "node",
    ...hostTestSelection(process.env.BYCODA_HOST_TEST_SCOPE ?? "all"),
    // If all reviewed graphs drift, integration retains every file.
    passWithNoTests: process.env.BYCODA_HOST_TEST_SCOPE === "portable",
    // These integration tests launch real Git, Node and PowerShell processes.
    // Competing suites can exceed the default 5s budget on every platform,
    // leaving processes alive when teardown tries to remove their directories.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
