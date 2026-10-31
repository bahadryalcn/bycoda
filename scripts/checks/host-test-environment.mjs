import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolve the same installed Vitest shard as execution, without importing tests.
// Only real browser consumers need Chromium; the other Host VMs avoid its setup.
export async function shardEnvironment(index, count) {
  assert(
    Number.isSafeInteger(count) &&
      count > 0 &&
      Number.isSafeInteger(index) &&
      index > 0 &&
      index <= count,
    "Usage: host-test-environment.mjs <index> <count>",
  );
  const { createVitest } = await import("vitest/node");
  const context = await createVitest("test", {
    root: fileURLToPath(new URL("../../", import.meta.url)),
    config: fileURLToPath(new URL("../../host/vitest.config.ts", import.meta.url)),
    watch: false,
  });
  try {
    const specifications = await context.globTestSpecifications();
    context.config.shard = { index, count };
    const sequencer = new context.config.sequence.sequencer(context);
    const selected = await sequencer.shard(specifications);
    const browserFiles = selected
      .map((entry) => entry.moduleId)
      .filter((file) => readFileSync(file, "utf8").includes("@playwright/test"));
    return {
      scope: process.env.BYCODA_HOST_TEST_SCOPE ?? "all",
      index,
      count,
      files: selected.length,
      chromium: browserFiles.length > 0,
      browserFiles,
    };
  } finally {
    await context.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const plan = await shardEnvironment(Number(process.argv[2]), Number(process.argv[3]));
  console.log(JSON.stringify(plan, null, 2));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `chromium=${plan.chromium}\n`);
}
