import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import type { z } from "zod";
import type {
  DecisionCatalogEntrySchema,
  DecisionManualVerifyParamsSchema,
  DecisionManualVerifyResultSchema,
} from "../../src/shared/model/host-contracts/decision-models";
import type { SecretValueStore } from "../secrets/secret-store";
import { type AdapterTransport, isAllowedAuthHeader } from "./contract-adapters/common";
import { type CatalogProvider, loadCatalog } from "./catalog";
import { loadDecisionConfig, MAX_DECISION_SOURCES, saveDecisionConfig } from "./decision-config";
import { createDecisionGateway, type DecisionGateway } from "./decision-gateway";
import type {
  DecisionConfig,
  DecisionEvaluation,
  DecisionRequest,
  DecisionResult,
  DecisionRouting,
  DecisionService,
  DecisionSource,
  DecisionSourceInput,
  DecisionSourceTest,
  DiscoveryResult,
  HardwareInfo,
  LocalRecommendation,
  LocalStatus,
} from "./decision-types";
import * as discovery from "./discovery";
import { readHardware } from "./hardware";
import { type InstallPlan, createLocalInstaller, type LocalInstaller } from "./local-install";
import { verifyEndpoint, verifyInstallationFolder, verifyModelFile } from "./manual-verify";

const CONFIG_FILE = "config.json";
const LOCAL_FOLDER = "local";
const SCAN_TIMEOUT_MS = 30_000;

export type DecisionModelsServiceOptions = {
  /** The decision-models folder: holds config.json, the secret vault and local model folders. */
  directory: string;
  secrets: SecretValueStore;
  /** Text runner for llm-structured sources, given the source's harness. Without it those sources are unavailable. */
  runTextPrompt?: AdapterTransport["runTextPrompt"];
  /** Tests inject a fake; production uses the bundled catalog and the real local runtime. */
  localInstaller?: LocalInstaller;
};

export type CatalogEntry = z.output<typeof DecisionCatalogEntrySchema>;
export type ManualVerifyInput = z.output<typeof DecisionManualVerifyParamsSchema>;
export type ManualVerifyResult = z.output<typeof DecisionManualVerifyResultSchema>;
export type DiscoverySettings = DecisionConfig["discovery"];

const secretRefFor = (sourceId: string) => `decision-models.${sourceId}`;

/** System One path of each adapter, appended to the loopback address a local runtime reports. */
const LOCAL_PATHS: Partial<Record<DecisionSource["adapter"], string>> = {
  systemone: "/v1/systemone",
  custom: "/v1/systemone",
  "ollama-systemone": "/api/systemone",
  decisions: "/v1/decisions",
};

const KIND_BY_TYPE = { hosted_api: "api", gateway: "gateway", local_runtime: "local" } as const;

/** Only providers with a known contract adapter and type are listed; the rest cannot be connected. */
function catalogEntries(providers: CatalogProvider[]): CatalogEntry[] {
  return providers.flatMap((provider) => {
    if (!provider.adapter || !provider.type) return [];
    return [
      {
        id: provider.id,
        name: provider.name,
        kind: KIND_BY_TYPE[provider.type],
        adapter: provider.adapter,
        ...(provider.defaultEndpoint ? { endpoint: provider.defaultEndpoint } : {}),
        verified: provider.verified,
        ...(provider.docsUrl ? { docsUrl: provider.docsUrl } : {}),
        ...(provider.models.length > 0
          ? {
              models: provider.models.map((model) => ({
                id: model.id,
                name: model.name,
                verified: model.verified,
              })),
            }
          : {}),
      },
    ];
  });
}

function assertKeyHeader(name: string | undefined): void {
  if (name !== undefined && !isAllowedAuthHeader(name)) throw new Error("Invalid key header name.");
}

function withoutSourceRouting(routing: DecisionRouting, sourceId: string): DecisionRouting {
  return Object.fromEntries(
    Object.entries(routing).flatMap(([task, route]) =>
      route
        ? [[task, { ...route, sourceIds: route.sourceIds.filter((id) => id !== sourceId) }]]
        : [],
    ),
  ) as DecisionRouting;
}

/** Facade used by owner RPC and, later, Social and AI tools. Keys never enter the config file. */
export class DecisionModelsService implements DecisionService {
  private readonly directory: string;
  private readonly configPath: string;
  private readonly secrets: SecretValueStore;
  private readonly gateway: DecisionGateway;
  private readonly installer: LocalInstaller;
  private queue: Promise<unknown> = Promise.resolve();
  private lastScan: DiscoveryResult = { found: [] };

  constructor(options: DecisionModelsServiceOptions) {
    this.directory = options.directory;
    this.configPath = join(options.directory, CONFIG_FILE);
    this.secrets = options.secrets;
    this.installer =
      options.localInstaller ??
      createLocalInstaller({ root: join(options.directory, LOCAL_FOLDER), catalog: loadCatalog });
    this.gateway = createDecisionGateway({
      loadConfig: async () => (await loadDecisionConfig(this.configPath)).config,
      secrets: this.secrets,
      runTextPrompt: options.runTextPrompt,
      resolveEndpoint: (source) => this.localAddress(source),
      touchLocal: (sourceId) => this.installer.touch(sourceId),
    });
  }

  decide(request: DecisionRequest): Promise<DecisionResult> {
    return this.gateway.decide(request);
  }

  async listSources(): Promise<DecisionSource[]> {
    return (await this.load()).sources;
  }

  async addSource(input: DecisionSourceInput, apiKey?: string): Promise<DecisionSource> {
    assertKeyHeader(input.authHeader);
    const id = `src-${randomUUID()}`;
    let secretRef: string | undefined;
    if (apiKey !== undefined) {
      secretRef = secretRefFor(id);
      await this.secrets.set(secretRef, apiKey);
    }
    try {
      return await this.mutate((config) => {
        if (config.sources.length >= MAX_DECISION_SOURCES)
          throw new Error("Too many decision sources.");
        const source: DecisionSource = {
          ...input,
          id,
          status: "unknown",
          ...(secretRef ? { secretRef } : {}),
        };
        return { config: { ...config, sources: [...config.sources, source] }, result: source };
      });
    } catch (error) {
      if (secretRef !== undefined) await this.secrets.delete(secretRef).catch(() => undefined);
      throw error;
    }
  }

  async updateSource(
    id: string,
    patch: Partial<DecisionSourceInput>,
    apiKey?: string,
  ): Promise<DecisionSource> {
    assertKeyHeader(patch.authHeader);
    const updated = await this.mutate((config) => {
      const index = config.sources.findIndex((source) => source.id === id);
      if (index < 0) throw new Error("Decision source not found.");
      const current = config.sources[index];
      const secretRef = apiKey === undefined ? current.secretRef : secretRefFor(id);
      const source: DecisionSource = {
        ...current,
        ...patch,
        id,
        ...(secretRef ? { secretRef } : {}),
      };
      const sources = config.sources.map((entry, position) =>
        position === index ? source : entry,
      );
      return { config: { ...config, sources }, result: source };
    });
    // Saved before the key is stored: a failed store leaves a reference the user can re-key.
    if (apiKey !== undefined) await this.secrets.set(secretRefFor(id), apiKey);
    return updated;
  }

  async removeSource(id: string): Promise<{ removed: boolean }> {
    const secretRef = await this.mutate((config) => {
      const source = config.sources.find((entry) => entry.id === id);
      if (!source) throw new Error("Decision source not found.");
      return {
        config: {
          ...config,
          sources: config.sources.filter((entry) => entry !== source),
          routing: withoutSourceRouting(config.routing, id),
        },
        result: source.secretRef,
      };
    });
    if (secretRef !== undefined) await this.secrets.delete(secretRef).catch(() => undefined);
    return { removed: true };
  }

  async testSource(id: string): Promise<DecisionSourceTest> {
    await this.requireSource(id);
    return this.gateway.test(id);
  }

  async evaluateSource(id: string): Promise<DecisionEvaluation> {
    await this.requireSource(id);
    return this.gateway.evaluate(id);
  }

  async scanDiscovery(): Promise<DiscoveryResult> {
    const config = await this.load();
    this.lastScan = await discovery.scan(config, AbortSignal.timeout(SCAN_TIMEOUT_MS));
    return this.lastScan;
  }

  discoveryResults(): DiscoveryResult {
    return this.lastScan;
  }

  async discoverySettings(): Promise<DiscoverySettings> {
    return (await this.load()).discovery;
  }

  async updateDiscoverySettings(patch: Partial<DiscoverySettings>): Promise<DiscoverySettings> {
    if (patch.extraFolders?.some((folder) => !isAbsolute(folder)))
      throw new Error("Scan folders must be absolute paths.");
    return this.mutate((config) => {
      const discovery = {
        extraPorts: patch.extraPorts ?? config.discovery.extraPorts,
        extraFolders: patch.extraFolders ?? config.discovery.extraFolders,
      };
      return { config: { ...config, discovery }, result: discovery };
    });
  }

  async getFirstRun(): Promise<{ dismissed: boolean }> {
    return { dismissed: (await this.load()).firstRunDismissed };
  }

  setFirstRun(dismissed: boolean): Promise<{ dismissed: boolean }> {
    return this.mutate((config) => ({
      config: { ...config, firstRunDismissed: dismissed },
      result: { dismissed },
    }));
  }

  /** Checks one owner-chosen file, folder or address. Nothing is added or connected here. */
  async verifyManual(input: ManualVerifyInput): Promise<ManualVerifyResult> {
    if (input.kind === "model_file")
      return { kind: input.kind, ...(await verifyModelFile(input.path, loadCatalog())) };
    if (input.kind === "installation_folder")
      return { kind: input.kind, ...(await verifyInstallationFolder(input.path, loadCatalog())) };
    return { kind: input.kind, ...(await verifyEndpoint(input.url, { fetchImpl: fetch })) };
  }

  hardware(): Promise<HardwareInfo> {
    return readHardware({ diskPath: this.directory });
  }

  recommendLocal(): Promise<LocalRecommendation> {
    return this.installer.recommend();
  }

  localPlan(modelId: string): Promise<InstallPlan> {
    return this.installer.plan(modelId);
  }

  /** The installer refuses without the confirmation. A verified install adds the model as a stopped local source. */
  async installLocal(input: { modelId: string; confirm: string }): Promise<LocalStatus> {
    const status = await this.installer.install(input);
    if (status.state === "installed") await this.registerInstalled(input.modelId);
    return status;
  }

  async startLocal(sourceId: string): Promise<LocalStatus> {
    return this.installer.start(await this.requireSource(sourceId));
  }

  async stopLocal(sourceId: string): Promise<LocalStatus> {
    await this.requireSource(sourceId);
    return this.installer.stop(sourceId);
  }

  async uninstallLocal(sourceId: string): Promise<LocalStatus> {
    return this.installer.uninstall(await this.requireSource(sourceId));
  }

  async localStatus(sourceId: string): Promise<LocalStatus> {
    return this.installer.status(await this.requireSource(sourceId));
  }

  async getRouting(): Promise<{ routing: DecisionRouting; localOnlyPersonalData: boolean }> {
    const config = await this.load();
    return { routing: config.routing, localOnlyPersonalData: config.localOnlyPersonalData };
  }

  setRouting(patch: {
    routing?: DecisionRouting;
    localOnlyPersonalData?: boolean;
  }): Promise<{ routing: DecisionRouting; localOnlyPersonalData: boolean }> {
    return this.mutate((config) => {
      const next: DecisionConfig = {
        ...config,
        routing: patch.routing ?? config.routing,
        localOnlyPersonalData: patch.localOnlyPersonalData ?? config.localOnlyPersonalData,
      };
      return {
        config: next,
        result: { routing: next.routing, localOnlyPersonalData: next.localOnlyPersonalData },
      };
    });
  }

  catalog(): { version: number; entries: CatalogEntry[] } {
    const catalog = loadCatalog();
    return { version: catalog.version, entries: catalogEntries(catalog.providers) };
  }

  private async load(): Promise<DecisionConfig> {
    return (await loadDecisionConfig(this.configPath)).config;
  }

  private async requireSource(id: string): Promise<DecisionSource> {
    const source = (await this.load()).sources.find((entry) => entry.id === id);
    if (!source) throw new Error("Decision source not found.");
    return source;
  }

  /** Loopback address of a local source. An installed source whose runtime is stopped is started on demand. */
  private async localAddress(source: DecisionSource): Promise<string | undefined> {
    if (!this.installer.endpoint(source.id)) await this.installer.start(source);
    const base = this.installer.endpoint(source.id);
    const path = LOCAL_PATHS[source.adapter];
    return base && path ? `${base}${path}` : undefined;
  }

  /** Adds the installed model as a stopped local source, unless a source already points at its file. */
  private async registerInstalled(modelId: string): Promise<void> {
    const found = loadCatalog()
      .providers.flatMap((provider) => provider.models.map((model) => ({ provider, model })))
      .find((item) => item.model.id === modelId);
    const adapter = found?.provider.adapter;
    const files = found?.model.localFiles ?? [];
    const gguf = files.find((file) => file.fileName.toLowerCase().endsWith(".gguf"));
    if (!found || !adapter || !gguf) return;
    const folder = join(this.directory, LOCAL_FOLDER, modelId);
    const runtime = files.find((file) => /^llama-server(\.exe)?$/i.test(file.fileName));
    const modelPath = join(folder, gguf.fileName);
    await this.mutate((config) => {
      if (config.sources.some((source) => source.local?.modelPath === modelPath))
        return { config, result: undefined };
      if (config.sources.length >= MAX_DECISION_SOURCES)
        throw new Error("Too many decision sources.");
      const source: DecisionSource = {
        id: `src-${randomUUID()}`,
        name: found.model.name,
        kind: "local",
        adapter,
        catalogId: found.model.id,
        status: "stopped",
        local: {
          modelPath,
          ...(runtime ? { runtimePath: join(folder, runtime.fileName) } : {}),
        },
      };
      return { config: { ...config, sources: [...config.sources, source] }, result: undefined };
    });
  }

  /**
   * Writes are serialized and refused while the stored file is damaged. The damaged original
   * stays on disk (readStateFile keeps an evidence copy), so a repair can still recover it.
   */
  private mutate<T>(
    change: (config: DecisionConfig) => { config: DecisionConfig; result: T },
  ): Promise<T> {
    const run = this.queue
      .catch(() => undefined)
      .then(async () => {
        const loaded = await loadDecisionConfig(this.configPath);
        if (loaded.damaged)
          throw new Error("Decision model settings are damaged; the original file was kept.");
        const next = change(loaded.config);
        await saveDecisionConfig(this.configPath, next.config);
        return next.result;
      });
    this.queue = run;
    return run;
  }
}
