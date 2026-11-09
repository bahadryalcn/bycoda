import type { SocialAudienceStore } from "../store/social-audience-store";

/** Settings rows are the only generic key-value store the audience store exposes. */
export type SettingsStore = Pick<SocialAudienceStore, "getSetting" | "putSetting">;

const queues = new WeakMap<SettingsStore, Promise<unknown>>();

function parse<T>(raw: string | undefined): T | undefined {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * JSON records under `<prefix>.<id>` with one index row `<prefix>.index`.
 * shortcut: unbounded index in one settings row; upgrade to social_records kinds with paging when
 * the audience store owner adds "needs-human" and "recipe-suggestion" record kinds.
 */
export class IndexedRecords<T extends { id: string }> {
  constructor(
    private readonly store: SettingsStore,
    private readonly prefix: string,
  ) {}

  /** Writes for one store run one at a time, so concurrent index updates cannot drop an entry. */
  serial<R>(work: () => Promise<R>): Promise<R> {
    const previous = queues.get(this.store) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    queues.set(
      this.store,
      next.catch(() => undefined),
    );
    return next;
  }

  async ids(): Promise<string[]> {
    const parsed = parse<unknown>(await this.store.getSetting(`${this.prefix}.index`));
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  }

  async get(id: string): Promise<T | undefined> {
    const value = parse<T>(await this.store.getSetting(`${this.prefix}.${id}`));
    return value && typeof value === "object" && value.id === id ? value : undefined;
  }

  async list(): Promise<T[]> {
    const rows: (T | undefined)[] = [];
    for (const id of await this.ids()) rows.push(await this.get(id));
    return rows.filter((row): row is T => row !== undefined);
  }

  async put(value: T): Promise<T> {
    await this.store.putSetting(`${this.prefix}.${value.id}`, JSON.stringify(value));
    const ids = await this.ids();
    if (!ids.includes(value.id))
      await this.store.putSetting(`${this.prefix}.index`, JSON.stringify([...ids, value.id]));
    return value;
  }
}
