import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecretValueStore } from "../secrets/secret-store";
import { DecisionConfigDamagedError } from "./decision-config";
import { DecisionModelsService } from "./decision-service";
import { DEFAULT_THRESHOLD, type DecisionRequest } from "./decision-types";
import * as discovery from "./discovery";
import { createLocalInstaller, type LocalInstaller } from "./local-install";
import { LocalRuntime } from "./local-runtime";

const API_KEY = "sk-test-0123456789-do-not-store-in-config";

function memorySecrets(): SecretValueStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async get(ref) {
      return values.get(ref);
    },
    async set(ref, value) {
      values.set(ref, value);
    },
    async delete(ref) {
      values.delete(ref);
    },
  };
}

let directory: string;
let secrets: ReturnType<typeof memorySecrets>;
let service: DecisionModelsService;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "decision-service-"));
  secrets = memorySecrets();
  service = new DecisionModelsService({ directory, secrets });
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const localClef = {
  name: "Clef",
  kind: "local" as const,
  adapter: "systemone" as const,
  local: { modelPath: "C:/models/clef.gguf" },
};

const request: DecisionRequest = {
  taskType: "screen_state",
  personalData: false,
  state: { page: "consent" },
  questions: {
    isConsent: {
      type: "noul",
      instructions: "Is this a cookie banner?",
      criteria: { true: "cookie banner", false: "anything else" },
    },
    action: {
      type: "choice",
      instructions: "Which control accepts?",
      criteria: { accept: "accept button", reject: "reject button" },
    },
  },
};

describe("DecisionModelsService without sources", () => {
  it.each([true, false])(
    "reuses a recorded running endpoint or starts a stopped folder model (healthy=%s)",
    async (healthy) => {
      let running = false;
      const start = vi.fn(async () => {
        running = true;
      });
      const installer = {
        start,
        endpoint: () => (running ? "http://127.0.0.1:45000" : undefined),
        touch: vi.fn(),
      } as unknown as LocalInstaller;
      const fetcher = vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/health"))
          return new Response("{}", { status: healthy ? 200 : 503 });
        return new Response(JSON.stringify({ answers: { check: { type: "noul", noul: 0.99 } } }), {
          status: 200,
        });
      });
      vi.stubGlobal("fetch", fetcher);
      try {
        const instance = new DecisionModelsService({
          directory,
          secrets,
          localInstaller: installer,
        });
        const source = await instance.addSource({
          ...localClef,
          endpoint: "http://127.0.0.1:8767/v1/systemone",
          local: { modelPath: "C:/m.gguf", runtimePath: "C:/llama-server.exe" },
        });
        await instance.testSource(source.id);
        expect(start).toHaveBeenCalledTimes(healthy ? 0 : 1);
        expect(fetcher).toHaveBeenCalledWith(
          healthy ? "http://127.0.0.1:8767/v1/systemone" : "http://127.0.0.1:45000/v1/systemone",
          expect.objectContaining({ method: "POST" }),
        );
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
  it("stops the servers the Host started on close and leaves an external one running", async () => {
    const spawnImpl = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
      child.kill = vi.fn(() => true);
      return child;
    });
    const runtime = new LocalRuntime({
      spawnImpl: spawnImpl as unknown as typeof spawn,
      fetchImpl: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
      allocatePort: async () => 45140,
    });
    const installer = createLocalInstaller({
      root: join(directory, "local"),
      catalog: () => ({ version: 1, providers: [] }) as never,
      runtime,
    });
    const external = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith("/health")
        ? new Response("{}", { status: 200 })
        : new Response(JSON.stringify({ answers: { check: { type: "noul", noul: 0.99 } } }), {
            status: 200,
          }),
    );
    vi.stubGlobal("fetch", external);
    try {
      const instance = new DecisionModelsService({
        directory,
        secrets,
        localInstaller: installer,
      });
      const owned = await instance.addSource({
        ...localClef,
        local: { modelPath: join(directory, "a.gguf"), runtimePath: join(directory, "llama") },
      });
      const outside = await instance.addSource({
        ...localClef,
        endpoint: "http://127.0.0.1:8767/v1/systemone",
        local: { modelPath: join(directory, "b.gguf") },
      });
      // The owner's own server answers /health, so the Host never spawns one for it.
      await instance.testSource(outside.id);
      expect(spawnImpl).not.toHaveBeenCalled();
      await runtime.start({
        sourceId: owned.id,
        executable: join(directory, "llama"),
        modelPath: join(directory, "a.gguf"),
      });
      const child = spawnImpl.mock.results[0]?.value as { kill: ReturnType<typeof vi.fn> };
      await Promise.all([instance.close(), instance.close()]);
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(spawnImpl).toHaveBeenCalledTimes(1);
      expect(runtime.isRunning(owned.id)).toBe(false);
      await expect(
        runtime.start({ sourceId: owned.id, executable: "llama", modelPath: "/a.gguf" }),
      ).rejects.toThrow("closed");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("keeps cached candidates when an incomplete retry has no new results", async () => {
    const candidate = { id: "model:cached", label: "Cached model", kind: "model_file" as const };
    const scan = vi
      .spyOn(discovery, "scan")
      .mockResolvedValueOnce({ found: [candidate] })
      .mockResolvedValueOnce({ found: [], incomplete: true });
    try {
      await service.scanDiscovery();
      expect(await service.scanDiscovery()).toEqual({
        found: [candidate],
        incomplete: true,
        scannedAt: expect.any(Number),
      });
      expect(await service.discoveryResults()).toEqual({
        found: [candidate],
        incomplete: true,
        scannedAt: expect.any(Number),
      });
    } finally {
      scan.mockRestore();
    }
  });
  describe("empty discovery cache", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    let clock: number;
    let cached: DecisionModelsService;
    const spyScan = () => vi.spyOn(discovery, "scan");
    let scan: ReturnType<typeof spyScan>;

    beforeEach(() => {
      clock = 1_000_000;
      cached = new DecisionModelsService({ directory, secrets, now: () => clock });
      scan = spyScan();
    });
    afterEach(() => {
      scan.mockRestore();
    });

    it("has no valid answer before any scan, so a first open may scan", async () => {
      expect(await cached.discoveryResults()).toEqual({ found: [] });
    });

    it("serves a confirmed empty scan without scanning again", async () => {
      scan.mockResolvedValue({ found: [] });
      await cached.scanDiscovery();
      clock += DAY_MS - 1;
      expect(await cached.discoveryResults()).toEqual({ found: [], scannedAt: 1_000_000 });
      expect(await cached.discoveryResults()).toEqual({ found: [], scannedAt: 1_000_000 });
      expect(scan).toHaveBeenCalledTimes(1);
    });

    it("expires an empty answer after the TTL", async () => {
      scan.mockResolvedValue({ found: [] });
      await cached.scanDiscovery();
      clock += DAY_MS;
      expect(await cached.discoveryResults()).toEqual({ found: [] });
    });

    it("drops an empty answer when the scan ports or folders change", async () => {
      scan.mockResolvedValue({ found: [] });
      await cached.scanDiscovery();
      await cached.updateDiscoverySettings({ extraPorts: [9001, 9000] });
      expect(await cached.discoveryResults()).toEqual({ found: [] });
      await cached.scanDiscovery();
      expect(await cached.discoveryResults()).toEqual({ found: [], scannedAt: clock });
      // The same ports in another order are the same scope.
      await cached.updateDiscoverySettings({ extraPorts: [9000, 9001] });
      expect(await cached.discoveryResults()).toEqual({ found: [], scannedAt: clock });
    });

    it("keeps an incomplete empty scan visible instead of treating it as confirmed empty", async () => {
      scan.mockResolvedValue({ found: [], incomplete: true });
      await cached.scanDiscovery();
      expect(await cached.discoveryResults()).toEqual({
        found: [],
        incomplete: true,
        scannedAt: 1_000_000,
      });
    });

    it("caches nothing when the scan fails, so the error stays visible", async () => {
      scan.mockRejectedValue(new Error("scan failed"));
      await expect(cached.scanDiscovery()).rejects.toThrow("scan failed");
      expect(await cached.discoveryResults()).toEqual({ found: [] });
    });

    it("always runs an explicit scan and replaces the cached answer", async () => {
      const candidate = { id: "env:OPENAI_API_KEY", label: "OpenAI", kind: "api_key" as const };
      scan.mockResolvedValueOnce({ found: [] }).mockResolvedValueOnce({ found: [candidate] });
      await cached.scanDiscovery();
      clock += 1_000;
      expect(await cached.scanDiscovery()).toEqual({ found: [candidate], scannedAt: clock });
      expect(scan).toHaveBeenCalledTimes(2);
      expect(await cached.discoveryResults()).toEqual({ found: [candidate], scannedAt: clock });
    });
  });
  it("coalesces scans and retains partial results after cancellation", async () => {
    const candidate = { id: "model:partial", label: "Partial model", kind: "model_file" as const };
    const scan = vi.spyOn(discovery, "scan").mockImplementation(
      async (_config, signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ found: [candidate], incomplete: true }),
            { once: true },
          );
        }),
    );
    try {
      expect(service.cancelDiscovery()).toEqual({ cancelled: false });
      const first = service.scanDiscovery();
      const second = service.scanDiscovery();
      await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(1));
      expect(service.cancelDiscovery()).toEqual({ cancelled: true });
      expect(service.cancelDiscovery()).toEqual({ cancelled: false });
      expect(await first).toEqual({
        found: [candidate],
        incomplete: true,
        scannedAt: expect.any(Number),
      });
      expect(await second).toEqual(await first);
      expect(await service.discoveryResults()).toEqual(await first);
    } finally {
      scan.mockRestore();
    }
  });
  it("answers every question as unavailable when no source is configured", async () => {
    const result = await service.decide(request);

    expect(result.answers).toEqual({
      isConsent: { error: "unavailable" },
      action: { error: "unavailable" },
    });
    expect(result.sourceChain).toEqual([]);
    expect(typeof result.durationMs).toBe("number");
  });

  it("keeps the default confidence threshold at 0.85", () => {
    expect(DEFAULT_THRESHOLD).toBe(0.85);
  });

  it("starts with no sources and default routing when no config file exists", async () => {
    expect(await service.listSources()).toEqual([]);
    expect(await service.getRouting()).toEqual({
      routing: {},
      localOnlyPersonalData: false,
    });
  });

  it("recommends no local model while the catalog has no verified download", async () => {
    expect((await service.recommendLocal()).modelId).toBeUndefined();
  });

  it("refuses an unconfirmed install and never downloads an unverified catalog model", async () => {
    await expect(
      service.installLocal({ modelId: "clef-flash-9b", confirm: "yes" }),
    ).rejects.toThrow("explicit confirmation");
    await expect(
      service.installLocal({ modelId: "clef-flash-9b", confirm: "INSTALL_DECISION_MODEL" }),
    ).rejects.toThrow("unverified model");
  });

  it("plans a catalog model without downloading it", async () => {
    const plan = await service.localPlan("clef-flash-9b");

    expect(plan).toMatchObject({ modelId: "clef-flash-9b", installable: false });
    expect(plan.files).toEqual([{ fileName: "Clef-Flash-Q4_K_M-vision.gguf" }]);
    expect(typeof plan.fits).toBe("boolean");
  });

  it("lists only catalog providers with a contract adapter, including the verified local runtime", () => {
    const { entries } = service.catalog();

    expect(entries.find((entry) => entry.id === "clef-local")).toMatchObject({
      kind: "local",
      adapter: "systemone",
      verified: true,
      endpoint: "http://127.0.0.1:8767/v1/systemone",
    });
    expect(entries.some((entry) => entry.id === "aimlapi")).toBe(false);
    expect(entries.every((entry) => entry.adapter)).toBe(true);
  });

  it("reports hardware with real memory and disk figures and a GPU list", async () => {
    const hardware = await service.hardware();

    expect(hardware.ramBytes).toBeGreaterThan(0);
    expect(hardware.freeRamBytes).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(hardware.gpus)).toBe(true);
    expect(hardware.freeDiskBytes).toBeGreaterThanOrEqual(0);
  });

  it("reports a local source without an installed file as not installed", async () => {
    const source = await service.addSource(localClef);

    expect(await service.localStatus(source.id)).toEqual({
      state: "not_installed",
      sourceId: source.id,
    });
  });

  it("refuses to start a local source that names no runtime", async () => {
    const source = await service.addSource(localClef);

    await expect(service.startLocal(source.id)).rejects.toThrow("no local runtime path");
  });

  it("rejects local actions for an unknown source", async () => {
    await expect(service.localStatus("src-missing")).rejects.toThrow("Decision source not found.");
    await expect(service.startLocal("src-missing")).rejects.toThrow("Decision source not found.");
  });
});

describe("DecisionModelsService sources and keys", () => {
  it("stores an API key in the vault and only its reference in the config file", async () => {
    const source = await service.addSource(
      {
        name: "OpenRouter",
        kind: "gateway",
        adapter: "systemone",
        endpoint: "https://openrouter.ai/api/v1/systemone",
      },
      API_KEY,
    );

    expect(source.secretRef).toBe(`decision-models.${source.id}`);
    expect(secrets.values.get(source.secretRef!)).toBe(API_KEY);
    expect(source.status).toBe("unknown");

    const onDisk = readFileSync(join(directory, "config.json"), "utf8");
    expect(onDisk).toContain(source.secretRef!);
    expect(onDisk).not.toContain(API_KEY);
  });

  it("adds a source without a key and does not touch the vault", async () => {
    const source = await service.addSource({
      name: "Ollama",
      kind: "local",
      adapter: "ollama-systemone",
      endpoint: "http://127.0.0.1:11434/api/systemone",
    });

    expect(source.secretRef).toBeUndefined();
    expect(secrets.values.size).toBe(0);
    expect(await service.listSources()).toEqual([source]);
  });

  it("replaces the key on update and keeps the same reference", async () => {
    const source = await service.addSource(
      { name: "TypeSafe", kind: "api", adapter: "systemone" },
      "old-key-value",
    );

    const updated = await service.updateSource(
      source.id,
      { name: "TypeSafe Jev" },
      "new-key-value",
    );

    expect(updated.name).toBe("TypeSafe Jev");
    expect(updated.secretRef).toBe(source.secretRef);
    expect(secrets.values.get(source.secretRef!)).toBe("new-key-value");
    const onDisk = readFileSync(join(directory, "config.json"), "utf8");
    expect(onDisk).not.toContain("new-key-value");
  });

  it("removes the source, its key, and its routing references", async () => {
    const source = await service.addSource(localClef, API_KEY);
    await service.setRouting({
      routing: { screen_state: { sourceIds: [source.id], threshold: DEFAULT_THRESHOLD } },
    });

    expect(await service.removeSource(source.id)).toEqual({ removed: true });

    expect(secrets.values.size).toBe(0);
    expect(await service.listSources()).toEqual([]);
    expect((await service.getRouting()).routing).toEqual({
      screen_state: { sourceIds: [], threshold: DEFAULT_THRESHOLD },
    });
  });

  it("rejects test and evaluate for an unknown source", async () => {
    await expect(service.testSource("src-missing")).rejects.toThrow("Decision source not found.");
    await expect(service.evaluateSource("src-missing")).rejects.toThrow(
      "Decision source not found.",
    );
  });

  it("reports a known local source without a runtime as unavailable", async () => {
    const source = await service.addSource(localClef);

    expect(await service.testSource(source.id)).toMatchObject({
      sourceId: source.id,
      ok: false,
      error: "unavailable",
    });
  });
});

describe("DecisionModelsService damaged settings", () => {
  it("keeps a damaged config file untouched and refuses writes", async () => {
    const path = join(directory, "config.json");
    writeFileSync(path, "{broken");

    await expect(service.addSource(localClef)).rejects.toThrow(
      "Decision model settings are damaged",
    );
    await expect(service.setRouting({ localOnlyPersonalData: true })).rejects.toThrow(
      "Decision model settings are damaged",
    );

    expect(readFileSync(path, "utf8")).toBe("{broken");
    expect(secrets.values.size).toBe(0);
  });

  it("reports damage on settings reads instead of showing an empty default config", async () => {
    writeFileSync(join(directory, "config.json"), "{broken");

    await expect(service.listSources()).rejects.toBeInstanceOf(DecisionConfigDamagedError);
    await expect(service.getRouting()).rejects.toBeInstanceOf(DecisionConfigDamagedError);
    await expect(service.discoverySettings()).rejects.toBeInstanceOf(DecisionConfigDamagedError);
    await expect(service.getFirstRun()).rejects.toBeInstanceOf(DecisionConfigDamagedError);
    await expect(service.testSource("src-1")).rejects.toBeInstanceOf(DecisionConfigDamagedError);
  });

  it("answers decide with config_damaged for every question, not a silent unavailable", async () => {
    writeFileSync(join(directory, "config.json"), "{broken");

    const result = await service.decide(request);

    expect(Object.values(result.answers)).toEqual(
      Object.keys(request.questions).map(() => ({ error: "config_damaged" })),
    );
    expect(result.sourceChain).toEqual([]);
  });
});

describe("DecisionModelsService routing", () => {
  it("round-trips routing and the personal-data switch", async () => {
    const saved = await service.setRouting({
      routing: { optout: { sourceIds: [], threshold: 0.9 } },
      localOnlyPersonalData: true,
    });

    expect(saved).toEqual({
      routing: { optout: { sourceIds: [], threshold: 0.9 } },
      localOnlyPersonalData: true,
    });
    expect(await service.getRouting()).toEqual(saved);
  });
});

describe("DecisionModelsService llm sources", () => {
  it("asks the provider harness of an llm source through the injected runner", async () => {
    const runTextPrompt = vi.fn(async () =>
      JSON.stringify({ answers: { isConsent: { probabilities: { true: 0.95, false: 0.05 } } } }),
    );
    const withRunner = new DecisionModelsService({ directory, secrets, runTextPrompt });
    const source = await withRunner.addSource({
      name: "Provider text",
      kind: "llm",
      adapter: "llm-structured",
      harness: "codex",
      model: "small",
    });
    await withRunner.setRouting({
      routing: { screen_state: { sourceIds: [source.id], threshold: DEFAULT_THRESHOLD } },
    });

    const result = await withRunner.decide({
      taskType: "screen_state",
      personalData: false,
      state: { page: "consent" },
      questions: { isConsent: request.questions.isConsent },
    });

    expect(runTextPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ harness: "codex", model: "small" }),
    );
    expect(result.answers.isConsent).toMatchObject({
      value: true,
      sourceId: source.id,
      model: "small",
    });
  });
});

describe("DecisionModelsService discovery, first run and manual checks", () => {
  it("round-trips scan ports and folders and refuses relative folders", async () => {
    const folder = join(directory, "models");

    expect(await service.discoverySettings()).toEqual({ extraPorts: [], extraFolders: [] });
    expect(
      await service.updateDiscoverySettings({ extraPorts: [9000], extraFolders: [folder] }),
    ).toEqual({ extraPorts: [9000], extraFolders: [folder] });
    await expect(service.updateDiscoverySettings({ extraFolders: ["models"] })).rejects.toThrow(
      "absolute paths",
    );
    expect(await service.discoverySettings()).toEqual({
      extraPorts: [9000],
      extraFolders: [folder],
    });
  });

  it("stores the first-run decision", async () => {
    expect(await service.getFirstRun()).toEqual({ dismissed: false });
    expect(await service.setFirstRun(true)).toEqual({ dismissed: true });
    expect(await service.getFirstRun()).toEqual({ dismissed: true });
  });

  it("refuses a key header that would replace framing or cookie headers", async () => {
    await expect(
      service.addSource({
        name: "Custom",
        kind: "api",
        adapter: "custom",
        endpoint: "https://example.test/v1/systemone",
        authHeader: "Cookie",
      }),
    ).rejects.toThrow("Invalid key header name.");
    expect(await service.listSources()).toEqual([]);
  });

  it("resolves a discovered file through model_installation without adding a source", async () => {
    const modelPath = join(directory, "discovered.gguf");
    writeFileSync(
      modelPath,
      Buffer.concat([Buffer.from("GGUF"), Buffer.from([3, 0, 0, 0]), Buffer.alloc(16)]),
    );
    expect(
      await service.verifyManual({ kind: "model_installation", path: modelPath }),
    ).toMatchObject({
      kind: "installation_folder",
      folder: realpathSync.native(directory),
      modelPath: realpathSync.native(modelPath),
      verified: false,
    });
    expect(await service.listSources()).toEqual([]);
  });

  it("refuses a relative model path before reading it", async () => {
    await expect(service.verifyManual({ kind: "model_file", path: "clef.gguf" })).rejects.toThrow(
      "absolute .gguf",
    );
  });

  it("refuses an endpoint address with credentials before probing it", async () => {
    await expect(
      service.verifyManual({
        kind: "endpoint",
        url: "https://user:secret@example.test/v1/systemone",
      }),
    ).rejects.toThrow("without credentials");
  });
});
