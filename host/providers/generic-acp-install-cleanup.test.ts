import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenericAcpService } from "./generic-acp";

// npm is never run: the fake writes what a successful install leaves behind, or fails on demand.
const npm = vi.hoisted(() => ({
  run: undefined as undefined | ((args: string[], callback: (error: Error | null) => void) => void),
}));
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_command: string, args: string[], _options: unknown, callback: never) =>
    npm.run?.(args, callback as never),
  ),
}));

const registry = [
  {
    id: "one",
    name: "One",
    version: "1.0.0",
    description: "",
    package: "agent-one@1.0.0",
    args: ["--acp"],
    supported: true,
  },
  {
    id: "one",
    name: "One",
    version: "2.0.0",
    description: "",
    package: "agent-one@2.0.0",
    args: ["--acp"],
    supported: true,
  },
  {
    id: "one",
    name: "One",
    version: "3.0.0",
    description: "",
    package: "agent-one@3.0.0",
    args: ["--acp"],
    supported: true,
  },
  {
    id: "two",
    name: "Two",
    version: "1.0.0",
    description: "",
    package: "agent-two@1.0.0",
    args: [],
    supported: true,
  },
];

/** Mirrors npm's `--prefix` layout closely enough for the script lookup in install(). */
async function writeInstall(args: string[], name: string) {
  const prefix = args[args.indexOf("--prefix") + 1]!;
  const packageRoot = join(prefix, "node_modules", name);
  await mkdir(join(packageRoot, "bin"), { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({ name, version: "1.0.0", bin: { [name]: "bin/agent.js" } }),
  );
  await writeFile(join(packageRoot, "bin", "agent.js"), "");
}
const succeed = (name: string) => (args: string[], callback: (error: Error | null) => void) =>
  void writeInstall(args, name).then(() => callback(null));
const fail = (args: string[], callback: (error: Error | null) => void) => {
  void mkdir(args[args.indexOf("--prefix") + 1]!, { recursive: true }).then(() =>
    callback(new Error("npm exited 1")),
  );
};

let directory: string;
let service: GenericAcpService;
const acpRoot = () => join(directory, "acp-tools", "one");
const generations = () => readdir(acpRoot()).catch(() => [] as string[]);

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "bycoda-acp-prune-"));
  service = new GenericAcpService(directory);
  vi.spyOn(service, "registry").mockResolvedValue(registry as never);
});
afterEach(async () => {
  npm.run = undefined;
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe("ACP install generations", () => {
  it("removes a failed attempt's own prefix and leaves the selected install running", async () => {
    npm.run = succeed("agent-one");
    await service.install("one", "1.0.0");
    const selected = (await service.get("one")).args[0]!;

    npm.run = fail;
    await expect(service.install("one", "2.0.0")).rejects.toThrow("ACP installation failed");

    expect(await generations()).toHaveLength(1);
    expect((await service.get("one")).args[0]).toBe(selected);
    await expect(access(selected)).resolves.toBeUndefined();
  });

  it("keeps the previous generation as rollback and prunes older ones after a successful update", async () => {
    await mkdir(join(acpRoot(), "orphaned-from-old-build"), { recursive: true });
    npm.run = succeed("agent-one");

    await service.install("one", "1.0.0");
    expect(await generations()).toHaveLength(1);
    expect(await generations()).not.toContain("orphaned-from-old-build");
    const first = relative(acpRoot(), (await service.get("one")).args[0]!).split(sep)[0];

    await service.install("one", "2.0.0");
    const second = relative(acpRoot(), (await service.get("one")).args[0]!).split(sep)[0];
    expect((await generations()).sort()).toEqual([first, second].sort());

    await service.install("one", "3.0.0");
    const third = relative(acpRoot(), (await service.get("one")).args[0]!).split(sep)[0];
    expect((await generations()).sort()).toEqual([second, third].sort());
    expect(await generations()).not.toContain(first);
  });

  it("discards the new attempt when saving its config fails, keeping the previous install", async () => {
    npm.run = succeed("agent-one");
    await service.install("one", "1.0.0");
    const selected = (await service.get("one")).args[0]!;

    npm.run = succeed("agent-one");
    vi.spyOn(service, "save").mockRejectedValueOnce(new Error("disk full"));
    await expect(service.install("one", "2.0.0")).rejects.toThrow("disk full");

    expect(await generations()).toHaveLength(1);
    expect((await service.get("one")).args[0]).toBe(selected);
  });

  it("removes every generation of a removed provider but not another provider's", async () => {
    npm.run = succeed("agent-one");
    await service.install("one", "1.0.0");
    await service.install("one", "2.0.0");
    await mkdir(join(directory, "acp-tools", "two", "kept"), { recursive: true });

    await service.remove("one");

    expect(await generations()).toEqual([]);
    await expect(readdir(join(directory, "acp-tools", "two"))).resolves.toEqual(["kept"]);
  });

  it("does not prune an install that is still being written", async () => {
    let finish!: (error: Error | null) => void;
    const started = new Promise<void>((resolve) => {
      npm.run = (args, callback) => {
        finish = callback;
        void writeInstall(args, "agent-one").then(resolve);
      };
    });
    const installing = service.install("one", "1.0.0");
    await started;

    await service.remove("one");
    expect(await generations()).toHaveLength(1);

    finish(null);
    await installing;
    await expect(access((await service.get("one")).args[0]!)).resolves.toBeUndefined();
  });
});
