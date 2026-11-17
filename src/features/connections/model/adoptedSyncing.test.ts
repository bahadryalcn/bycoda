import { expect, it } from "vitest";
import type { Session } from "../../sessions";
import type { AdoptedEntry } from "./adoptedSessions";
import { adoptedSyncingIds } from "./adoptedSyncing";

const entry = (id: string, over: Partial<AdoptedEntry> = {}): AdoptedEntry => ({
  id,
  projectId: "p",
  revision: 5,
  updatedAt: 1,
  status: "idle",
  ...over,
});
const session = (id: string, over: Partial<Session> = {}) => ({ id, blocks: [], ...over }) as never;

it("names only open, idle conversations whose newer host copy has not been compared yet", () => {
  const ids = adoptedSyncingIds(
    [
      entry("new"),
      entry("mirrored"),
      entry("running", { status: "running" }),
      entry("busy"),
      entry("flagged"),
      entry("closed"),
    ],
    [
      session("new"),
      session("mirrored"),
      session("running"),
      session("busy", { busy: true }),
      session("flagged", { adoptedSyncConflict: true }),
    ],
    new Map([["mirrored", 5]]),
  );
  expect([...ids]).toEqual(["new"]);
});
