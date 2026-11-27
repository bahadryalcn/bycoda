import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPullLine, ollamaPortFromEnv, OllamaService, parseOllamaTags } from "./ollama";
import type { OllamaPull } from "../../src/shared/model/host-contracts/ollama";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const down = async () => {
  throw new TypeError("fetch failed");
};

/** No OpenCode config and no binary on PATH, so only the fakes decide the answer. */
const isolated = { env: { PATH: "", OPENCODE_CONFIG: "/nonexistent/opencode.json" }, home: "/h" };

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("parseOllamaTags", () => {
  it("keeps valid names and reads chat and tool support", () => {
    expect(
      parseOllamaTags({
        models: [
          {
            name: "qwen3:8b",
            size: 5_000,
            details: { parameter_size: "8.2B" },
            capabilities: ["completion", "tools"],
          },
          { name: "nomic-embed-text:latest", size: 1, capabilities: ["embedding"] },
          { name: "legacy:1b", size: 2 },
          { name: "bad name; rm", size: 3 },
          "nonsense",
        ],
      }),
    ).toEqual([
      { name: "qwen3:8b", size: 5_000, parameterSize: "8.2B", chat: true, tools: true },
      { name: "nomic-embed-text:latest", size: 1, chat: false, tools: false },
      { name: "legacy:1b", size: 2, chat: true, tools: false },
    ]);
    expect(parseOllamaTags(null)).toEqual([]);
  });
});

describe("applyPullLine", () => {
  it("tracks progress, ignores noise and finishes on success", () => {
    const pull: OllamaPull = { model: "m:1b", state: "running", completed: 0, total: 0 };
    applyPullLine(pull, '{"status":"pulling manifest"}');
    applyPullLine(pull, "not json");
    applyPullLine(pull, '{"status":"pulling abc","total":100,"completed":40}');
    expect(pull).toMatchObject({ state: "running", completed: 40, total: 100 });
    applyPullLine(pull, '{"status":"success"}');
    expect(pull).toMatchObject({ state: "done", completed: 100 });
  });

  it("throws Ollama's own error", () => {
    const pull: OllamaPull = { model: "m:1b", state: "running", completed: 0, total: 0 };
    expect(() =>
      applyPullLine(pull, '{"error":"pull model manifest: file does not exist"}'),
    ).toThrow("file does not exist");
  });
});

describe("OllamaService", () => {
  it("reports missing, stopped and running runtimes", async () => {
    const missing = new OllamaService({ ...isolated, fetchImpl: down, exists: async () => false });
    expect(await missing.status()).toMatchObject({
      runtime: "missing",
      models: [],
      pull: null,
      opencode: { config: "ready", models: [] },
    });

    const stopped = new OllamaService({ ...isolated, fetchImpl: down, exists: async () => true });
    expect((await stopped.status()).runtime).toBe("stopped");

    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/api/version")
        ? json({ version: "0.30.10" })
        : json({ models: [{ name: "qwen3:0.6b", size: 1, capabilities: ["completion"] }] }),
    );
    const running = new OllamaService({ ...isolated, fetchImpl: fetchImpl as typeof fetch });
    expect(await running.status()).toMatchObject({
      runtime: "running",
      version: "0.30.10",
      models: [{ name: "qwen3:0.6b", chat: true, tools: false }],
    });
    // Only loopback is contacted.
    for (const [url] of fetchImpl.mock.calls)
      expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:11434\//);
  });

  it("starts a detached server and waits until it answers", async () => {
    let up = false;
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawnImpl = vi.fn(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }) as unknown as typeof spawn;
    const sleep = vi.fn(async () => {
      up = true;
    });
    const fetchImpl = (async (url: string | URL | Request) => {
      if (!up) throw new TypeError("fetch failed");
      return String(url).endsWith("/api/version") ? json({ version: "1" }) : json({ models: [] });
    }) as typeof fetch;
    const service = new OllamaService({
      ...isolated,
      fetchImpl,
      spawnImpl,
      sleep,
      exists: async (path) => path.endsWith("ollama.exe") || path.endsWith("ollama"),
      platform: "win32",
      env: { ...isolated.env, LOCALAPPDATA: "C:/Users/u/AppData/Local" },
    });
    expect((await service.start()).runtime).toBe("running");
    expect(spawnImpl).toHaveBeenCalledWith(
      expect.stringMatching(/Ollama[\\/]ollama\.exe$/),
      ["serve"],
      expect.objectContaining({ detached: true, stdio: "ignore", windowsHide: true }),
    );
    expect(child.unref).toHaveBeenCalled();
  });

  it("refuses to start when Ollama is not installed", async () => {
    const service = new OllamaService({ ...isolated, fetchImpl: down, exists: async () => false });
    await expect(service.start()).rejects.toThrow(/not installed/);
  });

  it("downloads with progress split across chunks and allows one download at a time", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = (async (url: string | URL | Request) => {
      if (!String(url).endsWith("/api/pull")) throw new TypeError("down");
      await gate;
      return new Response(
        streamOf([
          '{"status":"pulling a","total":10,"comp',
          'leted":4}\n{"status":"verifying"}\n',
          '{"status":"success"}',
        ]),
        { status: 200 },
      );
    }) as typeof fetch;
    const service = new OllamaService({ ...isolated, fetchImpl, exists: async () => false });
    const pull = service.startPull("qwen3:0.6b");
    expect(() => service.startPull("other:1b")).toThrow(/Another model/);
    release();
    await vi.waitFor(() => expect(pull.state).toBe("done"));
    expect(pull).toMatchObject({ completed: 10, total: 10 });
    expect((await service.status()).pull).toBe(pull);
  });

  it("reports a failed and a cancelled download", async () => {
    const failing = new OllamaService({
      ...isolated,
      exists: async () => false,
      fetchImpl: (async () =>
        new Response(streamOf(['{"error":"file does not exist"}\n']), {
          status: 200,
        })) as typeof fetch,
    });
    const failed = failing.startPull("nope:1b");
    await vi.waitFor(() => expect(failed.state).toBe("failed"));
    expect(failed.error).toBe("file does not exist");

    const hanging = new OllamaService({
      ...isolated,
      exists: async () => false,
      fetchImpl: ((_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          // Like fetch: an already aborted signal rejects at once.
          if (init?.signal?.aborted) reject(new Error("aborted"));
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as typeof fetch,
    });
    const cancelled = hanging.startPull("big:70b");
    hanging.cancelPull();
    await vi.waitFor(() => expect(cancelled.state).toBe("cancelled"));
    expect(cancelled.error).toBeUndefined();
  });
});

describe("Ollama port", () => {
  it("reads the default from OLLAMA_HOST", () => {
    expect(ollamaPortFromEnv({})).toBe(11434);
    expect(ollamaPortFromEnv({ OLLAMA_HOST: "0.0.0.0:11500" })).toBe(11500);
    expect(ollamaPortFromEnv({ OLLAMA_HOST: "http://127.0.0.1:11600/" })).toBe(11600);
    expect(ollamaPortFromEnv({ OLLAMA_HOST: ":11700" })).toBe(11700);
    expect(ollamaPortFromEnv({ OLLAMA_HOST: "127.0.0.1" })).toBe(11434);
    expect(ollamaPortFromEnv({ OLLAMA_HOST: "host:99999" })).toBe(11434);
  });

  it("saves the owner's port, uses it everywhere and moves OpenCode's models to it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ollama-port-"));
    try {
      const settingsPath = join(directory, "ollama", "settings.json");
      const opencode = join(directory, "opencode.json");
      await writeFile(
        opencode,
        JSON.stringify({
          provider: {
            ollama: {
              options: { baseURL: "http://127.0.0.1:11434/v1" },
              models: { "qwen3:8b": { name: "qwen3:8b" } },
            },
          },
        }),
      );
      const urls: string[] = [];
      const fetchImpl = (async (url: string | URL | Request) => {
        urls.push(String(url));
        throw new TypeError("down");
      }) as typeof fetch;
      const options = {
        env: { PATH: "", OPENCODE_CONFIG: opencode, OLLAMA_HOST: "127.0.0.1:11500" },
        home: directory,
        exists: async () => false,
        fetchImpl,
        settingsPath,
      };
      const service = new OllamaService(options);
      expect(await service.status()).toMatchObject({ port: 11500, portCustom: false });

      expect(await service.setPort(12000)).toMatchObject({ port: 12000, portCustom: true });
      expect(urls.at(-1)).toMatch(/^http:\/\/127\.0\.0\.1:12000\//);
      const saved = JSON.parse(await readFile(opencode, "utf8"));
      expect(saved.provider.ollama.options.baseURL).toBe("http://127.0.0.1:12000/v1");
      expect(Object.keys(saved.provider.ollama.models)).toEqual(["qwen3:8b"]);

      // A new Host process reads the saved port back.
      expect((await new OllamaService(options).status()).port).toBe(12000);
      expect(await service.setPort(null)).toMatchObject({ port: 11500, portCustom: false });
      await expect(service.setPort(70000)).rejects.toThrow(/Invalid/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("starts Ollama on the chosen port", async () => {
    let up = false;
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawnImpl = vi.fn(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }) as unknown as typeof spawn;
    const service = new OllamaService({
      ...isolated,
      platform: "win32",
      exists: async () => true,
      spawnImpl,
      sleep: async () => {
        up = true;
      },
      fetchImpl: (async () => {
        if (!up) throw new TypeError("down");
        return json({ version: "1", models: [] });
      }) as typeof fetch,
    });
    await service.setPort(12100);
    await service.start();
    expect(spawnImpl).toHaveBeenCalledWith(
      expect.any(String),
      ["serve"],
      expect.objectContaining({ env: expect.objectContaining({ OLLAMA_HOST: "127.0.0.1:12100" }) }),
    );
  });
});
