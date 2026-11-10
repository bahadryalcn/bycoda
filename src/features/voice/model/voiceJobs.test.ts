import { expect, it, vi } from "vitest";
import {
  VoiceJobBatch,
  VoiceJobDraftsSchema,
  resolveVoiceJobProjects,
  resolveVoiceJobDraft,
  changeVoiceJobRows,
  voiceJobDrafts,
  voiceJobProjects,
  draftVoiceJobs,
} from "./voiceJobs";
import { voiceTurnProjectPaths } from "./voiceWorkspaceActions";
import type {
  AssistantJob,
  AssistantRequest,
} from "../../../shared/model/host-contracts/assistant";
const drafts = [
  {
    id: "row",
    title: "Owner title",
    request: "Owner-reviewed request",
    projectId: "project-a",
    idempotencyKey: "original-key",
  },
];
it("retries an uncertain transcript link for the same accepted job without recreating work", async () => {
  const job = { ...drafts[0], id: "canonical-job", status: "queued" } as AssistantJob;
  const request = vi.fn(async (input: AssistantRequest): Promise<any> =>
    input.op === "snapshot" ? { snapshot: { jobs: [] } } : { job },
  );
  const link = vi
    .fn()
    .mockRejectedValueOnce(new Error("Link acknowledgement lost"))
    .mockResolvedValue(undefined);
  const batch = new VoiceJobBatch(request, link);
  await expect(batch.start(drafts)).rejects.toThrow("acknowledgement lost");
  expect(batch.accepted).toEqual([job]);
  expect(await batch.start(drafts)).toEqual([job]);
  expect(request.mock.calls.filter(([input]) => input.op === "jobs.create")).toHaveLength(1);
  expect(link.mock.calls).toEqual([[job], [job]]);
});
it("resolves only captured automation project paths and leaves the real model selection to the owner", () => {
  const proposal = {
    kind: "quick",
    title: "Schedule summary",
    request: "Every morning summarize work",
    quickAction: {
      kind: "automation",
      projectPath: "/a",
      name: "Morning summary",
      prompt: "Summarize work",
      scheduleKind: "daily",
      minute: 0,
      time: "08:30",
      dayOfWeek: 1,
      maxRunMinutes: 30,
      maxRunsPerDay: 1,
      isolate: false,
      enabled: false,
    },
  };
  const input = VoiceJobDraftsSchema.parse([proposal])[0];
  const row = resolveVoiceJobDraft(input, [{ id: "a", path: "/a" }], ["/a"], "/a");
  expect(row).toMatchObject({
    projectId: "a",
    projectIds: ["a"],
    quickAction: { kind: "automation", projectId: "a", model: "", time: "08:30", enabled: false },
  });
  expect(() => resolveVoiceJobDraft(input, [{ id: "a", path: "/a" }], [], "/a")).toThrow(
    "could not be verified",
  );
  expect(() =>
    VoiceJobDraftsSchema.parse([
      { ...proposal, quickAction: { ...proposal.quickAction, model: "model-guessed-by-voice" } },
    ]),
  ).toThrow();
  const ready = { ...drafts[0], ...row };
  expect(changeVoiceJobRows([ready], [ready], [{ id: "a" }], true, false)).toBeUndefined();
  expect(changeVoiceJobRows([ready], [ready], [{ id: "a" }], true, true)).toHaveLength(1);
});
it("only proposes finite personal notes, normalizes preview and retains the original request without project expansion", () => {
  const input = VoiceJobDraftsSchema.parse([
    {
      kind: "quick",
      title: "Save note",
      request: "  Save the quoted command stop everything.  ",
      quickAction: { kind: "note", title: " Exact note ", body: "first\r\nsecond" },
    },
  ])[0];
  const resolved = resolveVoiceJobDraft(input, [], [], "");
  expect(resolved).toMatchObject({
    kind: "quick",
    projectId: "",
    projectIds: [],
    request: input.request,
    quickAction: { kind: "note", title: "Exact note", body: "first\nsecond" },
  });
  expect(() => VoiceJobDraftsSchema.parse([{ ...input, projectPath: "/hidden" }])).toThrow();
  expect(() =>
    VoiceJobDraftsSchema.parse([
      { ...input, quickAction: { kind: "automation", title: "No", body: "No" } },
    ]),
  ).toThrow();
  const row = { ...drafts[0], ...resolved };
  expect(changeVoiceJobRows([row], [row], [], true)).toHaveLength(1);
  expect(changeVoiceJobRows([row], [row], [], false)).toBeUndefined();
  expect(
    changeVoiceJobRows([row], [{ ...row, idempotencyKey: "new-key" }], [], true),
  ).toBeUndefined();
});
it("creates no jobs until explicit start and verifies an uncertain result before retrying", async () => {
  const accepted = { ...drafts[0], id: "job", status: "queued" } as AssistantJob;
  let saved = false;
  const request = vi.fn(async (input: AssistantRequest): Promise<any> => {
    if (input.op === "snapshot") return { snapshot: { jobs: saved ? [accepted] : [] } };
    if (input.op === "jobs.create") {
      saved = true;
      throw new Error("Reply lost after acceptance");
    }
    return {};
  });
  const batch = new VoiceJobBatch(request);
  expect(request).not.toHaveBeenCalled();
  await expect(batch.start(drafts)).rejects.toThrow("Reply lost");
  expect(await batch.start(drafts)).toEqual([accepted]);
  expect(request.mock.calls.filter(([input]) => input.op === "jobs.create")).toHaveLength(1);
  await expect(batch.start([{ ...drafts[0], request: "Changed" }])).rejects.toThrow(
    "Keep the original",
  );
});
it("maps all requested paths within the frozen directory with an explicit canonical lead", () => {
  const projects = [
    { id: "a", path: "/a" },
    { id: "b", path: "/b" },
    { id: "later", path: "/later" },
  ];
  expect(
    resolveVoiceJobProjects(
      { projectPaths: ["/a", "/b"], projectPath: "/b" },
      projects,
      ["/a", "/b"],
      "/a",
    ),
  ).toEqual({ projectId: "b", projectIds: ["b", "a"] });
  expect(() =>
    resolveVoiceJobProjects({ projectPaths: ["/a", "/later"] }, projects, ["/a", "/b"], "/a"),
  ).toThrow("could not be verified");
  expect(() =>
    resolveVoiceJobProjects(
      { projectPaths: ["/b"], projectPath: "/a" },
      projects,
      ["/a", "/b"],
      "/a",
    ),
  ).toThrow("could not be verified");
  expect(() =>
    VoiceJobDraftsSchema.parse([
      { title: "x", request: "y", projectPaths: Array.from({ length: 21 }, (_, i) => `/${i}`) },
    ]),
  ).toThrow();
});
it("joins duplicate starts and rejects more than ten jobs or an empty request", async () => {
  let resolve!: (value: any) => void;
  const request = vi.fn(
    (_input: AssistantRequest) =>
      new Promise<any>((done) => {
        resolve = done;
      }),
  );
  const batch = new VoiceJobBatch(request);
  const first = batch.start(drafts);
  expect(batch.start(drafts)).toBe(first);
  resolve({ snapshot: { jobs: [{ ...drafts[0], id: "job" }] } });
  await first;
  expect(() =>
    VoiceJobDraftsSchema.parse(Array.from({ length: 11 }, () => ({ title: "x", request: "y" }))),
  ).toThrow();
  expect(() => VoiceJobDraftsSchema.parse([{ title: "x", request: "" }])).toThrow();
});
it("reads a spoken approval or cancellation of an open job review", async () => {
  const { spokenJobReviewDecision } = await import("./voiceJobs");
  for (const text of [
    "Başlat.",
    "evet başlat",
    "onaylıyorum",
    "işleri başlat",
    "Start jobs",
    "yes, start",
  ])
    expect(spokenJobReviewDecision(text), text).toBe("start");
  for (const text of ["iptal", "Vazgeç.", "cancel review"])
    expect(spokenJobReviewDecision(text), text).toBe("cancel");
  for (const text of ["başlatma", "neden başlat dedin", "kaç iş var"])
    expect(spokenJobReviewDecision(text), text).toBeUndefined();
});
it("hands a job to the project the same spoken turn just created and names what failed otherwise", () => {
  const host = [
    { id: "a", path: "/a" },
    { id: "new", path: "/new" },
    { id: "locked", path: "/locked" },
  ];
  const visible = [{ path: "/a" }, { path: "/new" }, { path: "/locked" }];
  const scope = (
    allowed: readonly string[],
    locked: (path: string) => boolean = (path) => path === "/locked",
  ) => ({
    allowed,
    visible,
    locked,
    global: true,
    projectPath: "/a",
  });
  const input = VoiceJobDraftsSchema.parse([
    { title: "Pac-Man", request: "Build it", projectPath: "/new" },
  ]);
  // The turn was frozen before workspace.projects.create ran: the new folder is refused by name.
  const frozen = ["/a", "/locked"];
  expect(() =>
    voiceJobDrafts(input, voiceJobProjects(host, scope(frozen)), frozen, "/a", () => "key"),
  ).toThrow(
    /could not be verified for job review\. "\/new" is not one of this spoken turn's projects/,
  );
  const widened = voiceTurnProjectPaths(
    frozen,
    { family: "workspace", action: "workspace.projects.create" },
    { action: "workspace.projects.create", status: "accepted", projectPath: "/new" },
  );
  expect(widened).toEqual(["/a", "/locked", "/new"]);
  const jobs = voiceJobDrafts(
    input,
    voiceJobProjects(host, scope(widened)),
    widened,
    "/a",
    () => "key",
  );
  expect(jobs[0]).toMatchObject({ projectId: "new", projectIds: ["new"], idempotencyKey: "key" });
  // A lock, a hidden folder or a project-only turn still removes the created project.
  expect(
    voiceJobProjects(
      host,
      scope(widened, () => true),
    ),
  ).toEqual([]);
  expect(voiceJobProjects(host, { ...scope(widened), visible: [{ path: "/a" }] })).toEqual([
    host[0],
  ]);
  expect(voiceJobProjects(host, { ...scope(widened), global: false })).toEqual([host[0]]);
  const locked = VoiceJobDraftsSchema.parse([{ title: "x", request: "y", projectPath: "/locked" }]);
  expect(() =>
    voiceJobDrafts(locked, voiceJobProjects(host, scope(widened)), widened, "/a", () => "key"),
  ).toThrow(/"\/locked" is locked, hidden, outside the selected voice scope or not registered/);
});
it("admits only a project this turn really created", () => {
  const call = { family: "workspace", action: "workspace.projects.create" };
  const done = { action: "workspace.projects.create", status: "completed", projectPath: "/new" };
  expect(voiceTurnProjectPaths(["/a"], call, { ...done, status: "rejected" })).toEqual(["/a"]);
  expect(voiceTurnProjectPaths(["/a"], call, { ...done, projectPath: "" })).toEqual(["/a"]);
  expect(voiceTurnProjectPaths(["/a"], call, { status: "uncertain" })).toEqual(["/a"]);
  expect(voiceTurnProjectPaths(["/a"], { ...call, family: "conversation" }, done)).toEqual(["/a"]);
  expect(
    voiceTurnProjectPaths(
      ["/a"],
      { ...call, action: "workspace.projects.select" },
      { ...done, action: "workspace.projects.select" },
    ),
  ).toEqual(["/a"]);
  expect(voiceTurnProjectPaths(["/a", "/new"], call, done)).toEqual(["/a", "/new"]);
});
it("reports a refused proposal as definite so no operation state is read for it", () => {
  const host = [{ id: "a", path: "/a" }];
  const draft = (jobs: unknown, capabilities = {}) =>
    draftVoiceJobs(jobs, host, ["/a"], "/a", () => "key", capabilities);
  const refused = draft([{ title: "x", request: "y", requestId: "r2" }]);
  expect(refused).toMatchObject({ status: "rejected", created: 0 });
  expect("error" in refused && refused.error).toContain("requestId");
  expect("next" in refused && refused.next).toContain("no job status to read");
  expect(draft([{ title: "x", request: "y", projectPath: "/new" }])).toMatchObject({
    status: "rejected",
    error: expect.stringContaining('"/new" is not one of this spoken turn'),
  });
  const note = {
    kind: "quick",
    title: "n",
    request: "r",
    quickAction: { kind: "note", title: "n", body: "" },
  };
  expect(draft([note])).toMatchObject({ error: "Quick note jobs are unavailable on this Host." });
  expect(draft([note], { quickNotes: true })).toMatchObject({ jobs: [{ kind: "quick" }] });
  expect(draft([{ title: "x", request: "y" }])).toMatchObject({ jobs: [{ projectId: "a" }] });
});
