import type {
  HostModelCatalog,
  RemoteProvider,
} from "../../src/features/connections/model/protocol";
import type { AgentModel } from "../../src/features/sessions/model/models";
import type { CodexCatalogStore } from "./codex-catalog-store";

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
  /** What the last read returned, so a refresh that changes nothing notifies nobody. */
  served?: string;
};
const signature = (entry: Entry) =>
  JSON.stringify([entry.value.models, entry.value.errors, [...entry.pending].sort()]);
const MAX_AGE_MS = 5 * 60_000;
const PREVIEW_WAIT_MS = 150;
const RETRY_MS = 30_000;
const MAX_ENTRIES = 32;
const MAX_BYTES = 8 * 1024 * 1024;
const IDLE_MS = 30 * 60_000;

/** Share discovery across callers and publish each provider independently. */
export class ModelCatalogCache {
  private entries = new Map<string, Entry>();
  private codexIdentity?: string | null;

  constructor(
    private readonly providers: RemoteProvider[],
    private readonly fingerprint: () => Promise<string>,
    private readonly discover: (provider: RemoteProvider, cwd: string) => Promise<AgentModel[]>,
    /** Called when a catalog differs from what its last read returned; never alters read(). */
    public onChange?: () => void,
    private readonly codex?: {
      store: CodexCatalogStore;
      identity(): Promise<string | null>;
    },
  ) {}

  // A subscriber reloads by reading, and every read revalidates in the background, so an
  // unconditional notification would reload forever. Only a real difference notifies.
  private notify(entry?: Entry) {
    if (entry && signature(entry) === entry.served) return;
    try {
      this.onChange?.();
    } catch (error) {
      console.warn("Model catalog change listener failed", error);
    }
  }

  clear() {
    this.entries.clear();
    this.notify();
  }

  async read(cwd: string, progressive = false, force = false): Promise<HostModelCatalog> {
    const identity = await this.codex?.identity();
    if (identity !== this.codexIdentity) {
      this.codexIdentity = identity;
      this.entries.clear();
    }
    this.prune();
    let entry = this.entries.get(cwd);
    if (!entry) {
      const saved = identity ? await this.codex?.store.read(cwd, identity) : undefined;
      entry = this.entries.get(cwd);
      if (identity !== this.codexIdentity) return { models: { codex: [] }, errors: {} };
      entry ??= {
        value: { models: this.codex ? { codex: saved ?? [] } : {}, errors: {} },
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
        // Checking binaries also runs in the background, within the preview budget. A fresh
        // entry revalidates silently: only providers due for a retry show as pending.
        const current = entry;
        const now = Date.now();
        current.pending = new Set(
          current.probed === 0 || now - current.probed >= MAX_AGE_MS
            ? this.providers
            : this.providers.filter(
                (provider) =>
                  current.value.errors[provider] !== undefined &&
                  (current.failures[provider]?.retryAt ?? 0) <= now,
              ),
        );
        current.running = this.refresh(cwd, current, force, identity).finally(() => {
          current.pending.clear();
          current.running = undefined;
          current.weight = Buffer.byteLength(JSON.stringify(current.value));
          this.prune();
          // A failed fingerprint publishes errors and clears pending without a provider landing.
          this.notify(current);
        });
      }
      if (progressive && !(this.codex && entry.value.models.codex?.length)) {
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
      } else if (!progressive) {
        await entry.running;
      }
      const identityChanged = this.codex && identity !== (await this.codex.identity());
      const models = { ...entry.value.models, ...(identityChanged ? { codex: [] } : {}) };
      entry.served = signature(entry);
      return {
        models,
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

  private async refresh(cwd: string, entry: Entry, force: boolean, identity?: string | null) {
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
            const models = await this.discover(provider, cwd);
            if (provider === "codex" && this.codex) {
              if (identity !== (await this.codex.identity()) || this.entries.get(cwd) !== entry) {
                entry.value.models.codex = [];
                return;
              }
              entry.value.models.codex = models;
              if (identity) {
                await this.codex.store.write(cwd, identity, models).catch(() => {
                  // The in-memory catalog still serves the successful result.
                });
              }
            } else entry.value.models[provider] = models;
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
            this.notify(entry);
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
