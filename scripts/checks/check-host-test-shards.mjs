import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createVitest } from "vitest/node";
import { portableHostTests } from "./host-test-selection.mjs";

const count = Number(process.argv[2]);
assert(Number.isSafeInteger(count) && count > 0, "Usage: node check-host-test-shards.mjs <count>");

const root = fileURLToPath(new URL("../../", import.meta.url));
const previousScope = process.env.BYCODA_HOST_TEST_SCOPE;
const scopes = new Map();
try {
  for (const scope of ["all", "portable", "integration"]) {
    process.env.BYCODA_HOST_TEST_SCOPE = scope;
    const context = await createVitest("test", {
      root,
      config: fileURLToPath(new URL("../../host/vitest.config.ts", import.meta.url)),
      watch: false,
    });

    try {
      // Vitest's `list --shard` does not apply the shard filter. Use the same
      // sequencer as execution without importing or running the test modules.
      assert.equal(
        context.config.fileParallelism,
        false,
        "Host files must stay serial within a VM",
      );
      assert.equal(context.config.isolate, true, "Host test files must keep worker isolation");
      const specifications = await context.globTestSpecifications();
      const expected = new Set(specifications.map((specification) => specification.moduleId));
      scopes.set(scope, expected);
      if (scope === "portable" && expected.size === 0) {
        console.log("Host portable: no unchanged reviewed graphs; integration covers every file");
        continue;
      }
      assert(expected.size > 0, "No Host test files were discovered");
      assert.equal(
        expected.size,
        specifications.length,
        "Host test discovery contains duplicate files",
      );
      const shardCount = scope === "portable" ? 1 : count;
      assert(shardCount <= expected.size, "There must be at least one test file per shard");

      const selected = new Set();
      for (let index = 1; index <= shardCount; index++) {
        context.config.shard = { index, count: shardCount };
        const sequencer = new context.config.sequence.sequencer(context);
        const shard = await sequencer.shard(specifications);
        assert(shard.length > 0, `Shard ${index}/${count} is empty`);
        for (const specification of shard) {
          const file = specification.moduleId;
          assert(expected.has(file), `Shard ${index}/${count} selected an unknown file: ${file}`);
          assert(!selected.has(file), `More than one shard selected: ${file}`);
          selected.add(file);
        }
        console.log(`Host ${scope} shard ${index}/${shardCount}: ${shard.length} files`);
      }

      assert.equal(selected.size, expected.size, "Host shards omitted test files");
      console.log(
        `Host ${scope} shard coverage: ${selected.size} files, each selected exactly once`,
      );
    } finally {
      await context.close();
    }
  }
  const all = scopes.get("all");
  const portable = scopes.get("portable");
  const integration = scopes.get("integration");
  assert.equal(
    portable.size,
    portableHostTests().length,
    "Reviewed portable files must all be discoverable",
  );
  for (const file of portable) {
    assert(all.has(file), `Unknown portable file: ${file}`);
    assert(!integration.has(file), `Portable/integration overlap: ${file}`);
  }
  for (const file of integration) assert(all.has(file), `Unknown integration file: ${file}`);
  assert.equal(portable.size + integration.size, all.size, "Host scope partition omitted files");
  console.log(
    `Host scopes: ${portable.size} portable once + ${integration.size} integration per OS = ${all.size} files; no omissions or overlap`,
  );
} finally {
  if (previousScope === undefined) delete process.env.BYCODA_HOST_TEST_SCOPE;
  else process.env.BYCODA_HOST_TEST_SCOPE = previousScope;
}
