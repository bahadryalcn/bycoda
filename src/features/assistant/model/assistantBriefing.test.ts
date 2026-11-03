import { beforeEach, expect, it, vi } from "vitest";
const source = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn() }));
vi.mock("./assistantHostRead", () => ({
  captureAssistantHostRead: async () => {
    const value = await source.request(
      "",
      "transport.ws.read.v2",
      "environment.describe",
      {},
      { kind: "local" },
    );
    return {
      environmentId: value.environmentId,
      goals: () => source.request("", "transport.ws.goals.v2", "goals.list", {}, { kind: "local" }),
    };
  },
}));
vi.mock("./assistantSessions", () => ({ readAssistantSession: source.session }));
import {
  assistantPresenceState,
  findAssistantApprovals,
  verifyAssistantApproval,
} from "./assistantBriefing";
import type { AssistantJob } from "../../../shared/model/host-contracts/assistant";
const job = {
  id: "job",
  goalId: "assistant-job",
  projectId: "project",
  title: "Retained work",
  status: "waiting",
  sessionIds: ["idle", "approval"],
} as AssistantJob;
let environmentId: string,
  plan: Record<string, unknown>,
  goal: Record<string, unknown>,
  session: Record<string, any>;
beforeEach(() => {
  environmentId = "host-original";
  plan = { tasks: [{ id: "one", title: "Original plan" }] };
  goal = {
    id: "assistant-job",
    projectIds: ["project"],
    status: "awaiting-approval",
    plan,
    updatedAt: 10,
  };
  session = {
    projectId: "project",
    status: "running",
    runId: "original-run",
    authorityGeneration: 2,
    session: {
      id: "approval",
      blocks: [
        { id: "block-one", approval: { requestId: 7, occurrenceId: "original-occurrence" } },
      ],
    },
  };
  source.request
    .mockReset()
    .mockImplementation(async (_cwd, _cap, method) =>
      method === "environment.describe" ? { environmentId } : [goal],
    );
  source.session
    .mockReset()
    .mockImplementation(async (id) =>
      id === "idle" ? { ...session, session: { id, blocks: [] } } : session,
    );
});
it("never resolves Goal or worker approval sources from quick jobs", async () => {
  const quick = {
    ...job,
    kind: "quick",
    projectId: null,
    projectIds: [],
    quickAction: { kind: "note", title: "Note", body: "Body" },
  } as any;
  expect((await findAssistantApprovals([quick])).targets).toEqual([]);
  expect(source.session).not.toHaveBeenCalled();
  await expect(
    verifyAssistantApproval(
      {
        kind: "goal",
        jobId: job.id,
        projectId: "project",
        goalId: job.goalId,
        environmentId,
        updatedAt: 10,
        planIdentity: JSON.stringify(plan),
        title: "Work",
      } as any,
      [quick],
    ),
  ).rejects.toThrow("linked job changed");
});
it("resolves the actual plan and pending provider source instead of assuming the first session needs approval", async () => {
  const result = await findAssistantApprovals([job]);
  expect(result.unavailable).toBe(0);
  expect(result.targets).toHaveLength(2);
  expect(result.targets[0]).toMatchObject({
    kind: "goal",
    environmentId,
    goalId: "assistant-job",
    projectId: "project",
  });
  expect(result.targets[1]).toMatchObject({
    kind: "session",
    sessionId: "approval",
    blockId: "block-one",
    requestId: 7,
    runId: "original-run",
  });
  expect(
    source.request.mock.calls.every((call) =>
      ["environment.describe", "goals.list"].includes(call[2]),
    ),
  ).toBe(true);
});
it("binds secondary workers and plan approvals to the complete saved job project set", async () => {
  const multi = { ...job, projectIds: ["project", "secondary"] };
  goal.projectIds = ["project", "secondary"];
  session.projectId = "secondary";
  const result = await findAssistantApprovals([multi]);
  expect(result.targets).toHaveLength(2);
  const planTarget = result.targets.find((target) => target.kind === "goal")!;
  const worker = result.targets.find((target) => target.kind === "session")!;
  expect(planTarget).toMatchObject({ projectId: "project", projectIds: ["project", "secondary"] });
  expect(worker.projectId).toBe("secondary");
  expect(source.session).toHaveBeenCalledWith(
    "approval",
    ["project", "secondary"],
    expect.objectContaining({ environmentId }),
  );
  await verifyAssistantApproval(worker, [multi]);
  await expect(verifyAssistantApproval(planTarget, [job])).rejects.toThrow("linked job changed");
  goal.projectIds = ["project", "secondary", "unreviewed"];
  expect(
    (await findAssistantApprovals([multi])).targets.some((target) => target.kind === "goal"),
  ).toBe(false);
});
it("keeps failed metadata reads unknown while retaining other verified targets", async () => {
  source.session.mockImplementation(async () => {
    throw new Error("offline");
  });
  const result = await findAssistantApprovals([job]);
  expect(result.targets).toHaveLength(1);
  expect(result.unavailable).toBe(2);
});
it("refuses changed Hosts, replaced approval occurrences, changed turns and changed plans even at the same timestamp", async () => {
  const { targets } = await findAssistantApprovals([job]);
  const provider = targets.find((target) => target.kind === "session")!;
  const goalTarget = targets[0];
  await expect(verifyAssistantApproval(provider, [job])).resolves.toBeUndefined();
  environmentId = "replacement";
  await expect(verifyAssistantApproval(provider, [job])).rejects.toThrow("Host changed");
  environmentId = "host-original";
  session.session.blocks[0].approval.occurrenceId = "replacement";
  await expect(verifyAssistantApproval(provider, [job])).rejects.toThrow("approval changed");
  session.session.blocks[0].approval.occurrenceId = "original-occurrence";
  session.runId = "replacement";
  await expect(verifyAssistantApproval(provider, [job])).rejects.toThrow("approval changed");
  goal.plan = { tasks: [{ id: "one", title: "Different plan" }] };
  await expect(verifyAssistantApproval(goalTarget, [job])).rejects.toThrow("plan changed");
});
it("reports stale, future, missing and unsupported activity as unknown while retaining the owner's Away and DND override", () => {
  const presence = { state: "present" as const, since: 0, updatedAt: 0 };
  const automaticPresence = {
    state: "present" as const,
    since: 0,
    updatedAt: 1000,
    supported: true,
  };
  expect(assistantPresenceState({ presence, automaticPresence }, 1001)).toMatchObject({
    detected: "present",
    effective: "present",
  });
  for (const automatic of [
    undefined,
    { ...automaticPresence, updatedAt: 100002 },
    { ...automaticPresence, updatedAt: 0 },
    { ...automaticPresence, supported: false },
  ])
    expect(
      assistantPresenceState({ presence, automaticPresence: automatic }, 100001).effective,
    ).toBe("unknown");
  expect(assistantPresenceState({ presence: { ...presence, state: "away" } }, 1001).effective).toBe(
    "away",
  );
  expect(
    assistantPresenceState({ presence: { ...presence, state: "dnd" }, automaticPresence }, 1001)
      .effective,
  ).toBe("dnd");
});
