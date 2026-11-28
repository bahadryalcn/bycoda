import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { HARNESSES, type HarnessId } from "../../../shared/model/harnessIdentity";
import type { AgentModel } from "../../../shared/model/agentModel";

/**
 * The last live model list of each provider, so a restarted app shows it at once instead of
 * the bundled fallback. A restored list is provisional: the first routine refresh still probes.
 */
export type CachedCatalogs = Partial<Record<HarnessId, AgentModel[]>>;

/** Bump when the list a probe publishes changes shape, so an older saved list is not restored. */
const VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Keeps only known providers and entries that carry the fields every picker reads. */
export function parseCachedCatalogs(raw: string): CachedCatalogs {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.v !== VERSION || !isRecord(parsed.catalogs)) return {};
  const catalogs: CachedCatalogs = {};
  for (const harness of HARNESSES) {
    const models = parsed.catalogs[harness];
    if (!Array.isArray(models)) continue;
    const valid = models.filter(
      (model): model is AgentModel =>
        isRecord(model) &&
        typeof model.id === "string" &&
        typeof model.name === "string" &&
        model.harness === harness,
    );
    if (valid.length) catalogs[harness] = valid;
  }
  return catalogs;
}

const stored = createStoredSetting<CachedCatalogs>({
  key: "bycoda.modelCatalogCache",
  fallback: {},
  parse: parseCachedCatalogs,
  serialize: (catalogs) => JSON.stringify({ v: VERSION, catalogs }),
});

/** Only an app window keeps one; the Host runs this module in Node and keeps its own cache. */
const enabled = () => typeof window !== "undefined";

export function readCachedCatalogs(): CachedCatalogs {
  return enabled() ? stored.load() : {};
}

/** A failed write (blocked storage, quota) leaves the in-memory list serving. */
export function writeCachedCatalog(harness: HarnessId, models: AgentModel[]): void {
  if (!enabled() || models.length === 0) return;
  stored.save({ ...stored.load(), [harness]: models });
}
