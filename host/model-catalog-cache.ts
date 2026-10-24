import type { HostModelCatalog, RemoteProvider } from "../src/features/connections/model/protocol";
import type { AgentModel } from "../src/features/sessions/model/models";

type Entry = {
  value: HostModelCatalog;
  binaries?: string;
  probed: number;
  running?: Promise<void>;
  pending: Set<RemoteProvider>;
  failures: Partial<Record<RemoteProvider, { attempts: number; retryAt: number }>>;
  accessed: number;
  readers: number;
  weight: number;
  fingerprintRetryAt?: number;
};
const MAX_AGE_MS = 5 * 60_000;
const PREVIEW_WAIT_MS = 150;
const RETRY_MS = 30_000;
const MAX_ENTRIES = 32;
const MAX_BYTES = 8 * 1024 * 1024;
const IDLE_MS = 30 * 60_000;

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

  async read(cwd: string, progressive = false, force = false): Promise<HostModelCatalog> {
    this.prune();
    let entry = this.entries.get(cwd);
    if (!entry) {
      entry = {
        value: { models: {}, errors: {} },
        probed: 0,
        pending: new Set(this.providers),
        failures: {},
        accessed: Date.now(),
        readers: 0,
        weight: 0,
      };
      this.entries.set(cwd, entry);
    }
    entry.accessed = Date.now();
    // Map order breaks equal-clock LRU ties without a global timestamp counter.
    this.entries.delete(cwd);
    this.entries.set(cwd, entry);
    entry.readers++;
    try {
      if (!entry.running) {
        // Checking binaries also runs in the background, within the preview budget.
        entry.pending = new Set(this.providers);
        const current = entry;
        current.running = this.refresh(cwd, current, force).finally(() => {
          current.pending.clear();
          current.running = undefined;
          current.weight = Buffer.byteLength(JSON.stringify(current.value));
          this.prune();
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
    } finally {
      entry.readers--;
      this.prune();
    }
  }

  private prune() {
    const now = Date.now();
    let bytes = [...this.entries.values()].reduce((total, entry) => total + entry.weight, 0);
    for (const [cwd, entry] of this.entries) {
      if (entry.running || entry.readers) continue;
      if (now - entry.accessed < IDLE_MS && this.entries.size <= MAX_ENTRIES && bytes <= MAX_BYTES)
        continue;
      this.entries.delete(cwd);
      bytes -= entry.weight;
    }
  }

  private async refresh(cwd: string, entry: Entry, force: boolean) {
    try {
      if (!force && (entry.fingerprintRetryAt ?? 0) > Date.now()) return;
      const binaries = await this.fingerprint();
      delete entry.fingerprintRetryAt;
      const fresh = !force && entry.binaries === binaries && Date.now() - entry.probed < MAX_AGE_MS;
      // Healthy providers keep their cached result when another provider fails.
      const providers = fresh
        ? this.providers.filter(
            (provider) =>
              entry.value.errors[provider] !== undefined &&
              (entry.failures[provider]?.retryAt ?? 0) <= Date.now(),
          )
        : this.providers;
      entry.pending = new Set(providers);
      if (!fresh) {
        entry.failures = {};
        entry.binaries = binaries;
        entry.probed = Date.now();
      }
      await Promise.all(
        providers.map(async (provider) => {
          try {
            entry.value.models[provider] = await this.discover(provider, cwd);
            delete entry.value.errors[provider];
            delete entry.failures[provider];
          } catch (error) {
            entry.value.errors[provider] = error instanceof Error ? error.message : String(error);
            const attempts = (entry.failures[provider]?.attempts ?? 0) + 1;
            entry.failures[provider] = {
              attempts,
              retryAt: Date.now() + Math.min(MAX_AGE_MS, RETRY_MS * 2 ** Math.min(attempts - 1, 4)),
            };
          } finally {
            entry.pending.delete(provider);
          }
        }),
      );
    } catch (error) {
      entry.fingerprintRetryAt = Date.now() + RETRY_MS;
      for (const provider of this.providers)
        entry.value.errors[provider] = error instanceof Error ? error.message : String(error);
    }
  }
}
