import { describe, expect, it, vi } from "vitest";
import { AssistantJobBatch } from "../../assistant/model/assistantJobs";
import { VoiceJobDraftsSchema, voiceJobDrafts } from "./voiceJobs";
import { voiceJobReceipt } from "./voiceJobReceipt";
import { voiceReminderCall } from "./voiceReminders";
import { VOICE_ASSISTANT_CONTROL_TOOLS } from "./voiceAssistantControls";

const project = { id: "p1", path: "C:/work/app" };
const draftsFor = (jobs: unknown[]) => {
  let n = 0;
  return voiceJobDrafts(
    VoiceJobDraftsSchema.parse(jobs),
    [project],
    [project.path],
    project.path,
    () => `key-${++n}`,
  );
};
const job = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  request: `Do ${title}`,
  ...extra,
});

describe("give_jobs ordering", () => {
  it("turns an index into the earlier draft's key and keeps an existing job id", () => {
    const [a, b, c] = draftsFor([
      job("A"),
      job("B", { after: 0 }),
      job("C", { after: "existing-job-id" }),
    ]);
    expect(a).not.toHaveProperty("afterKey");
    expect(b.afterKey).toBe(a.idempotencyKey);
    expect(c.after).toBe("existing-job-id");
    expect(draftsFor([job("A"), job("B", { after: "0" })])[1].afterKey).toBe("key-1");
  });
  it("rejects a self, forward, unknown or quick-job target so a cycle cannot form", () => {
    for (const jobs of [
      [job("A", { after: 0 })],
      [job("A", { after: 1 }), job("B", { after: 0 })],
      [job("A"), job("B", { after: 5 })],
      [
        {
          kind: "quick",
          title: "N",
          request: "r",
          quickAction: { kind: "note", title: "t", body: "b" },
        },
        job("B", { after: 0 }),
      ],
    ])
      expect(VoiceJobDraftsSchema.safeParse(jobs).success).toBe(false);
  });
  it("creates the later job with the earlier job's id", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const request = vi.fn(async (input: Record<string, unknown>) => {
      requests.push(input);
      if (input.op === "snapshot") return { snapshot: { jobs: [] } };
      const id = `job-${requests.length}`;
      return {
        job: {
          id,
          title: input.title,
          request: input.request,
          projectId: input.projectId,
          projectIds: input.projectIds,
          idempotencyKey: input.idempotencyKey,
          status: "queued",
        },
      };
    });
    const drafts = draftsFor([job("A"), job("B", { after: 0 })]);
    const accepted = await new AssistantJobBatch(request as never).start(drafts);
    expect(accepted).toHaveLength(2);
    const creates = requests.filter((input) => input.op === "jobs.create");
    expect(creates[0]).not.toHaveProperty("after");
    expect(creates[1].after).toBe("job-2");
  });
});

describe("one-time automation drafts", () => {
  const base = {
    kind: "quick",
    title: "Nightly",
    request: "r",
    quickAction: {
      kind: "automation",
      projectPath: project.path,
      name: "n",
      prompt: "p",
      scheduleKind: "once",
      minute: 5,
      time: "01:00",
      dayOfWeek: 0,
      maxRunMinutes: 0,
      maxRunsPerDay: 0,
      isolate: false,
      enabled: true,
    },
  };
  it("needs runAt and derives the stored local time", () => {
    expect(VoiceJobDraftsSchema.safeParse([base]).success).toBe(false);
    const runAt = new Date("2026-10-06T09:00:00").getTime();
    const [draft] = draftsFor([{ ...base, quickAction: { ...base.quickAction, runAt } }]);
    expect(draft.quickAction).toMatchObject({
      scheduleKind: "once",
      runAt,
      time: "09:00",
      minute: 0,
    });
    expect(
      VoiceJobDraftsSchema.safeParse([
        { ...base, quickAction: { ...base.quickAction, scheduleKind: "daily", runAt } },
      ]).success,
    ).toBe(false);
  });
});

describe("dependency hold receipt", () => {
  it("explains the dependency hold", async () => {
    const receipt = await voiceJobReceipt(
      [{ id: "b", title: "B", status: "queued" }],
      async () => ({
        snapshot: { jobHolds: { b: "dependency" } },
      }),
    );
    expect(receipt.jobs[0].holdReason).toBe("dependency");
    expect(receipt.next).toContain("waits for the job it was told to follow");
  });
});

describe("assistant_reminder tool", () => {
  const now = 1_000_000;
  const reminder = {
    id: "r1",
    version: 1,
    text: "Call Sam",
    at: now + 60_000,
    status: "pending",
    createdAt: now,
  };
  it("is part of the control tools with a time-resolution description", () => {
    const tool = VOICE_ASSISTANT_CONTROL_TOOLS.find((item) => item.name === "assistant_reminder");
    expect(tool?.description).toContain("ABSOLUTE");
    expect(tool?.description).toContain("say the resolved date and time aloud");
  });
  it("creates, lists and cancels through the reminders operations", async () => {
    const request = vi.fn(async (input: { op: string }) =>
      input.op === "reminders.create"
        ? { reminders: { items: [reminder], reminder } }
        : { reminders: { items: input.op === "reminders.list" ? [reminder] : [] } },
    );
    const created = (await voiceReminderCall(
      { action: "create", text: "Call Sam", at: reminder.at, requestId: "req" },
      request as never,
      now,
    )) as { status: string; reminder: { id: string } };
    expect(created).toMatchObject({ status: "created", reminder: { id: "r1" } });
    expect(request).toHaveBeenLastCalledWith({
      op: "reminders.create",
      text: "Call Sam",
      at: reminder.at,
      requestId: "req",
    });
    const listed = (await voiceReminderCall({ action: "list" }, request as never, now)) as {
      reminders: unknown[];
    };
    expect(listed.reminders).toHaveLength(1);
    await voiceReminderCall(
      { action: "cancel", id: "r1", expectedVersion: 1 },
      request as never,
      now,
    );
    expect(request).toHaveBeenLastCalledWith({
      op: "reminders.cancel",
      id: "r1",
      expectedVersion: 1,
    });
  });
  it("refuses a past, too-distant or unkeyed create before asking the Host", async () => {
    const request = vi.fn();
    await expect(
      voiceReminderCall({ action: "create", text: "x", at: now - 1, requestId: "q" }, request, now),
    ).rejects.toThrow("past");
    await expect(
      voiceReminderCall(
        { action: "create", text: "x", at: now + 400 * 86_400_000, requestId: "q" },
        request,
        now,
      ),
    ).rejects.toThrow("year");
    await expect(
      voiceReminderCall({ action: "create", text: "x", at: now + 1000 }, request, now),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
