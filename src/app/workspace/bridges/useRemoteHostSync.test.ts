import { expect, it } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import type { HostSession } from "../../../features/connections/model/protocol";
import { pruneClosedSnapshots } from "./useRemoteHostSync";

it("forgets the last host snapshot of a closed tab and keeps the open ones", () => {
  const open = newSession("codex", "remote://env/repo");
  const closed = newSession("codex", "remote://env/repo");
  const snapshot = { revision: 1 } as HostSession;
  const snapshots = new Map([
    [open.id, snapshot],
    [closed.id, snapshot],
  ]);
  pruneClosedSnapshots(snapshots, [open]);
  expect([...snapshots.keys()]).toEqual([open.id]);
});
