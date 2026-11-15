import { describe, expect, it } from "vitest";
import type { HostSessionSummary } from "../../src/features/connections/model/protocol";
import type { PushDeviceStore, PushRecipient } from "./push-store";
import { widgetPushIdentity, widgetPushPayload } from "./widget-payload";
import { PushNotifications } from "./push-service";
import type { ExpoPushMessage } from "./expo-push";

const now = 1_800_000_000_000;
function session(id: string, patch: Partial<HostSessionSummary> = {}): HostSessionSummary {
  return {
    id,
    projectId: "p",
    status: "running",
    updatedAt: now,
    title: "Secret",
    issueMessage: "secret token /path",
    widgetContext: { questionPrompt: "Secret question" },
    ...patch,
  } as HostSessionSummary;
}
describe("widget metadata push", () => {
  it("does not block ordinary notifications when widget delivery fails", async () => {
    let sessions = [session("s", { status: "idle" })];
    const sent: ExpoPushMessage[] = [];
    const recipient = {
      widgetUpdates: true,
      pushToken: "ExpoPushToken[token1234]",
      title: "bycoda",
      texts: { input: "Waiting", finished: "Finished", failed: "Failed" },
      events: { input: true, finished: true, failed: true, assistant: false, approvals: false },
    } as PushRecipient;
    const service = new PushNotifications({
      store: { recipients: async () => [recipient] } as unknown as PushDeviceStore,
      environmentId: "env",
      sessions: async () => sessions,
      send: async (messages) => {
        if (messages[0]?.data.kind === "widget") throw new Error("relay unavailable");
        sent.push(...messages);
        return { failed: 0, unregistered: [] };
      },
    });
    await service.tick();
    sessions = [session("s", { needsInput: true })];
    await service.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0].data.kind).toBe("input");
  });
  it("allowlists metadata, orders attention first, counts all eligible sessions and bounds provider bytes", () => {
    const payload = widgetPushPayload(
      [
        session("running"),
        session("failed", { issue: "failed" }),
        session("question", { needsInput: true }),
        session("archived", { archived: true }),
        session("draft", { draft: true }),
      ],
      now,
    );
    expect(payload.sessions.map((s) => s.kind)).toEqual(["question", "failed", "running"]);
    expect(payload.counts).toEqual({ running: 1, needsInput: 1, failed: 1 });
    expect(JSON.stringify(payload)).not.toMatch(/Secret|token|path|questionPrompt|issueMessage/);
    const large = widgetPushPayload(
      Array.from({ length: 40 }, (_, i) => session(`${i}${"😀".repeat(45)}`)),
      now,
    );
    expect(Buffer.byteLength(JSON.stringify(large))).toBeLessThan(3000);
    expect(large.complete).toBe(false);
  });
  it("ignores incidental timing changes, detects started/finished/question answered/failure transitions", () => {
    const identity = (patch: Partial<HostSessionSummary>) =>
      widgetPushIdentity(widgetPushPayload([session("s", patch)], now));
    expect(identity({ updatedAt: now + 1000 })).toBe(identity({}));
    for (const patch of [
      { status: "idle" as const },
      { needsInput: true },
      { issue: "failed" as const },
    ])
      expect(identity(patch)).not.toBe(identity({}));
  });
  it("coalesces ticks, sends while desktop active, heartbeats and respects legacy/event gates", async () => {
    let wall = now;
    let sessions = [session("s")];
    const sent: ExpoPushMessage[] = [];
    const base = {
      pushToken: "ExpoPushToken[token1234]",
      events: { finished: true, input: true, failed: true, assistant: false, approvals: false },
      widgetUpdates: true,
    } as PushRecipient;
    let recipients = [base];
    const service = new PushNotifications({
      store: { recipients: async () => recipients } as unknown as PushDeviceStore,
      environmentId: "env",
      sessions: async () => sessions,
      wallNow: () => wall,
      send: async (messages) => {
        sent.push(...messages);
        return { failed: 0, unregistered: [] };
      },
    });
    service.desktopPresence("desktop", true);
    await service.tick();
    await service.tick();
    expect(sent).toHaveLength(1);
    sessions = [session("s", { needsInput: true })];
    await service.tick();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      _contentAvailable: true,
      data: { kind: "widget", environmentId: "env" },
    });
    expect(sent[1].title).toBeUndefined();
    expect(sent[1].sound).toBeUndefined();
    wall += 4 * 60_000;
    await service.tick();
    expect(sent).toHaveLength(3);
    recipients = [{ ...base, widgetUpdates: undefined }];
    wall += 4 * 60_000;
    await service.tick();
    expect(sent).toHaveLength(3);
    recipients = [
      { ...base, events: { ...base.events, finished: false, input: false, failed: false } },
    ];
    wall += 4 * 60_000;
    await service.tick();
    expect(sent).toHaveLength(3);
  });
});
