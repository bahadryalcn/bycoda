import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createVitest } from "vitest/node";

const count = Number(process.argv[2]);
assert(Number.isSafeInteger(count) && count > 0, "Usage: node check-host-test-shards.mjs <count>");

const root = fileURLToPath(new URL("../../", import.meta.url));
const context = await createVitest("test", {
  root,
  config: fileURLToPath(new URL("../../host/vitest.config.ts", import.meta.url)),
  watch: false,
});

try {
  // Vitest's `list --shard` does not apply the shard filter. Use the same
  // sequencer as execution without importing or running the test modules.
  assert.equal(context.config.fileParallelism, false, "Host files must stay serial within a VM");
  assert.equal(context.config.isolate, true, "Host test files must keep worker isolation");
  const specifications = await context.globTestSpecifications();
  const expected = new Set(specifications.map((specification) => specification.moduleId));
  assert(expected.size > 0, "No Host test files were discovered");
  assert.equal(
    expected.size,
    specifications.length,
    "Host test discovery contains duplicate files",
  );
  assert(count <= expected.size, "There must be at least one test file per shard");

  const selected = new Set();
  for (let index = 1; index <= count; index++) {
    context.config.shard = { index, count };
    const sequencer = new context.config.sequence.sequencer(context);
    const shard = await sequencer.shard(specifications);
    assert(shard.length > 0, `Shard ${index}/${count} is empty`);
    for (const specification of shard) {
      const file = specification.moduleId;
      assert(expected.has(file), `Shard ${index}/${count} selected an unknown file: ${file}`);
      assert(!selected.has(file), `More than one shard selected: ${file}`);
      selected.add(file);
    }
    console.log(`Host shard ${index}/${count}: ${shard.length} files`);
  }

  assert.equal(selected.size, expected.size, "Host shards omitted test files");
  console.log(`Host shard coverage: ${selected.size} files, each selected exactly once`);
} finally {
  await context.close();
}
