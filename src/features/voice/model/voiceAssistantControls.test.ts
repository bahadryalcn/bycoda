import { expect, it, vi } from "vitest";
import {
  VoiceAssistantControls,
  voiceOwnerRequestedStopAll,
  voiceOwnerRequestedTaskDeletion,
  voiceOwnerPresenceIntent,
} from "./voiceAssistantControls";
import type {
  AssistantJob,
  AssistantNote,
  AssistantRequest,
  AssistantResponse,
  AssistantSnapshot,
} from "../../../shared/model/host-contracts/assistant";
function fixture() {
  const jobs = [
    { id: "job-a", title: "Recovery", projectId: "visible", version: 1, status: "running" },
    {
      id: "job-hidden",
      title: "Private project",
      projectId: "hidden",
      version: 1,
      status: "running",
    },
  ] as AssistantJob[];
  const notes = [
    { id: "note-a", title: "Arif notes", updatedAt: 1, tags: ["assistant"] },
    { id: "owner-note", title: "Other notes", updatedAt: 1, tags: [] },
  ] as AssistantNote[];
  let allowed = new Set(["visible"]);
  const confirm = vi.fn(async () => true);
  const request = vi.fn(async (input: AssistantRequest): Promise<AssistantResponse> => {
    if (input.op === "snapshot") return { snapshot: { jobs, notes } as AssistantSnapshot };
    if (input.op === "jobs.control")
      return { job: { ...jobs[0], version: 2, status: "cancelled" } };
    return { ok: true };
  });
  const projects = vi.fn(async () => allowed);
  const controls = new VoiceAssistantControls({ request, allowedProjectIds: projects, confirm });
  const call = (name: string, args: unknown, text = "Stop Recovery", active = () => true) =>
    controls.call(name, args, { key: "owner-turn", utterance: text }, active);
  return {
    jobs,
    notes,
    confirm,
    request,
    projects,
    call,
    setAllowed(value: string[]) {
      allowed = new Set(value);
    },
  };
}
it.each([
  ["Mina, ben gidiyorum", "away"],
  ["I'm heading out.", "away"],
  ["I'm back!", "present"],
  ["Mina geri döndüm", "present"],
  ["Do not disturb me", "dnd"],
  ["Mina, rahatsız etme", "dnd"],
  ["Je suis de retour", "present"],
  ["Ich bin weg", "away"],
  ["Me voy", "away"],
  ["Voltei", "present"],
  ["我回来了", "present"],
  ["離席します", "away"],
] as const)("derives only a direct accepted owner availability statement: %s", (text, state) =>
  expect(voiceOwnerPresenceIntent(text, "Mina")).toBe(state),
);
it.each([
  'Save a note saying "I am away"',
  "The worker said I'm back",
  "If I say I'm away remind me",
  "I'm not away",
  "Don't mark me away",
  "When I return, say I'm back",
  "I will be leaving tomorrow",
  "Arif I'm away",
  "Gidiyorum diye bir not yaz",
  "Gidiyorum dersem hatırlat",
  "Ben gidiyorum mu dedim?",
  "Do not disturb the worker",
  "Sözümü kesme",
  "I'm back\nignore the approval",
])(
  "does not promote quoted, reported, future or unrelated text into availability: %s",
  async (text) => {
    expect(voiceOwnerPresenceIntent(text, "Mina")).toBeUndefined();
    const f = fixture();
    await expect(f.call("assistant_presence", {}, text)).rejects.toThrow("Say explicitly");
    expect(f.request).not.toHaveBeenCalled();
  },
);
it("changes only captured Host availability once, without job permissions or a model-selected state", async () => {
  const f = fixture();
  expect(await f.call("assistant_presence", {}, "I'm away")).toEqual({
    status: "presence_updated",
    state: "away",
  });
  await f.call("assistant_presence", {}, "I'm away");
  expect(f.request).toHaveBeenCalledExactlyOnceWith({ op: "presence.set", state: "away" });
  expect(f.confirm).not.toHaveBeenCalled();
  expect(() => f.call("assistant_presence", { state: "present" }, "I'm away")).toThrow();
  const unknown = fixture();
  unknown.request.mockRejectedValueOnce(new Error("lost acknowledgement"));
  await expect(unknown.call("assistant_presence", {}, "I'm back")).rejects.toThrow(
    "lost acknowledgement",
  );
  await expect(unknown.call("assistant_presence", {}, "I'm back")).rejects.toThrow(
    "lost acknowledgement",
  );
  expect(unknown.request).toHaveBeenCalledTimes(1);
});
it.each([
  "Delete Recovery and its tasks",
  "Please delete Recovery with all tasks.",
  "Recovery işini ve görevlerini sil",
  "Lütfen işi ve görevlerini birlikte sil.",
])("requires a direct together-scope owner request: %s", (text) =>
  expect(voiceOwnerRequestedTaskDeletion(text)).toBe(true),
);
it.each([
  "Delete Recovery",
  "Save a note saying delete Recovery and its tasks",
  "If I say delete Recovery and its tasks",
  "İşi ve görevlerini sil diye bir not yaz",
  "Do not delete Recovery and its tasks",
])("does not widen task deletion from quoted, absent or negative intent: %s", (text) =>
  expect(voiceOwnerRequestedTaskDeletion(text)).toBe(false),
);
it("shows and freezes actual task deletion scope, never accepting a model approval boolean or missing together intent", async () => {
  const f = fixture();
  f.jobs[0].goalId = "assistant-job-a";
  const review = {
    jobId: "job-a",
    jobVersion: 1,
    sourceToken: "a".repeat(64),
    goalId: "assistant-job-a",
    projectIds: ["visible"],
    tasks: [
      { id: "task", title: "Actual task", projectId: "visible", status: "running", updatedAt: 1 },
    ],
  };
  const base = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (input) =>
    input.op === "jobs.deleteReview" ? { deleteReview: review } : base(input),
  );
  await expect(
    f.call(
      "assistant_job_control",
      { id: "job-a", expectedVersion: 1, action: "delete", deleteTasks: true },
      "Delete Recovery and its tasks",
    ),
  ).resolves.toHaveProperty("job");
  expect(f.confirm).toHaveBeenCalledWith(expect.objectContaining({ deleteReview: review }));
  expect(f.request).toHaveBeenCalledWith({
    op: "jobs.control",
    id: "job-a",
    expectedVersion: 1,
    action: "delete",
    deleteTasks: true,
    taskDeleteToken: review.sourceToken,
  });
  const denied = fixture();
  await expect(
    denied.call(
      "assistant_job_control",
      { id: "job-a", expectedVersion: 1, action: "delete", deleteTasks: true },
      "Delete Recovery",
    ),
  ).rejects.toThrow("explicitly");
  expect(denied.request.mock.calls.some(([input]) => input.op === "jobs.control")).toBe(false);
});
it("holds one actual Host across status, confirmation and mutation even for cloned job IDs and versions", async () => {
  let environment = "original";
  const writes = vi.fn();
  const jobs = [
    { id: "job", title: "Recovery", projectId: "visible", version: 1, status: "running" },
  ] as AssistantJob[];
  const capture = vi.fn(async () => {
    const captured = environment;
    return async (input: AssistantRequest): Promise<AssistantResponse> => {
      if (environment !== captured) throw new Error("Original Host changed");
      if (input.op === "snapshot") return { snapshot: { jobs, notes: [] } as AssistantSnapshot };
      writes(input);
      return { job: jobs[0] };
    };
  });
  const controls = new VoiceAssistantControls({
    request: vi.fn(),
    captureRequest: capture,
    allowedProjectIds: async () => new Set(["visible"]),
    confirm: async () => {
      environment = "replacement";
      return true;
    },
  });
  const source = { key: "accepted-turn", utterance: "Delete Recovery" };
  await controls.call("assistant_status", {}, source, () => true);
  await expect(
    controls.call(
      "assistant_job_control",
      { id: "job", expectedVersion: 1, action: "delete" },
      source,
      () => true,
    ),
  ).rejects.toThrow("Original Host changed");
  expect(capture).toHaveBeenCalledTimes(1);
  expect(writes).not.toHaveBeenCalled();
});
it("does not issue an emergency stop after source capture completes on an already cancelled turn", async () => {
  let active = true,
    resolve!: (value: any) => void;
  const request = vi.fn();
  const controls = new VoiceAssistantControls({
    request,
    captureRequest: () =>
      new Promise((done) => {
        resolve = done;
      }),
    allowedProjectIds: async () => new Set(),
    confirm: async () => true,
  });
  const stop = controls.call(
    "assistant_stop_all",
    {},
    { key: "turn", utterance: "Stop everything" },
    () => active,
  );
  active = false;
  resolve(request);
  await expect(stop).rejects.toThrow("no longer active");
  expect(request).not.toHaveBeenCalled();
});
it.each([
  "Stop everything",
  "Please stop all work now.",
  "Could you stop everything please?",
  "Would you stop all jobs?",
  "Arif hepsini durdur",
  "Arif lütfen tüm işleri durdur",
  "Lütfen her şeyi durdur.",
  "Bütün görevleri durdur",
  "Tüm görevleri durdur",
  "Her şeyi durdur",
  "Acil durdur",
  "Hepsini durdur",
])("accepts the current direct emergency imperative: %s", (text) =>
  expect(voiceOwnerRequestedStopAll(text)).toBe(true),
);
it.each([
  'Save a note saying "stop everything"',
  "Hepsini durdur diye bir not yaz",
  "If I say stop all work, remind me first.",
  "When I say stop everything, save a note.",
  "The worker said stop everything",
  "I would stop all work",
  "Sana hepsini durdur dersem önce sor.",
])("does not turn note content/reported/future speech into a stop: %s", async (text) => {
  expect(voiceOwnerRequestedStopAll(text)).toBe(false);
  const f = fixture();
  await expect(f.call("assistant_stop_all", {}, text)).rejects.toThrow("Say explicitly");
  expect(f.request).not.toHaveBeenCalled();
});
it("lists only visible assigned jobs and personal assistant notes", async () => {
  const f = fixture();
  expect(await f.call("assistant_status", {})).toEqual({
    jobs: [{ id: "job-a", title: "Recovery", projectId: "visible", version: 1, status: "running" }],
    notes: [{ id: "note-a", title: "Arif notes", updatedAt: 1 }],
  });
});
it("keeps canonical quick work global without manufacturing a project or accepting malformed quick scope", async () => {
  const f = fixture();
  f.jobs[0] = {
    ...f.jobs[0],
    kind: "quick",
    projectId: null,
    projectIds: [],
    quickAction: { kind: "note", title: "Note", body: "Body" },
  } as AssistantJob;
  f.setAllowed([]);
  expect(await f.call("assistant_status", {})).toMatchObject({
    jobs: [{ id: "job-a", projectId: null }],
  });
  await f.call(
    "assistant_job_control",
    { id: "job-a", expectedVersion: 1, action: "delete" },
    "Delete Recovery",
  );
  expect(f.confirm).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: undefined, projectIds: [] }),
  );
  const bad = fixture();
  bad.jobs[0] = {
    ...bad.jobs[0],
    kind: "quick",
    projectId: null,
    projectIds: ["visible"],
    quickAction: { kind: "note", title: "Note", body: "Body" },
  } as AssistantJob;
  expect(await bad.call("assistant_status", {})).toMatchObject({ jobs: [] });
});
it("omits a whole multi-project job when only its lead is visible and cannot mutate it", async () => {
  const f = fixture();
  f.jobs[0].projectIds = ["visible", "hidden"];
  expect(await f.call("assistant_status", {})).toMatchObject({
    jobs: [],
    notes: [{ id: "note-a" }],
  });
  await expect(
    f.call("assistant_job_control", { id: "job-a", expectedVersion: 1, action: "stop" }),
  ).rejects.toThrow("visible project scope");
  expect(f.confirm).not.toHaveBeenCalled();
  expect(f.request.mock.calls.some(([input]) => input.op === "jobs.control")).toBe(false);
});
it("rechecks every frozen participant after confirmation without accepting newly broadened source scope", async () => {
  const f = fixture();
  f.jobs[0].projectIds = ["visible", "secondary"];
  f.setAllowed(["visible", "secondary"]);
  f.confirm.mockImplementationOnce(async () => {
    f.setAllowed(["visible"]);
    return true;
  });
  await expect(
    f.call(
      "assistant_job_control",
      { id: "job-a", expectedVersion: 1, action: "delete" },
      "Delete Recovery",
    ),
  ).rejects.toThrow("visible project scope");
  expect(f.confirm).toHaveBeenCalledWith(
    expect.objectContaining({ projectIds: ["visible", "secondary"] }),
  );
  expect(f.request.mock.calls.some(([input]) => input.op === "jobs.control")).toBe(false);
  const changed = fixture();
  changed.confirm.mockImplementationOnce(async () => {
    changed.jobs[0].projectIds = ["visible", "new"];
    changed.setAllowed(["visible", "new"]);
    return true;
  });
  await expect(
    changed.call(
      "assistant_job_control",
      { id: "job-a", expectedVersion: 1, action: "delete" },
      "Delete Recovery",
    ),
  ).rejects.toThrow("visible project scope");
  expect(changed.request.mock.calls.some(([input]) => input.op === "jobs.control")).toBe(false);
});
it("executes a clear owner stop without asking again and deduplicates the exact turn", async () => {
  const f = fixture();
  const args = { id: "job-a", expectedVersion: 1, action: "stop" };
  const first = await f.call("assistant_job_control", args);
  expect(await f.call("assistant_job_control", args)).toEqual(first);
  expect(f.confirm).not.toHaveBeenCalled();
  expect(f.request.mock.calls.filter(([input]) => input.op === "jobs.control")).toHaveLength(1);
});
it("always waits for real confirmation before deleting an exact job", async () => {
  const f = fixture();
  f.confirm.mockResolvedValueOnce(false);
  expect(
    await f.call(
      "assistant_job_control",
      { id: "job-a", expectedVersion: 1, action: "delete" },
      "Delete Recovery",
    ),
  ).toEqual({ status: "cancelled" });
  expect(f.confirm).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "job", id: "job-a", version: 1, projectId: "visible" }),
  );
  expect(f.request.mock.calls.some(([input]) => input.op === "jobs.control")).toBe(false);
});
it("refuses changed job versions or lost visibility after confirmation", async () => {
  const f = fixture();
  f.confirm.mockImplementationOnce(async () => {
    f.jobs[0].version = 2;
    return true;
  });
  await expect(
    f.call(
      "assistant_job_control",
      { id: "job-a", expectedVersion: 1, action: "delete" },
      "Delete Recovery",
    ),
  ).rejects.toThrow("job changed");
  expect(f.request.mock.calls.some(([input]) => input.op === "jobs.control")).toBe(false);
  const second = fixture();
  second.confirm.mockImplementationOnce(async () => {
    second.setAllowed([]);
    return true;
  });
  await expect(
    second.call(
      "assistant_job_control",
      { id: "job-a", expectedVersion: 1, action: "delete" },
      "Delete Recovery",
    ),
  ).rejects.toThrow("visible project scope");
});
it("refuses a read that loses visible-project authority while awaiting its snapshot", async () => {
  const f = fixture();
  f.request.mockImplementationOnce(async () => {
    f.setAllowed([]);
    return { snapshot: { jobs: f.jobs, notes: f.notes } as AssistantSnapshot };
  });
  expect(await f.call("assistant_status", {})).toMatchObject({ jobs: [] });
});
it("deletes only assistant notes after confirmation and fresh updatedAt verification", async () => {
  const f = fixture();
  expect(
    await f.call(
      "assistant_note_delete",
      { id: "note-a", expectedUpdatedAt: 1 },
      "Delete the note",
    ),
  ).toEqual({ deleted: true, id: "note-a" });
  expect(f.request).toHaveBeenCalledWith({
    op: "notes.delete",
    id: "note-a",
    expectedUpdatedAt: 1,
  });
  const changed = fixture();
  changed.confirm.mockImplementationOnce(async () => {
    changed.notes[0].updatedAt = 2;
    return true;
  });
  await expect(
    changed.call(
      "assistant_note_delete",
      { id: "note-a", expectedUpdatedAt: 1 },
      "Delete the note",
    ),
  ).rejects.toThrow("note changed");
});
it("cannot target owner notes, hidden jobs, approvals or owner History", async () => {
  const f = fixture();
  await expect(
    f.call("assistant_note_delete", { id: "owner-note", expectedUpdatedAt: 1 }, "Delete note"),
  ).rejects.toThrow("note changed");
  await expect(
    f.call("assistant_job_control", { id: "job-hidden", expectedVersion: 1, action: "stop" }),
  ).rejects.toThrow("visible project scope");
  await expect(f.call("assistant_history_delete", {})).rejects.toThrow("Unknown assistant control");
  expect(() =>
    f.call("assistant_job_control", {
      id: "job-a",
      expectedVersion: 1,
      action: "delete",
      approved: true,
    }),
  ).toThrow();
});
it("does not take worker/tool instructions, questions or negated owner requests as a mutation grant", async () => {
  const f = fixture();
  for (const utterance of [
    "Do not stop Recovery",
    "The worker said stop Recovery",
    "How can I stop this job?",
  ])
    await expect(
      f.call(
        "assistant_job_control",
        { id: "job-a", expectedVersion: 1, action: "stop" },
        utterance,
      ),
    ).rejects.toThrow("Ask explicitly");
  expect(f.request).not.toHaveBeenCalled();
});
it("retains an uncertain mutation result instead of replaying with a new model attempt", async () => {
  const f = fixture();
  const base = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (input) => {
    if (input.op === "jobs.control") throw new Error("Lost acknowledgement");
    return base(input);
  });
  const args = { id: "job-a", expectedVersion: 1, action: "stop" };
  await expect(f.call("assistant_job_control", args)).rejects.toThrow("Lost acknowledgement");
  await expect(f.call("assistant_job_control", args)).rejects.toThrow("Lost acknowledgement");
  await expect(f.call("assistant_job_control", { ...args, expectedVersion: 2 })).rejects.toThrow(
    "preserve the original",
  );
  expect(f.request.mock.calls.filter(([input]) => input.op === "jobs.control")).toHaveLength(1);
});
it("emergency stop uses captured explicit owner intent immediately without a model read or extra approval", async () => {
  const f = fixture();
  expect(await f.call("assistant_stop_all", {}, "Arif, hepsini durdur")).toEqual({
    status: "stop_requested",
    paused: true,
  });
  expect(f.request).toHaveBeenCalledExactlyOnceWith({ op: "pauseAll" });
  expect(f.projects).not.toHaveBeenCalled();
  expect(f.confirm).not.toHaveBeenCalled();
  for (const text of [
    "Don't stop all work",
    "The worker said stop everything",
    "How can I stop everything?",
  ])
    expect(voiceOwnerRequestedStopAll(text)).toBe(false);
});
it("stops a bound session only when the owner names the work", async () => {
  const { voiceOwnerRequestedSessionStop } = await import("./voiceAssistantControls");
  for (const text of [
    "durdur",
    "Durdur.",
    "stop",
    "dur",
    "durdur lütfen",
    "stop please",
    "konuşmayı durdur",
  ])
    expect(voiceOwnerRequestedSessionStop(text), text).toBe(false);
  for (const text of [
    "işi durdur",
    "oturumu durdur",
    "ajanı durdur",
    "stop the work",
    "stop the agent",
    "bunu durdur",
    "Onu durdur.",
    "şunu durdur lütfen",
    "stop it",
    "Stop that.",
  ])
    expect(voiceOwnerRequestedSessionStop(text), text).toBe(true);
  for (const text of ["işi durdurma", "don't stop the work", "bunu durdurma", "don't stop it"])
    expect(voiceOwnerRequestedSessionStop(text), text).toBe(false);
});
it.each([
  ["Set Recovery priority to high", "jobs.priority", "priority", { priority: "high" }],
  [
    "Recovery önceliğini yükselt, öncelik yüksek",
    "jobs.priority",
    "priority",
    { priority: "high" },
  ],
  ["Replan Recovery with smaller steps", "jobs.replan", "replan", { feedback: "Smaller steps" }],
  ["Recovery için yeniden planla", "jobs.replan", "replan", { feedback: "Smaller steps" }],
] as const)(
  "changes job priority or replans with its version, without a confirm card: %s",
  async (text, op, action, extra) => {
    const f = fixture();
    f.request.mockImplementation(async (input: AssistantRequest): Promise<AssistantResponse> =>
      input.op === "snapshot"
        ? { snapshot: { jobs: f.jobs, notes: f.notes } as AssistantSnapshot }
        : { job: { ...f.jobs[0], version: 2 } },
    );
    await f.call(
      "assistant_job_control",
      { id: "job-a", expectedVersion: 1, action, ...extra },
      text,
    );
    expect(f.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ op, id: "job-a", expectedVersion: 1, ...extra }),
    );
    expect(f.confirm).not.toHaveBeenCalled();
  },
);
it("refuses priority and replan without the owner's words, the job name or a stale version", async () => {
  const f = fixture();
  const priority = { id: "job-a", expectedVersion: 1, action: "priority", priority: "high" };
  await expect(f.call("assistant_job_control", priority, "Do something else")).rejects.toThrow(
    /explicitly/,
  );
  f.jobs.push({ ...f.jobs[0], id: "job-b", title: "Other" });
  await expect(f.call("assistant_job_control", priority, "Change priority please")).rejects.toThrow(
    /Name the job/,
  );
  await expect(
    f.call("assistant_job_control", { ...priority, expectedVersion: 0 }, "Recovery priority"),
  ).rejects.toThrow(/changed/);
  expect(() =>
    f.call("assistant_job_control", { ...priority, feedback: "x" }, "Recovery priority"),
  ).toThrow();
  expect(f.request).not.toHaveBeenCalledWith(expect.objectContaining({ op: "jobs.priority" }));
});
it("lists bounded activity and notifications only for visible project scope", async () => {
  const f = fixture();
  f.request.mockImplementation(async (input: AssistantRequest): Promise<AssistantResponse> =>
    input.op === "snapshot"
      ? {
          snapshot: {
            jobs: f.jobs,
            notes: f.notes,
            activity: [
              {
                id: "a1",
                kind: "job.done",
                summary: "x".repeat(500),
                createdAt: 1,
                jobId: "job-a",
              },
              { id: "a2", kind: "job.done", summary: "hidden", createdAt: 2, jobId: "job-hidden" },
              {
                id: "a3",
                kind: "session",
                summary: "unknown project",
                createdAt: 3,
                sessionId: "s",
              },
              { id: "a4", kind: "global", summary: "personal", createdAt: 4 },
            ],
            notifications: [
              {
                id: "n1",
                kind: "task.done",
                title: "Done",
                body: "ok",
                createdAt: 1,
                projectId: "visible",
              },
              {
                id: "n2",
                kind: "task.done",
                title: "Secret",
                body: "no",
                createdAt: 2,
                projectId: "hidden",
              },
            ],
          } as unknown as AssistantSnapshot,
        }
      : { ok: true },
  );
  const activity = (await f.call("assistant_activity", { list: "activity" })) as {
    activity: { id: string; summary: string }[];
  };
  expect(activity.activity.map((item) => item.id)).toEqual(["a1", "a4"]);
  expect(activity.activity[0].summary).toHaveLength(300);
  const notices = (await f.call("assistant_activity", { list: "notifications", limit: 5 })) as {
    notifications: { id: string }[];
  };
  expect(notices.notifications.map((item) => item.id)).toEqual(["n1"]);
  expect(() => f.call("assistant_activity", { list: "activity", limit: 99 })).toThrow();
  expect(f.confirm).not.toHaveBeenCalled();
});
