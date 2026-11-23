import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../store";
import {
  runWithRequestTrace,
  slowRequestFields,
  startRequestTrace,
} from "../diagnostics/request-trace";
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
  const journal = new AssistantActionJournal(store, Date.now);
  const append = (requestId: string) =>
    journal.run(
      { threadId: thread.id, family: "conversation", action: "goals.create", requestId, input: {} },
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

  const tracedSnapshot = async () => {
    const trace = startRequestTrace("ws");
    const response = await runWithRequestTrace(trace, () =>
      assistant.request({ op: "snapshot" }, "owner", admission),
    );
    return {
      snapshot: response.snapshot!,
      writerScopes: slowRequestFields(trace, { thresholdMs: 0, heldWaitMs: 0 }).writerScopes,
    };
  };
  await append("first");
  const first = await tracedSnapshot();
  for (let index = 0; index < 24; index++) await append(`request-${index}`);
  const { snapshot, writerScopes } = await tracedSnapshot();

  // The Room registers its source only after this snapshot loads, so failing here deadlocks it.
  expect(disclosures).toBe(2);
  // Before the bounded reads, even one journal outcome took 34 writer admissions.
  expect(writerScopes).toBeLessThan(34);
  expect(writerScopes).toBe(first.writerScopes);
  expect(snapshot.profile).toBeDefined();
  expect(snapshot.activity.some((item) => item.kind.startsWith("action."))).toBe(false);
});
