import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../store";
import { HostAssistant } from "./service";
import { AssistantActionJournal } from "./management/assistant-action-journal";
import type { RoomManagementAdmission } from "./management/assistant-management-turn";

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});

it("returns the snapshot when action history needs a Room source that is not open", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-snapshot-source-"));
  const store = new HostStore(join(dir, "host.db"));
  await store.ready;
  let disclosures = 0;
  const assistant = new HostAssistant(store, {
    withRoomResponseDisclosure: async () => {
      disclosures++;
      throw new Error("Open the Assistant Room on this Host");
    },
  });
  await assistant.ready;
  closes.push(async () => {
    await assistant.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const thread = (await assistant.request({ op: "threads.open" }, "owner")).thread!;
  await new AssistantActionJournal(store, Date.now).run(
    {
      threadId: thread.id,
      family: "conversation",
      action: "goals.create",
      requestId: "request",
      input: {},
    },
    store.environmentId,
    async () => ({
      value: { status: "completed" },
      source: {
        environmentId: store.environmentId,
        threadId: thread.id,
        family: "conversation" as const,
        action: "goals.create",
      },
    }),
  );
  const admission: RoomManagementAdmission = {
    environmentId: store.environmentId,
    deviceHash: "device",
    authorized: async () => true,
  };

  const snapshot = (await assistant.request({ op: "snapshot" }, "owner", admission)).snapshot!;

  // The Room registers its source only after this snapshot loads, so failing here deadlocks it.
  expect(disclosures).toBe(1);
  expect(snapshot.profile).toBeDefined();
  expect(snapshot.activity.some((item) => item.kind.startsWith("action."))).toBe(false);
});
