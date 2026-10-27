import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { devAdvertisedCapabilities } from "./dev-capabilities";
import type { BuildIdentity } from "./workspace-contracts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true });
});
const capabilities = ["workspaces.managed.v1", "sessions", "models.list"];
const identity = { channel: "dev" } as BuildIdentity;
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-dev-capabilities-"));
  directories.push(directory);
  const env = {
    BYCODA_DEV_PROFILE_ID: "acceptance",
    BYCODA_DEV_RUN_ID: "run",
    BYCODA_DESKTOP_DATA_DIR: join(directory, "desktop"),
    BYCODA_HOST_DIR: directory,
  };
  const file = join(directory, "dev-capabilities.json");
  return { directory, env, file };
}

it("advertises existing capabilities when an isolated run has no override", async () => {
  const { directory, env } = await setup();
  expect(await devAdvertisedCapabilities(capabilities, identity, directory, env)).toEqual(
    capabilities,
  );
});

it("hides an old Host capability then restores it on the next describe", async () => {
  const { directory, env, file } = await setup();
  await writeFile(file, JSON.stringify({ disabled: ["workspaces.managed.v1", "invented"] }));
  expect(await devAdvertisedCapabilities(capabilities, identity, directory, env)).toEqual([
    "sessions",
    "models.list",
  ]);
  await writeFile(file, JSON.stringify({ disabled: [] }));
  expect(await devAdvertisedCapabilities(capabilities, identity, directory, env)).toEqual(
    capabilities,
  );
});

it("ignores overrides outside a stamped isolated development Host", async () => {
  const { directory, env, file } = await setup();
  await writeFile(file, JSON.stringify({ disabled: capabilities }));
  for (const [stamp, environment, dataPath] of [
    [null, env, directory],
    [{ ...identity, channel: "release" }, env, directory],
    [identity, { ...env, BYCODA_DEV_RUN_ID: "" }, directory],
    [identity, { ...env, BYCODA_DEV_PROFILE_ID: "" }, directory],
    [identity, { ...env, BYCODA_DESKTOP_DATA_DIR: "" }, directory],
    [identity, env, join(directory, "another-host")],
  ] as const)
    expect(await devAdvertisedCapabilities(capabilities, stamp, dataPath, environment)).toEqual(
      capabilities,
    );
});

it("rejects malformed overrides so acceptance cannot silently test the wrong Host", async () => {
  const { directory, env, file } = await setup();
  await writeFile(file, JSON.stringify({ disabled: [null] }));
  await expect(devAdvertisedCapabilities(capabilities, identity, directory, env)).rejects.toThrow(
    "disabled: string[]",
  );
});
