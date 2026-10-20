import type { HostModelCatalog, RemoteProvider } from "../src/features/connections/model/protocol";
import type { AgentModel } from "../src/features/sessions/model/models";

type Entry = {
  value: HostModelCatalog;
  binaries?: string;
  probed: number;
  running?: Promise<void>;
  pending: Set<RemoteProvider>;
};
const MAX_AGE_MS = 5 * 60_000;
const PREVIEW_WAIT_MS = 150;

/** Share discovery across callers and publish each provider independently. */
export class ModelCatalogCache {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly providers: RemoteProvider[],
    private readonly fingerprint: () => Promise<string>,
    private readonly discover: (provider: RemoteProvider, cwd: string) => Promise<AgentModel[]>,
  ) {}

  clear() {
    this.entries.clear();
  }

  async read(cwd: string, progressive = false): Promise<HostModelCatalog> {
    let entry = this.entries.get(cwd);
    if (!entry) {
      entry = { value: { models: {}, errors: {} }, probed: 0, pending: new Set(this.providers) };
      this.entries.set(cwd, entry);
    }
    if (!entry.running) {
      // Checking binaries also runs in the background, within the preview budget.
      entry.pending = new Set(this.providers);
      const current = entry;
      current.running = this.refresh(cwd, current).finally(() => {
        current.pending.clear();
        current.running = undefined;
      });
    }
    if (progressive) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          entry.running,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, PREVIEW_WAIT_MS);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    } else {
      await entry.running;
    }
    return {
      models: { ...entry.value.models },
      errors: { ...entry.value.errors },
      ...(entry.pending.size ? { pending: [...entry.pending] } : {}),
    };
  }

  private async refresh(cwd: string, entry: Entry) {
    try {
      const binaries = await this.fingerprint();
      const fresh = entry.binaries === binaries && Date.now() - entry.probed < MAX_AGE_MS;
      // Healthy providers keep their cached result when another provider fails.
      const providers = fresh
        ? this.providers.filter((provider) => entry.value.errors[provider] !== undefined)
        : this.providers;
      entry.pending = new Set(providers);
      if (!fresh) {
        entry.binaries = binaries;
        entry.probed = Date.now();
      }
      await Promise.all(
        providers.map(async (provider) => {
          try {
            entry.value.models[provider] = await this.discover(provider, cwd);
            delete entry.value.errors[provider];
          } catch (error) {
            entry.value.errors[provider] = error instanceof Error ? error.message : String(error);
          } finally {
            entry.pending.delete(provider);
          }
        }),
      );
    } catch (error) {
      for (const provider of this.providers)
        entry.value.errors[provider] = error instanceof Error ? error.message : String(error);
    }
  }
}
