import {
  EMPTY_MODEL_ROUTING,
  ModelRoutingStateSchema,
  type ModelRoutingDraft,
  type ModelRoutingState,
} from "../../src/shared/model/host-contracts/model-routing";
import type { HostStore } from "../store";

export type ModelRoutingStore = Pick<HostStore, "ready" | "db" | "transaction">;
const KEY = "modelRouting";
async function prepare(store: ModelRoutingStore) {
  await store.db.exec(
    "CREATE TABLE IF NOT EXISTS host_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
}
async function read(store: ModelRoutingStore): Promise<ModelRoutingState> {
  const row = await store.db.prepare("SELECT value FROM host_settings WHERE key=?").get(KEY);
  // Corrupt persisted routing must not silently authorize a different model.
  return row
    ? ModelRoutingStateSchema.parse(JSON.parse(String(row.value)))
    : { ...structuredClone(EMPTY_MODEL_ROUTING), version: 0, updatedAt: 0 };
}
export async function readModelRouting(store: ModelRoutingStore): Promise<ModelRoutingState> {
  await store.ready;
  return store.db.scope(async () => {
    await prepare(store);
    return read(store);
  });
}
export async function saveModelRouting(
  store: ModelRoutingStore,
  draft: ModelRoutingDraft,
  expectedVersion: number,
  now: number,
  authorize: () => Promise<void> = async () => {},
): Promise<ModelRoutingState> {
  await store.ready;
  return store.transaction(async () => {
    await prepare(store);
    const old = await read(store);
    if (old.version !== expectedVersion)
      throw new Error("Model routing changed; reload before saving.");
    const state = { ...draft, version: old.version + 1, updatedAt: now };
    await authorize();
    await store.db
      .prepare(
        "INSERT INTO host_settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(KEY, JSON.stringify(state));
    return state;
  }, "critical");
}
