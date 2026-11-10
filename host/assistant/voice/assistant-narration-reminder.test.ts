import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HostStore } from "../../store";
import { AssistantRepository } from "../repository";
import { HostAssistant } from "../service";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const admission = { environmentId: "host", deviceHash: "device", authorized: async () => true };

async function setup(profile: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "narration-reminder-"));
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  let now = noon.getTime();
  const store = new HostStore(join(dir, "host.db"));
  const service = new HostAssistant(store, {
    now: () => now,
    withVoiceNarrationAuthorization: async (_input, _admission, effect) => effect(() => true),
  });
  cleanups.push(async () => {
    await service.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await service.ready;
  const request = (input: Parameters<HostAssistant["request"]>[0]) =>
    service.request(input, "owner", admission);
  const current = (await request({ op: "snapshot" })).snapshot!.profile;
  await request({
    op: "profile.update",
    expectedVersion: current.version,
    patch: {
      name: "Fixture",
      dailyTokenBudget: 100000,
      enabled: true,
      setupComplete: true,
      quietStart: 0,
      quietEnd: 0,
      ...profile,
    },
  });
  const presence = (state: string) =>
    new AssistantRepository(store).put("runtime", {
      id: "automaticPresence",
      version: 0,
      createdAt: now,
      updatedAt: now,
      value: { state, since: now, updatedAt: now, supported: true },
    });
  const room = (await service.globalRoomBinding())!;
  const base = { threadId: room.id, generation: "generation" };
  const fire = async (text = "Call Sam") => {
    await request({ op: "reminders.create", text, at: now + 60_000, requestId: "r1" });
    now += 61_000;
    await service.tick();
  };
  // The job tick refreshes presence from the (absent) native reader, so each read re-asserts it.
  let state = "present";
  const pending = async () => {
    await presence(state);
    return (await request({ op: "narration.pending", ...base })).narrationEvents;
  };
  return {
    request,
    base,
    fire,
    pending,
    setPresence: (next: string) => {
      state = next;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("spoken reminders", () => {
  it("speaks a fired reminder once without the job-updates switch", async () => {
    const f = await setup({ voiceNarration: false, proactiveSpeech: "return" });
    expect(await f.pending()).toEqual([]);
    await f.fire();
    const events = await f.pending();
    expect(events).toHaveLength(1);
    expect(events![0]).toMatchObject({ kind: "reminder", text: "Reminder: Call Sam" });
    const eventId = events![0].eventId;
    const claimed = await f.request({ op: "narration.claim", ...f.base, eventId });
    expect(claimed.narrationClaimed).toBe(true);
    expect(
      (await f.request({ op: "narration.claim", ...f.base, generation: "other", eventId }))
        .narrationClaimed,
    ).toBe(false);
    expect(
      (await f.request({ op: "narration.settle", ...f.base, eventId, state: "delivered" }))
        .narrationClaimed,
    ).toBe(true);
    expect(await f.pending()).toEqual([]);
  });
  it("does not replay a reminder whose playback outcome is unknown", async () => {
    const f = await setup();
    await f.fire();
    const eventId = (await f.pending())![0].eventId;
    await f.request({ op: "narration.claim", ...f.base, eventId });
    await f.request({ op: "narration.settle", ...f.base, eventId, state: "unknown" });
    expect(await f.pending()).toEqual([]);
  });
  it("stays silent when proactive speech is off", async () => {
    const f = await setup({ voiceNarration: true, proactiveSpeech: "never" });
    await f.fire();
    expect(await f.pending()).toEqual([]);
    const eventId = "notification:reminder:none";
    expect((await f.request({ op: "narration.claim", ...f.base, eventId })).narrationClaimed).toBe(
      false,
    );
  });
  it("stays silent in quiet hours and when the owner is away", async () => {
    const quiet = await setup({ quietStart: 0, quietEnd: 23 });
    await quiet.fire();
    expect(await quiet.pending()).toEqual([]);
    const away = await setup();
    await away.fire();
    away.setPresence("locked");
    expect(await away.pending()).toEqual([]);
  });
  it("stops offering a reminder after five minutes", async () => {
    const f = await setup();
    await f.fire();
    f.advance(301_000);
    expect(await f.pending()).toEqual([]);
  });
});
