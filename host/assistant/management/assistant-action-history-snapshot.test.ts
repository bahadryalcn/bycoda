import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../../store";
import { HostAssistant, type AssistantPorts } from "../service";
import { ConversationDesktopRelay } from "../../conversation/conversation-desktop-relay";
import type { RoomManagementAdmission } from "./assistant-management-turn";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

const device = "d".repeat(64);

/**
 * The real snapshot, journal and desktop relay, with a Room disclosure port that asks the relay
 * for one privacy capture per distinct source exactly as the Host's disclosure does, one after
 * another. Only the desktop's answers are simulated.
 */
async function harness(sourceCount: number) {
  const directory = mkdtempSync(join(tmpdir(), "assistant-history-snapshot-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const relay = new ConversationDesktopRelay(store.environmentId);
  const captured: string[] = [];
  let disclosures = 0;
  const ports: AssistantPorts = {
    manualProjectVisible: async () => true,
    withRoomResponseDisclosure: async (scopes, admission, effect) => {
      disclosures += 1;
      const targets = new Map<string, { threadId: string; projectId: string }>();
      for (const scope of scopes)
        for (const projectId of scope.projects)
          targets.set(JSON.stringify([scope.threadId, projectId]), {
            threadId: scope.threadId,
            projectId,
          });
      for (const { threadId, projectId } of targets.values()) {
        await relay.callAssistantThread(
          "privacy.scope.capture",
          { action: "room.disclosure", requestId: "r", operationHash: "a".repeat(64) },
          {
            threadId,
            environmentId: store.environmentId,
            projectId,
            targetProjectCwd: `/${projectId}`,
          },
          async () => !admission.signal?.aborted && (await admission.authorized()),
          { signal: admission.signal },
        );
        captured.push(projectId);
      }
      return effect(() => true);
    },
  };
  const assistant = new HostAssistant(store, ports);
  cleanups.push(async () => {
    relay.close();
    await assistant.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await assistant.ready;
  const first = await assistant.request({ op: "snapshot" }, "owner");
  await assistant.request(
    {
      op: "profile.update",
      expectedVersion: first.snapshot!.profile.version,
      patch: { enabled: true, setupComplete: true, name: "Assistant", dailyTokenBudget: 20000 },
    },
    "owner",
  );
  const projects = [];
  for (let index = 0; index < sourceCount; index += 1) {
    const folder = join(directory, `project-${index}`);
    mkdirSync(folder);
    projects.push(await store.addProject(folder, `Project ${index}`));
  }
  // One newest goal touching every project: a single row that a source cap would drop whole.
  await assistant.actionJournal.runAutonomous(
    {
      operationId: "wide",
      action: "sessions.manage",
      target: "session",
      jobId: "job-wide",
      projectIds: projects.map((project) => project.id),
    },
    async () => ({ state: "unknown" }),
  );
  for (const [index, project] of projects.entries())
    await assistant.actionJournal.runAutonomous(
      {
        operationId: `single-${index}`,
        action: "sessions.manage",
        target: "session",
        jobId: `job-${index}`,
        projectIds: [project.id],
      },
      async () => ({ state: "unknown" }),
    );
  const admission: RoomManagementAdmission = {
    environmentId: store.environmentId,
    deviceHash: device,
    authorized: async () => true,
  };
  const snapshot = () => assistant.request({ op: "snapshot" }, "owner", admission);
  /** A desktop that polls and answers every capture it is handed after `delayMs`. */
  const answering = (delayMs: number) => {
    let running = true;
    const loop = (async () => {
      while (running) {
        for (const request of await relay.take(device, { waitMs: 50 })) {
          if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
          await relay.finish(String(request.id), { operationJson: "{}" }, undefined, device);
        }
      }
    })();
    return async () => {
      running = false;
      await loop;
    };
  };
  return {
    assistant,
    relay,
    snapshot,
    captured,
    projects,
    disclosures: () => disclosures,
    answering,
  };
}

it("returns every authorized action source on a healthy desktop, however many a row touches", async () => {
  const test = await harness(7);
  await test.relay.take(device);
  const stop = test.answering(0);
  try {
    const { snapshot } = await test.snapshot();
    const actions = snapshot!.activity.filter((event) => event.kind.startsWith("action."));
    // The wide row and each of the seven single-project rows, none dropped, none truncated.
    expect(actions).toHaveLength(8);
    expect(actions.some((event) => event.projectIds?.length === 7)).toBe(true);
    // Every distinct source was captured once, one after another, for the single disclosure.
    expect(test.disclosures()).toBe(1);
    expect([...test.captured].sort()).toEqual(test.projects.map((project) => project.id).sort());
  } finally {
    await stop();
  }
});

it("still answers the snapshot, without the history, when the desktop claims a capture and never finishes", async () => {
  const test = await harness(7);
  // The desktop is alive and polling: it claims the first capture and then says nothing.
  (test.assistant.actionJournal as unknown as { disclosureBudgetMs: number }).disclosureBudgetMs =
    300;
  await test.relay.take(device);
  const claimed: Record<string, unknown>[] = [];
  const watcher = (async () => {
    while (!claimed.length) claimed.push(...(await test.relay.take(device, { waitMs: 50 })));
  })();
  const started = Date.now();
  const { snapshot } = await test.snapshot();
  await watcher;
  // The rest of the snapshot is intact; only the action history is missing.
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(snapshot!.profile.enabled).toBe(true);
  expect(snapshot!.activity.filter((event) => event.kind.startsWith("action."))).toEqual([]);
  expect(test.captured).toEqual([]);
  // The abandoned capture is gone from the relay: nothing is left to claim, and the desktop's late
  // answer is refused rather than delivered to a caller that has left.
  expect(
    await test.relay.authorize(String(claimed[0].id), "privacy.scope.capture", device),
  ).toEqual({ authorized: false });
  await expect(
    test.relay.finish(String(claimed[0].id), { operationJson: "{}" }, undefined, device),
  ).rejects.toThrow("expired");
  expect(await test.relay.take(device)).toEqual([]);
  // The relay is not left holding the dead capture: a fresh snapshot is served at once too.
  const again = await test.snapshot();
  expect(again.snapshot!.profile.enabled).toBe(true);
});

it("gives a slow but answering desktop the whole budget and returns the full history", async () => {
  const test = await harness(4);
  await test.relay.take(device);
  const stop = test.answering(60);
  try {
    const { snapshot } = await test.snapshot();
    expect(snapshot!.activity.filter((event) => event.kind.startsWith("action."))).toHaveLength(5);
    expect(test.captured).toHaveLength(4);
  } finally {
    await stop();
  }
});
