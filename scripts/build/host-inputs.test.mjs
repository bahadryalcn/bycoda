import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { discoverHostInputs, hostBuildPlans } from "./host-inputs.mjs";

test("discovers shared imports, every worker and conservative runtime resources without writing bundles", async () => {
  const root = await mkdtemp(join(tmpdir(), "bycoda-host-inputs-"));
  try {
    const files = {
      "package.json": '{"version":"0.6.94"}',
      "tsconfig.json": "{}",
      "host/tsconfig.json": "{}",
      "scripts/build/host-inputs.mjs": "// fixture helper identity",
      "host/build.mjs": `import {build} from "esbuild";
        const options={bundle:true,platform:"node",format:"esm",target:"node24",sourcemap:true};
        await build({...options,entryPoints:["host/cli.ts"],outfile:"build/host/host.mjs"});
        await build({...options,entryPoints:["host/storage/snapshot-worker.mjs"],outfile:"build/host/snapshot-worker.mjs"});`,
      "host/cli.ts":
        'import {shared} from "../src/shared.ts"; console.log(shared,new URL("./dynamic-worker.mjs",import.meta.url));',
      "host/storage/snapshot-worker.mjs":
        'import {shared} from "../../src/shared.ts"; console.log(shared);',
      "host/dynamic-worker.mjs": "// selected conservatively, not an esbuild import",
      "host/provider-guard.mjs": "// copied resource",
      "host/skills/example.md": "runtime skill",
      "host/unrelated.test.ts": "// not shipped",
      "src/shared.ts": "export const shared=1;",
      "src/UnrelatedUI.tsx": "export const UI=null;",
    };
    for (const [name, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), content);
    }
    const graph = await discoverHostInputs(root);
    for (const name of [
      "src/shared.ts",
      "host/dynamic-worker.mjs",
      "host/provider-guard.mjs",
      "host/skills/example.md",
      "host/storage/snapshot-worker.mjs",
    ])
      assert.ok(graph.inputs.includes(name), name);
    assert.ok(!graph.inputs.includes("src/UnrelatedUI.tsx"));
    assert.ok(!graph.inputs.includes("host/unrelated.test.ts"));
    assert.ok(graph.outputs.includes("build/host/snapshot-worker.mjs.map"));
    assert.deepEqual(graph.entryPoints, ["host/cli.ts", "host/storage/snapshot-worker.mjs"]);
    await assert.rejects(access(join(root, "build")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses dynamic entrypoint configuration rather than silently accepting an incomplete graph", () => {
  assert.throws(
    () =>
      hostBuildPlans(
        'await build({entryPoints: chooseEntrypoints(),outfile:"build/host/host.mjs"});',
      ),
    /Unsupported dynamic/,
  );
  assert.throws(
    () => hostBuildPlans('console.log("no build calls");'),
    /No Host build entrypoints/,
  );
});
