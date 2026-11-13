import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { VoiceModelsService } from "./voice-models";

it("downloads, tests and deletes only fixed owned model folders", async () => {
  const home = await mkdtemp(join(tmpdir(), "voice-models-"));
  const run = vi.fn(async (_python: string, args: string[]) => {
    if (args[1].includes("snapshot_download")) {
      const folder = args[3];
      await mkdir(folder, { recursive: true });
      await Promise.all(
        ["model.bin", "config.json", "tokenizer.json"].map((file) =>
          writeFile(join(folder, file), "model"),
        ),
      );
    }
  });
  const inspect = vi.fn(async () => ({ ready: false, missing: [], python: "python" }));
  const service = new VoiceModelsService(home, run, inspect);
  try {
    expect(() => service.start("download", "../../outside", false, {})).toThrow(
      "Invalid local transcription model",
    );
    expect(() => service.start("download", "small", true, {})).toThrow("Disconnect voice");
    service.start("download", "small", false, {});
    await vi.waitFor(() => expect(service.status().state).toBe("ready"));
    expect((await service.list())[0].installed).toBe(true);
    service.start("test", "small", false, {});
    await vi.waitFor(() => expect(service.status().state).toBe("ready"));
    expect(run.mock.calls[1][1][1]).toContain("local_files_only=True");
    service.start("delete", "small", false, {});
    await vi.waitFor(() => expect(service.status().state).toBe("ready"));
    expect((await service.list())[0].installed).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("refuses a linked model directory", async () => {
  const home = await mkdtemp(join(tmpdir(), "voice-models-"));
  const root = join(home, ".bycoda", "voice", "models");
  try {
    await mkdir(root, { recursive: true });
    await symlink(
      home,
      join(root, "whisper-small"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(new VoiceModelsService(home).list()).rejects.toThrow("regular folder");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("cancels a running download and leaves other actions blocked until it stops", async () => {
  const home = await mkdtemp(join(tmpdir(), "voice-models-"));
  const run = vi.fn(
    (_python: string, _args: string[], signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      }),
  );
  const service = new VoiceModelsService(
    home,
    run,
    vi.fn(async () => ({ ready: false, missing: [], python: "python" })),
  );
  try {
    service.start("download", "small", false, {});
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(() => service.start("delete", "small", false, {})).toThrow(
      "Another model action is running",
    );
    service.cancel();
    await vi.waitFor(() =>
      expect(service.status()).toMatchObject({ state: "error", detail: "Model action cancelled." }),
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
