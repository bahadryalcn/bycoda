import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { VoiceModelsService } from "./voice-models";
import { downloadGguf, ggufInstalled, ggufModels, ggufWorkerArgs } from "./voice-gguf";

it("lists the pinned GGUF families without touching the network or changing the legacy selections", async () => {
  const home = await mkdtemp(join(tmpdir(), "voice-models-"));
  try {
    const service = new VoiceModelsService(home);
    const models = await service.list();
    expect(models.slice(0, 2).map(({ id }) => id)).toEqual(["small", "turbo"]);
    expect(new Set(ggufModels.map(({ id }) => id)).size).toBe(ggufModels.length);
    expect(
      ggufModels.every(
        (model) =>
          /^[a-z0-9_.-]+$/.test(model.folder) &&
          /^[a-f0-9]{40}$/.test(model.revision) &&
          /^[a-f0-9]{64}$/.test(model.sha256) &&
          /^[\w.-]+\.gguf$/i.test(model.filename),
      ),
    ).toBe(true);
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Nemotron Streaming 3.5",
          installed: false,
          languages: expect.arrayContaining(["tr"]),
        }),
        expect.objectContaining({ label: "Qwen3-ASR 1.7B", installed: false, format: "gguf" }),
        expect.objectContaining({
          label: "Voxtral Mini 4B Realtime",
          installed: false,
          format: "gguf",
        }),
      ]),
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("publishes the exact pinned GGUF bytes and keeps the installed model on a bad retry", async () => {
  const home = await mkdtemp(join(tmpdir(), "voice-models-"));
  try {
    const weights = "GGUF";
    const [catalog] = ggufModels;
    const model = {
      ...catalog,
      size: weights.length,
      sha256: createHash("sha256").update(weights).digest("hex"),
    };
    const path = join(home, ".bycoda", "voice", "models", model.folder);
    const runtime = fileURLToPath(ggufWorkerArgs(home, path, model)[3]);
    await mkdir(dirname(runtime), { recursive: true });
    await writeFile(runtime, "");
    await mkdir(path, { recursive: true });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(weights))
      .mockResolvedValueOnce(new Response("FAKE"));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    await downloadGguf(home, path, model, signal);
    await expect(ggufInstalled(home, path, model)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(model.revision), { signal });
    await expect(downloadGguf(home, path, model, signal)).rejects.toThrow("failed verification");
    await expect(readFile(join(path, model.filename), "utf8")).resolves.toBe(weights);
    await expect(readFile(join(path, `${model.filename}.partial`))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    vi.unstubAllGlobals();
    await rm(home, { recursive: true, force: true });
  }
});

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

it("reports model size and download progress", async () => {
  const home = await mkdtemp(join(tmpdir(), "voice-models-"));
  let finish!: () => void;
  const run = vi.fn(async (_python: string, args: string[]) => {
    const folder = args[3];
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "model.bin"), "x".repeat(1000));
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    await Promise.all(
      ["config.json", "tokenizer.json"].map((file) => writeFile(join(folder, file), "y")),
    );
  });
  const inspect = vi.fn(async () => ({ ready: false, missing: [], python: "python" }));
  const service = new VoiceModelsService(home, run, inspect);
  try {
    expect((await service.list())[0]).toMatchObject({ installed: false, sizeBytes: 484_000_000 });
    service.start("download", "small", false, {});
    expect(service.status()).toMatchObject({ bytesDone: 0, bytesTotal: 484_000_000 });
    await vi.waitFor(() => expect(service.status().bytesDone).toBe(1000), { timeout: 3000 });
    finish();
    await vi.waitFor(() => expect(service.status().state).toBe("ready"));
    expect((await service.list())[0]).toMatchObject({ installed: true, sizeBytes: 1002 });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

const inspectReady = () => vi.fn(async () => ({ ready: false, missing: [], python: "python" }));
const failure = (extra: Record<string, unknown>) =>
  Object.assign(new Error("Command failed: python -c ..."), extra);

it("stops a download that stops receiving bytes and names the stall, not a cancel", async () => {
  const home = await mkdtemp(join(tmpdir(), "voice-models-"));
  const run = vi.fn(
    (_python: string, _args: string[], signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  );
  const service = new VoiceModelsService(home, run, inspectReady(), { stallMs: 60, pollMs: 10 });
  try {
    service.start("download", "small", false, {});
    await vi.waitFor(() => expect(service.status().state).toBe("error"), { timeout: 3000 });
    expect(service.status().detail).toMatch(/stalled/);
    expect(service.status().detail).not.toMatch(/cancelled/);
    // The job slot and progress timer are released, so the owner can retry at once.
    expect(() => service.start("delete", "small", false, {})).not.toThrow();
    await vi.waitFor(() => expect(service.status().state).toBe("ready"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("keeps a slow download alive past the stall window while bytes keep arriving", async () => {
  const home = await mkdtemp(join(tmpdir(), "voice-models-"));
  const run = vi.fn(async (_python: string, args: string[], signal: AbortSignal) => {
    const folder = args[3];
    await mkdir(folder, { recursive: true });
    for (let step = 1; step <= 12; step += 1) {
      signal.throwIfAborted();
      await writeFile(join(folder, "model.bin"), "x".repeat(step * 100));
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await Promise.all(
      ["config.json", "tokenizer.json"].map((file) => writeFile(join(folder, file), "y")),
    );
  });
  // 12 steps x 25 ms is far longer than the 120 ms stall window.
  const service = new VoiceModelsService(home, run, inspectReady(), { stallMs: 120, pollMs: 10 });
  try {
    service.start("download", "small", false, {});
    await vi.waitFor(() => expect(service.status().state).toBe("ready"), { timeout: 5000 });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("passes the absolute download ceiling to the runner instead of a flat 30 minutes", async () => {
  const home = await mkdtemp(join(tmpdir(), "voice-models-"));
  const run = vi.fn(
    async (_python: string, _args: string[], _signal?: AbortSignal, _maxMs?: number) => {
      throw failure({ killed: true, signal: "SIGTERM", code: null });
    },
  );
  const service = new VoiceModelsService(home, run, inspectReady(), { maxMs: 7_000_000 });
  try {
    service.start("download", "small", false, {});
    await vi.waitFor(() => expect(service.status().state).toBe("error"));
    expect(run.mock.calls[0][3]).toBe(7_000_000);
    expect(service.status().detail).toMatch(/maximum allowed time/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it.each([
  [{ code: "ENOENT" }, /Python runtime could not be started/],
  [
    { code: 1, stderr: "ModuleNotFoundError: No module named 'huggingface_hub'" },
    /huggingface_hub package is missing/,
  ],
  [{ code: 1, stderr: "OSError: [Errno 28] No space left on device" }, /Not enough disk space/],
  [{ code: 1, stderr: "PermissionError: [WinError 5] Access is denied" }, /permissions/],
  [
    { code: 1, stderr: "ValueError: Consistency check failed: file should be of size 5" },
    /failed verification/,
  ],
  [
    { code: 1, stderr: "huggingface_hub.errors.RepositoryNotFoundError: 404 Client Error" },
    /repository is not available/,
  ],
  [
    { code: 1, stderr: "requests.exceptions.ConnectionError: Max retries exceeded" },
    /connection to the model download service failed/,
  ],
  [{ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true }, /too much output/],
  [
    { code: 3, stderr: "Traceback (most recent call last):\r\nRuntimeError: boom\u0007" },
    /\(exit code 3\): RuntimeError: boom$/,
  ],
  [{ code: 9 }, /\(exit code 9\) without an error message/],
])("reports a specific download failure for %j", async (extra, expected) => {
  const home = await mkdtemp(join(tmpdir(), "voice-models-"));
  const run = vi.fn(async (_python: string, _args: string[]) => {
    throw failure(extra);
  });
  const service = new VoiceModelsService(home, run, inspectReady());
  try {
    service.start("download", "small", false, {});
    await vi.waitFor(() => expect(service.status().state).toBe("error"));
    const detail = service.status().detail ?? "";
    expect(detail).toMatch(expected);
    expect(detail).not.toMatch(/Check the connection and available disk space/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("reports an incomplete download as an integrity problem, not a connection problem", async () => {
  const home = await mkdtemp(join(tmpdir(), "voice-models-"));
  const run = vi.fn(async (_python: string, args: string[]) => {
    await mkdir(args[3], { recursive: true });
    await writeFile(join(args[3], "model.bin"), "partial");
  });
  const service = new VoiceModelsService(home, run, inspectReady());
  try {
    service.start("download", "small", false, {});
    await vi.waitFor(() => expect(service.status().state).toBe("error"));
    expect(service.status().detail).toMatch(/incomplete/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
