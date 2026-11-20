import { join } from "node:path";
import { z } from "zod";
import {
  MODEL_CATALOG_FACTS_MAX,
  ModelCatalogFactSchema,
  ModelRoutingCatalogFactsParamsSchema,
  type ModelCatalogFact,
  type ModelRoutingCatalogFactsResult,
} from "../../src/shared/model/host-contracts/model-routing";
import { assertDomainAuthority, type HostDomainContext } from "../domains/context";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const DEADLINE_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;
const FRESH_MS = 6 * 60 * 60 * 1000;
/** After a failed refresh, serve the stale answer this long before trying the network again. */
const RETRY_MS = 60_000;

const CacheSchema = z.strictObject({
  version: z.literal(1),
  fetchedAt: z.number().int().nonnegative(),
  models: z.array(ModelCatalogFactSchema).max(MODEL_CATALOG_FACTS_MAX),
});
type Cache = z.infer<typeof CacheSchema>;

type Options = {
  /** Directory owned by this feature; the cache file lives inside it. */
  directory: string;
  fetch?: typeof fetch;
  now?: () => number;
  deadlineMs?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Per-token dollar strings become dollars per million tokens; unknown or negative is rejected. */
function perMillion(value: unknown): number | undefined {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  const usd = Math.round(parsed * 1e6 * 10_000) / 10_000;
  return usd <= 100_000 ? usd : undefined;
}

/** Variants (`:free`, `:batch`), legal and `-pro` aliases and routers (`~`) duplicate real families. */
function skipped(id: string): boolean {
  return id.startsWith("~") || id.includes(":") || id.includes("-legal") || id.endsWith("-pro");
}

export function parseOpenRouterModels(json: unknown): ModelCatalogFact[] {
  if (!isRecord(json) || !Array.isArray(json.data)) throw new Error("Unexpected catalog shape");
  const seen = new Set<string>();
  const models: ModelCatalogFact[] = [];
  for (const entry of json.data) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    const id = entry.id.trim().toLowerCase();
    if (!id || skipped(id)) continue;
    const family = id.replace(/^.*\//, "").replaceAll(".", "-");
    if (!family || seen.has(family)) continue;
    const pricing = isRecord(entry.pricing) ? entry.pricing : {};
    const inputUsd = perMillion(pricing.prompt);
    const outputUsd = perMillion(pricing.completion);
    if (inputUsd === undefined || outputUsd === undefined) continue;
    const benchmarks = isRecord(entry.benchmarks) ? entry.benchmarks : {};
    const analysis = isRecord(benchmarks.artificial_analysis) ? benchmarks.artificial_analysis : {};
    const index = analysis.intelligence_index;
    const intelligenceIndex =
      typeof index === "number" && Number.isFinite(index) && index >= 0 && index <= 1000
        ? index
        : undefined;
    seen.add(family);
    models.push({
      family,
      inputUsd,
      outputUsd,
      ...(intelligenceIndex === undefined ? {} : { intelligenceIndex }),
    });
    if (models.length >= MODEL_CATALOG_FACTS_MAX) break;
  }
  return models;
}

async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error("Catalog too large");
  if (!response.body) throw new Error("Catalog has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Catalog too large");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export function createCatalogFacts(options: Options) {
  const file = join(options.directory, "catalog-facts.json");
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? DEADLINE_MS;
  let inflight: Promise<ModelRoutingCatalogFactsResult> | undefined;
  let failedAt = 0;
  let failure: string | undefined;
  /** Disk is read and validated once; refresh replaces this with the cache it just wrote. */
  let cached: Promise<Cache | undefined> | undefined;

  async function load(): Promise<Cache | undefined> {
    try {
      const result = await readStateFile(file, (text) => CacheSchema.parse(JSON.parse(text)));
      return result.status === "ok" ? result.value : undefined;
    } catch {
      return undefined;
    }
  }

  const current = () => (cached ??= load());

  const answer = (cache: Cache | undefined, error?: string): ModelRoutingCatalogFactsResult => ({
    source: "openrouter",
    models: cache?.models ?? [],
    ...(cache ? { fetchedAt: cache.fetchedAt } : {}),
    ...(error ? { error } : {}),
  });

  async function refresh(cache: Cache | undefined): Promise<ModelRoutingCatalogFactsResult> {
    try {
      const response = await doFetch(CATALOG_URL, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(deadlineMs),
      });
      if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
      const models = parseOpenRouterModels(JSON.parse(await readBounded(response)));
      if (!models.length) throw new Error("Catalog listed no priced models");
      const fresh = CacheSchema.parse({ version: 1, fetchedAt: now(), models });
      failure = undefined;
      cached = Promise.resolve(fresh);
      // A cache that cannot be written only costs the next refresh; the answer is still good.
      await writeFileAtomic(file, `${JSON.stringify(fresh)}\n`).catch(() => undefined);
      return answer(fresh);
    } catch (cause) {
      failedAt = now();
      failure = cause instanceof Error ? cause.message.slice(0, 200) : "Catalog request failed";
      return answer(cache, failure);
    }
  }

  return {
    /** Fresh cache, else one deduplicated refresh; failure serves the last good list. */
    async read(): Promise<ModelRoutingCatalogFactsResult> {
      const cache = await current();
      if (cache && now() - cache.fetchedAt < FRESH_MS) return answer(cache);
      if (failure && now() - failedAt < RETRY_MS) return answer(cache, failure);
      inflight ??= refresh(cache).finally(() => {
        inflight = undefined;
      });
      return inflight;
    },
  };
}

/** Read-only live prices and scores; the Host fetches because the renderer CSP blocks the network. */
export function catalogFactsDomain(featureDirectory: string) {
  const facts = hostCatalogFacts(featureDirectory);
  return {
    async catalogFacts(raw: unknown, context: HostDomainContext) {
      ModelRoutingCatalogFactsParamsSchema.parse(raw);
      await assertDomainAuthority(context);
      const result = await facts.read();
      await assertDomainAuthority(context);
      return result;
    },
  };
}

const shared = new Map<string, ReturnType<typeof createCatalogFacts>>();
/** One service per feature directory, so owner RPC and domain RPC share the cache and the dedupe. */
export function hostCatalogFacts(featureDirectory: string) {
  const directory = join(featureDirectory, "model-routing");
  let service = shared.get(directory);
  if (!service) {
    service = createCatalogFacts({ directory });
    shared.set(directory, service);
  }
  return service;
}
