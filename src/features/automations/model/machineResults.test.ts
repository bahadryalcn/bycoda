import { describe, expect, it } from "vitest";
import type { RemoteMachine } from "../../connections/model/protocol";
import {
  collectMachineResults,
  failedMachineNames,
  staleMachineNames,
  type LastGoodLists,
} from "./machineResults";

const mac: RemoteMachine = {
  id: "machine-mac",
  name: "MacBook",
  endpoint: "http://127.0.0.1:41000",
  environmentId: "env-mac",
  ssh: { target: "me@macbook", remotePort: 3774 },
};
type Card = { id: string; stale?: boolean };
const markStale = (card: Card): Card => ({ ...card, stale: true });

describe("machine results", () => {
  it("keeps the last successful list, flagged stale, when a machine fails", async () => {
    const lastGood: LastGoodLists<Card> = new Map();
    await collectMachineResults(lastGood, [mac], async () => [{ id: "a" }], markStale);
    const [result] = await collectMachineResults(
      lastGood,
      [mac],
      async () => {
        throw new Error("timed out");
      },
      markStale,
    );
    expect(result).toMatchObject({
      machineId: "machine-mac",
      status: "error",
      stale: true,
      error: "timed out",
      data: [{ id: "a", stale: true }],
    });
    expect(failedMachineNames([result])).toEqual(["MacBook"]);
    expect(staleMachineNames([result])).toEqual(["MacBook"]);
  });

  it("clears the list on a successful empty answer", async () => {
    const lastGood: LastGoodLists<Card> = new Map();
    await collectMachineResults(lastGood, [mac], async () => [{ id: "a" }], markStale);
    const [ok] = await collectMachineResults(lastGood, [mac], async () => [], markStale);
    expect(ok).toMatchObject({ status: "ok", data: [], stale: false });
    const [failed] = await collectMachineResults(
      lastGood,
      [mac],
      () => Promise.reject(new Error("offline")),
      markStale,
    );
    expect(failed.data).toEqual([]);
    expect(failed.stale).toBe(false);
  });

  it("serves known-unreachable machines from the cache without asking them", async () => {
    const lastGood: LastGoodLists<Card> = new Map([[mac.id, [{ id: "a" }]]]);
    let asked = 0;
    const results = await collectMachineResults(
      lastGood,
      [],
      async () => {
        asked++;
        return [];
      },
      markStale,
      [mac],
    );
    expect(asked).toBe(0);
    expect(results[0]).toMatchObject({
      status: "error",
      stale: true,
      data: [{ id: "a", stale: true }],
    });
  });

  it("does not show the previous host's cards after reconnecting the same ID", async () => {
    const lastGood: LastGoodLists<Card> = new Map();
    await collectMachineResults(lastGood, [mac], async () => [{ id: "old-host" }], markStale);
    const replacement = { ...mac, environmentId: "replacement-env" };
    const [result] = await collectMachineResults(
      lastGood,
      [replacement],
      async () => {
        throw new Error("replacement offline");
      },
      markStale,
    );
    expect(result).toMatchObject({ status: "error", stale: false, data: [] });
  });

  it("discards a changed endpoint's cached cards even when its probe failed", async () => {
    const lastGood: LastGoodLists<Card> = new Map();
    await collectMachineResults(lastGood, [mac], async () => [{ id: "old-endpoint" }], markStale);
    const [result] = await collectMachineResults(lastGood, [], async () => [], markStale, [
      { ...mac, endpoint: "http://127.0.0.1:42000" },
    ]);
    expect(result).toMatchObject({ status: "error", stale: false, data: [] });
  });

  it("keeps a late old-host reply from overwriting the replacement host", async () => {
    const lastGood: LastGoodLists<Card> = new Map();
    let resolveOld!: (value: Card[]) => void;
    const oldRead = collectMachineResults(
      lastGood,
      [mac],
      () =>
        new Promise<Card[]>((resolve) => {
          resolveOld = resolve;
        }),
      markStale,
    );
    const replacement = { ...mac, environmentId: "replacement-env" };
    await collectMachineResults(
      lastGood,
      [replacement],
      async () => [{ id: "new-host" }],
      markStale,
    );
    resolveOld([{ id: "old-host" }]);
    const [oldResult] = await oldRead;
    expect(oldResult).toMatchObject({ status: "error", data: [], stale: false });
    expect(lastGood.get(mac.id)).toEqual([{ id: "new-host" }]);
  });
});
