import { AssistantQuotaReader } from "../assistant/models/assistant-quota-reader";
import { readDisabledModels } from "../providers/disabled-models";
import { hostProviderAccounts } from "../providers/provider-accounts";
import { providerAuthStatus } from "../providers/provider-auth";
import type { UsageLimitsReport } from "../usage/limits-report";
import { createModelRoutingService, type ModelRoutingService } from "./service";
import type { ModelRoutingStore } from "./storage";
import type { ModelRoutingCatalog } from "./validation";

const services = new WeakMap<ModelRoutingStore, ModelRoutingService>();
/**
 * Same store-owned service for owner RPC and in-process run-start callers. A store whose Host
 * composition registered no service (embedded Hosts, standalone fixtures) gets a store-only
 * one: an empty document resolves `notConfigured`, so items keep their own model.
 */
export function hostModelRoutingService(store: ModelRoutingStore): ModelRoutingService {
  let service = services.get(store);
  if (!service) {
    // shortcut: no catalog, auth or quota probes; saves accept only account-free entries.
    // Upgrade by registering createHostModelRoutingService in that composition.
    service = createModelRoutingService({
      store,
      accounts: async () => ({}),
      catalog: async () => undefined,
      signals: async () => ({
        available: () => true,
        signedIn: () => true,
        quota: () => ({ unknown: true }),
      }),
    });
    services.set(store, service);
  }
  return service;
}

/** Composition ports use the same Host catalog, CLI paths and quota APIs as existing callers. */
export function createHostModelRoutingService(ports: {
  store: ModelRoutingStore;
  catalog(): Promise<ModelRoutingCatalog>;
  readLimits(): Promise<UsageLimitsReport>;
  command(provider: "claude" | "codex"): Promise<string>;
}): ModelRoutingService {
  const quota = new AssistantQuotaReader({ readLimits: ports.readLimits });
  const catalog = () => ports.catalog().catch(() => undefined);
  const service = createModelRoutingService({
    store: ports.store,
    accounts: () => hostProviderAccounts(),
    catalog,
    async signals(state) {
      const [models, disabled, accounts] = await Promise.all([
        catalog(),
        readDisabledModels(ports.store),
        hostProviderAccounts(),
      ]);
      const auth = new Map<string, boolean>();
      const accountKeys = [
        ...new Set(
          state.entries
            .filter((entry) => entry.harness === "claude" || entry.harness === "codex")
            .map((entry) => `${entry.harness}\n${entry.providerAccountId ?? "default"}`),
        ),
      ];
      await Promise.all(
        accountKeys.map(async (key) => {
          const [provider, id] = key.split("\n") as ["claude" | "codex", string];
          if (id !== "default" && !accounts[provider]?.some((account) => account.id === id)) {
            auth.set(key, false);
            return;
          }
          // Operational/unsupported probes are unknown, not proof of sign-out.
          const status = await ports
            .command(provider)
            .then((command) => providerAuthStatus(provider, command, id))
            .catch(() => "unknown");
          auth.set(key, status !== "signedOut");
        }),
      );
      // Match the disabled-model preference's dotted/CLI Claude equivalence, without
      // the picker decoration's intentional fallback when every model is disabled.
      const preferenceKey = (id: string) =>
        id.startsWith("claude:")
          ? id.replace(/^claude:claude-/, "claude:").replace(/\./g, "-")
          : id;
      const off = new Set((disabled ?? []).map(preferenceKey));
      return {
        available: (entry) =>
          !off.has(preferenceKey(entry.model)) &&
          !!models?.models[entry.harness]?.some((model) => model.id === entry.model),
        signedIn: (entry) =>
          auth.get(`${entry.harness}\n${entry.providerAccountId ?? "default"}`) ?? true,
        quota: (entry) => quota.reading(entry.harness, entry.providerAccountId, entry.model),
      };
    },
  });
  services.set(ports.store, service);
  return service;
}
