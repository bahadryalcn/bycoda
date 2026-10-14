import { beforeEach, describe, expect, it, vi } from "vitest";
import { remoteRequest } from "../../connections/model/connections";
import { machineProjects } from "../../automations/model/machineSnapshot";
import { LOCAL_SYNC_MACHINE_NAME } from "../../connections/model/localSync";
import type { RemoteMachine } from "../../connections/model/protocol";
import type { HostSteward, HostStewardInput } from "./hostStewards";
import {
  boardStewardsFromHost,
  draftFromSteward,
  hostStewardFromDraft,
  isStewardProposal,
  newStewardDraft,
  runStewardNow,
  saveSteward,
  setStewardEnabled,
} from "./stewardClient";
import { TASK_AGENT_ERROR } from "./taskClient";

vi.mock("../../connections/model/connections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../connections/model/connections")>()),
  remoteRequest: vi.fn(),
}));
vi.mock("../../automations/model/machineSnapshot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../automations/model/machineSnapshot")>()),
  machineProjects: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(machineProjects).mockResolvedValue([]);
});

const mac: RemoteMachine = {
  id: "machine-mac",
  name: "MacBook",
  endpoint: "http://127.0.0.1:41000",
  environmentId: "env-mac",
  ssh: { target: "me@macbook", remotePort: 3774 },
};
const local: RemoteMachine = {
  id: "machine-local",
  name: LOCAL_SYNC_MACHINE_NAME,
  endpoint: "http://127.0.0.1:3774",
  environmentId: "env-local",
};

const stored: HostSteward = {
  id: "s1",
  projectId: "p-app",
  enabled: true,
  harness: "claude",
  model: "claude:test",
  modelSettings: { effort: "high" },
  runtimeMode: "auto",
  scheduleKind: "weekly",
  minute: 0,
  time: "10:30",
  dayOfWeek: 2,
  focus: "follow the roadmap",
  maxProposals: 3,
  maxOpen: 7,
  autoStart: false,
  nextRunAt: 5,
  declined: ["x"],
  createdAt: 1,
  updatedAt: 1,
};

describe("steward client", () => {
  it("shows a host steward on its machine, with its project", () => {
    const result = boardStewardsFromHost(
      mac,
      [{ id: "p-app", cwd: "/Users/me/app", name: "app" }],
      [stored, { ...stored, id: "s2", projectId: "p-gone" }],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "s1",
      machineId: "machine-mac",
      machineName: "MacBook",
      cwd: "remote://env-mac/Users/me/app",
    });
  });

  it("calls this computer by that name, with its plain path", () => {
    const [steward] = boardStewardsFromHost(
      local,
      [{ id: "p-app", cwd: "/work/app", name: "app" }],
      [stored],
    );
    expect(steward).toMatchObject({
      machineName: "this computer",
      cwd: "/work/app",
    });
  });

  it("turns a draft into what the host stores, and back", () => {
    const [steward] = boardStewardsFromHost(
      local,
      [{ id: "p-app", cwd: "/work/app", name: "app" }],
      [stored],
    );
    const draft = draftFromSteward(steward);
    expect(draft).toMatchObject({
      id: "s1",
      cwd: "/work/app",
      focus: "follow the roadmap",
      maxOpen: 7,
    });
    expect(hostStewardFromDraft({ ...draft, focus: "  new focus " }, "s1", "p-app")).toEqual({
      id: "s1",
      projectId: "p-app",
      enabled: true,
      harness: "claude",
      model: "claude:test",
      modelSettings: { effort: "high" },
      runtimeMode: "auto",
      scheduleKind: "weekly",
      minute: 0,
      time: "10:30",
      dayOfWeek: 2,
      focus: "new focus",
      maxProposals: 3,
      maxOpen: 7,
      autoStart: false,
    });
  });

  it("starts a new draft with auto-start off", () => {
    expect(newStewardDraft("/work/app", "claude", "claude:test")).toMatchObject({
      autoStart: false,
      enabled: true,
      maxProposals: 5,
      maxOpen: 10,
    });
  });

  it("refuses an agent that cannot run on a host", () => {
    expect(() =>
      hostStewardFromDraft(
        newStewardDraft("/work/app", "bogus" as never, "bogus:test"),
        "s1",
        "p-app",
      ),
    ).toThrow(TASK_AGENT_ERROR);
  });

  it("recognizes a declinable suggestion", () => {
    expect(isStewardProposal({ source: "steward", status: "todo" })).toBe(true);
    expect(isStewardProposal({ source: "steward", status: "queued" })).toBe(false);
    expect(isStewardProposal({ source: undefined, status: "todo" })).toBe(false);
    expect(isStewardProposal({ source: "goal", status: "todo" })).toBe(false);
  });
});

describe("merging automatically in the steward draft", () => {
  it("sends autoMerge only when asked for, and reads it back", () => {
    const draft = newStewardDraft("/work/app", "claude", "claude:test");
    expect(draft.autoMerge).toBe(false);
    expect(hostStewardFromDraft(draft, "s1", "p-app").autoMerge).toBeUndefined();
    expect(hostStewardFromDraft({ ...draft, autoMerge: true }, "s1", "p-app")).toMatchObject({
      autoMerge: true,
    });
    const [steward] = boardStewardsFromHost(
      local,
      [{ id: "p-app", cwd: "/work/app", name: "app" }],
      [{ ...stored, autoMerge: true }],
    );
    expect(draftFromSteward(steward).autoMerge).toBe(true);
  });
});

describe("confirmed steward mutation results", () => {
  it.each([
    { machine: local, hostCwd: "G:/app", cwd: "G:/app", machineName: "this computer" },
    {
      machine: mac,
      hostCwd: "/Users/me/app",
      cwd: "remote://env-mac/Users/me/app",
      machineName: "MacBook",
    },
  ])(
    "returns a saved steward on $machineName without a follow-up refresh",
    async ({ machine, hostCwd, cwd, machineName }) => {
      vi.mocked(machineProjects).mockResolvedValue([{ id: "p-app", cwd: hostCwd, name: "app" }]);
      vi.mocked(remoteRequest).mockImplementation(async (_machineId, method, params) => {
        if (method !== "stewards.save") throw new Error(`Unexpected refresh: ${method}`);
        return {
          ...stored,
          ...(params as { steward: HostStewardInput }).steward,
          nextRunAt: 30,
          updatedAt: 10,
        };
      });
      const saved = await saveSteward([local, mac], {
        ...newStewardDraft(cwd, "claude", "claude:test"),
        id: stored.id,
        focus: "  Finish the roadmap  ",
      });
      expect(saved).toMatchObject({
        id: stored.id,
        projectId: "p-app",
        cwd,
        machineId: machine.id,
        machineName,
        focus: "Finish the roadmap",
        nextRunAt: 30,
        updatedAt: 10,
      });
      expect(remoteRequest).toHaveBeenCalledWith(
        machine.id,
        "stewards.save",
        {
          steward: expect.objectContaining({
            id: stored.id,
            projectId: "p-app",
            focus: "Finish the roadmap",
          }),
        },
        false,
        true,
      );
      expect(remoteRequest).toHaveBeenCalledOnce();
    },
  );

  it.each(["run", "disable"] as const)(
    "returns confirmed %s state while clearing stale run/error fields",
    async (action) => {
      const [current] = boardStewardsFromHost(
        mac,
        [{ id: "p-app", cwd: "/Users/me/app", name: "app" }],
        [stored],
      );
      const old = {
        ...current,
        stale: true,
        lastRunError: "Old failure",
        run: { sessionId: "old", runId: "old-turn", startedAt: 1 },
      };
      const response: HostSteward = {
        ...stored,
        enabled: action === "run",
        updatedAt: 20,
        lastRunStatus: action === "run" ? "skipped" : "cancelled",
      };
      vi.mocked(remoteRequest).mockResolvedValue(response);
      const updated =
        action === "run" ? await runStewardNow(old) : await setStewardEnabled(old, false);
      expect(updated).toMatchObject({
        ...response,
        machineId: mac.id,
        machineName: mac.name,
        cwd: current.cwd,
      });
      expect(updated.stale).toBeUndefined();
      expect(updated).not.toHaveProperty("run");
      expect(updated).not.toHaveProperty("lastRunError");
      expect(remoteRequest).toHaveBeenCalledWith(
        mac.id,
        action === "run" ? "stewards.runNow" : "stewards.save",
        action === "run"
          ? { stewardId: stored.id }
          : {
              steward: hostStewardFromDraft(
                { ...draftFromSteward(old), enabled: false },
                stored.id,
                stored.projectId,
              ),
            },
        false,
        true,
      );
      expect(remoteRequest).toHaveBeenCalledOnce();
      expect(machineProjects).not.toHaveBeenCalled();
      expect(old.run.sessionId).toBe("old");
    },
  );

  it("propagates mutation failures without fabricating an updated steward", async () => {
    const [current] = boardStewardsFromHost(
      mac,
      [{ id: "p-app", cwd: "/Users/me/app", name: "app" }],
      [stored],
    );
    vi.mocked(remoteRequest).mockRejectedValue(new Error("Host unavailable"));
    await expect(setStewardEnabled(current, false)).rejects.toThrow("Host unavailable");
    expect(current.enabled).toBe(true);
  });
});
