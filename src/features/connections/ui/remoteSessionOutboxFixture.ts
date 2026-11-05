// UI tests use an isolated transaction fixture; real IndexedDB races are checked in Chromium.
export const outboxFixture = {
  entries: new Map<string, string>(),
  settlements: new Map<string, string>(),
  modern: new Set<string>(),
  revision: 0,
  unavailable: false,
  failWrites: false,
  afterCommit: undefined as Promise<void> | undefined,
};

export const outboxDatabaseMock = {
  readOutboxDatabasePage: async (
    kind: "entries" | "settlements",
    prefix: string,
    after?: string,
  ) => {
    if (outboxFixture.unavailable) throw new Error("Remote request storage is unavailable.");
    const keys = [...outboxFixture[kind].keys()]
      .filter((key) => key.startsWith(prefix) && (after === undefined || key > after))
      .sort();
    const selected = keys.slice(0, 128);
    return {
      values: selected.map((key) => ({ key, raw: outboxFixture[kind].get(key)! })),
      next: keys.length > 128 ? selected[selected.length - 1] : undefined,
      revision: outboxFixture.revision,
    };
  },
  readOutboxDatabaseRecord: async (key: string) => ({
    entry: outboxFixture.entries.get(key),
    settlement: outboxFixture.modern.has(key) ? undefined : outboxFixture.settlements.get(key),
    resolved: outboxFixture.settlements.has(key),
    revision: outboxFixture.revision,
  }),
  changeOutboxDatabase: async (
    key: string,
    expected: string | null,
    next: string | null,
    legacy?: string,
    revision?: number,
  ) => {
    if (outboxFixture.failWrites) throw new Error("Cannot save remote requests.");
    if (
      (outboxFixture.entries.get(key) ?? null) !== expected ||
      (revision !== undefined && revision !== outboxFixture.revision)
    )
      throw new Error("The pending request changed.");
    if (next === null) outboxFixture.entries.delete(key);
    else outboxFixture.entries.set(key, next);
    if (legacy !== undefined) {
      outboxFixture.settlements.set(key, legacy);
      outboxFixture.modern.delete(key);
    }
    outboxFixture.revision++;
    const wait = outboxFixture.afterCommit;
    outboxFixture.afterCommit = undefined;
    if (wait) await wait;
  },
  settleOutboxDatabase: async (
    key: string,
    expected: string,
    legacy?: string,
    next?: { key: string; raw: string },
    revision?: number,
  ) => {
    if (
      outboxFixture.entries.get(key) !== expected ||
      (revision !== undefined && revision !== outboxFixture.revision) ||
      (next &&
        outboxFixture.entries.has(next.key) &&
        outboxFixture.entries.get(next.key) !== next.raw)
    )
      throw new Error("The pending request changed.");
    outboxFixture.entries.delete(key);
    if (next) outboxFixture.entries.set(next.key, next.raw);
    outboxFixture.settlements.set(key, legacy ?? "");
    if (legacy === undefined) outboxFixture.modern.add(key);
    else outboxFixture.modern.delete(key);
    outboxFixture.revision++;
  },
  quarantineOutboxDatabase: async (
    key: string,
    expected: string | null,
    legacy: string | null,
    revision: number,
  ) => {
    if (
      (outboxFixture.entries.get(key) ?? null) !== expected ||
      revision !== outboxFixture.revision
    )
      throw new Error("The pending request changed.");
    outboxFixture.entries.delete(key);
    if (legacy !== null || expected !== null) outboxFixture.settlements.set(key, legacy ?? "");
    if (legacy === null) outboxFixture.modern.add(key);
    else outboxFixture.modern.delete(key);
    outboxFixture.revision++;
  },
};
