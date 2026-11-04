import type { HostStore } from "../../store";
import type { DelegationStore } from "./assistant-room-delegation";

/** Target Host metadata is durable; reads/writes in atomic() use its existing serialized transaction. */
export function hostRoomDelegationStore(store: HostStore): DelegationStore {
  const read = async (key: string) => {
    const row = await store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
    if (!row) return undefined;
    try { return JSON.parse(String(row.value)); }
    catch { throw new Error("Delegation state is unreadable; manual recovery required."); }
  };
  const save = async (key: string, value: unknown) => {
    await store.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
  };
  return {
    atomic: fn => store.transaction(fn, "critical"),
    grant: id => read(`room-delegation:grant:${id}`),
    saveGrant: grant => save(`room-delegation:grant:${grant.grantId}`, grant),
    receipt: id => read(`room-delegation:receipt:${id}`),
    saveReceipt: (id, receipt) => save(`room-delegation:receipt:${id}`, receipt),
  };
}
