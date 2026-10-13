import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_SYNC_MACHINE_NAME } from "../../connections/model/localSync";
import type { RemoteMachine } from "../../connections/model/protocol";
import {
  DEFAULT_HOST_SETTINGS,
  formatAgentMinutes,
  parseHostSettings,
  parseHostSettingsState,
} from "./hostSettings";
import { autoMergeBlocker, NO_CHECKS_NOTE, parseHostTask } from "./hostTasks";
import { parseHostGoal } from "./hostGoals";
import { parseHostSteward } from "./hostStewards";
import { dailyLimitNotice, listMachineLimits, saveMachineLimits } from "./settingsClient";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));

const local: RemoteMachine = {
  id: "machine-local",
  name: LOCAL_SYNC_MACHINE_NAME,
  endpoint: "http://127.0.0.1:3774",
  environmentId: "env-local",
};
const mac: RemoteMachine = {
  id: "machine-mac",
  name: "MacBook",
  endpoint: "http://127.0.0.1:41000",
  environmentId: "env-mac",
  ssh: { target: "me@macbook", remotePort: 3774 },
};

describe("host settings", () => {
  it("accepts 1 to 8 tasks and custom daily minutes, keeping what is not sent", () => {
    expect(parseHostSettings({ maxRunningTasks: 8, dailyAgentMinutes: 1440 })).toEqual({
      maxRunningTasks: 8,
      dailyAgentMinutes: 1440,
    });
    expect(parseHostSettings({ dailyAgentMinutes: 60 })).toEqual({
      maxRunningTasks: DEFAULT_HOST_SETTINGS.maxRunningTasks,
      dailyAgentMinutes: 60,
    });
    for (const bad of [
      { maxRunningTasks: 0 },
      { maxRunningTasks: 9 },
      { maxRunningTasks: 2.5 },
      { dailyAgentMinutes: -5 },
      { dailyAgentMinutes: Number.MAX_SAFE_INTEGER + 1 },
      { dailyAgentMinutes: 2.5 },
      { dailyAgentMinutes: "60" },
    ])
      expect(() => parseHostSettings(bad)).toThrow();
    expect(() => parseHostSettings([])).toThrow("Invalid settings");
    expect(parseHostSettings({ dailyAgentMinutes: 2880 }).dailyAgentMinutes).toBe(2880);
  });

  it("reads a host reply, and refuses anything else", () => {
    expect(
      parseHostSettingsState({
        maxRunningTasks: 3,
        dailyAgentMinutes: 120,
        usedMinutes: 12.5,
        limitReached: false,
      }),
    ).toEqual({
      maxRunningTasks: 3,
      dailyAgentMinutes: 120,
      usedMinutes: 12.5,
      limitReached: false,
    });
    expect(parseHostSettingsState({})).toBeNull();
    expect(parseHostSettingsState(null)).toBeNull();
    expect(parseHostSettingsState({ maxRunningTasks: 99, usedMinutes: 1 })).toBeNull();
  });

  it("formats minutes as hours and minutes", () => {
    expect(formatAgentMinutes(0)).toBe("0m");
    expect(formatAgentMinutes(40.9)).toBe("40m");
    expect(formatAgentMinutes(75)).toBe("1h 15m");
    expect(formatAgentMinutes(120)).toBe("2h 0m");
  });
});

describe("merging automatically", () => {
  const base = {
    id: "t",
    title: "T",
    prompt: "P",
    projectId: "p",
    harness: "claude",
    model: "claude:test",
    runtimeMode: "auto",
  };

  it("parses autoMerge on tasks, goals and stewards, off when absent", () => {
    expect(parseHostTask({ ...base, autoMerge: true }).autoMerge).toBe(true);
    expect(parseHostTask(base).autoMerge).toBeUndefined();
    expect(parseHostTask({ ...base, autoMerge: false }).autoMerge).toBeUndefined();
    expect(() => parseHostTask({ ...base, autoMerge: 1 })).toThrow("Invalid task options");
    const goal = {
      id: "g",
      title: "G",
      prompt: "P",
      projectIds: ["p"],
      leadProjectId: "p",
      harness: "claude",
      model: "claude:test",
      runtimeMode: "auto",
    };
    expect(parseHostGoal({ ...goal, autoMerge: true }).autoMerge).toBe(true);
    expect(parseHostGoal(goal).autoMerge).toBeUndefined();
    expect(() => parseHostGoal({ ...goal, autoMerge: "yes" })).toThrow("Invalid goal options");
    const steward = {
      id: "s",
      projectId: "p",
      harness: "claude",
      model: "claude:test",
      runtimeMode: "auto",
      scheduleKind: "daily",
      time: "09:00",
    };
    expect(parseHostSteward({ ...steward, autoMerge: true }).autoMerge).toBe(true);
    expect(parseHostSteward(steward).autoMerge).toBeUndefined();
    expect(() => parseHostSteward({ ...steward, autoMerge: 0 })).toThrow("Invalid steward options");
  });

  it("merges only when a check was configured and every configured one passed", () => {
    const passed = {
      command: { exitCode: 0, output: "", timedOut: false },
      review: { verdict: "pass" as const, note: "", sessionId: "s" },
    };
    expect(autoMergeBlocker({ review: false })).toBe(NO_CHECKS_NOTE);
    expect(
      autoMergeBlocker({
        review: false,
        verifyCommand: "npm test",
        verification: { command: passed.command },
      }),
    ).toBeUndefined();
    expect(
      autoMergeBlocker({ review: true, verification: { review: passed.review } }),
    ).toBeUndefined();
    expect(
      autoMergeBlocker({ review: true, verifyCommand: "npm test", verification: passed }),
    ).toBeUndefined();
    // A configured check with no passing result holds the merge back.
    expect(autoMergeBlocker({ review: true, verifyCommand: "npm test" })).toMatch(
      /^Not merged automatically/,
    );
    expect(
      autoMergeBlocker({
        review: true,
        verification: { review: { ...passed.review, verdict: "fail" } },
      }),
    ).toMatch(/^Not merged automatically/);
    expect(
      autoMergeBlocker({
        review: false,
        verifyCommand: "npm test",
        verification: { command: { exitCode: 1, output: "", timedOut: false } },
      }),
    ).toMatch(/^Not merged automatically/);
  });
});

describe("limits client", () => {
  beforeEach(() => invoke.mockReset());

  const answers: Record<string, unknown> = {
    "machine-local": {
      maxRunningTasks: 2,
      dailyAgentMinutes: 60,
      usedMinutes: 60,
      limitReached: true,
    },
    "machine-mac": {
      maxRunningTasks: 4,
      dailyAgentMinutes: 0,
      usedMinutes: 5,
      limitReached: false,
    },
  };

  it("lists the machines that answer, naming this computer", async () => {
    invoke.mockImplementation(async (command: string, args: any) => {
      if (command !== "remote_request") return null;
      if (args.machineId === "machine-mac" && args.method === "host.settings.get")
        throw new Error("offline");
      return answers[args.machineId];
    });
    const limits = await listMachineLimits([local, mac]);
    expect(limits).toEqual([
      expect.objectContaining({
        machineId: "machine-local",
        machineName: "this computer",
        usedMinutes: 60,
        limitReached: true,
      }),
    ]);
  });

  it("saves the fields given and returns the machine's new limits", async () => {
    invoke.mockImplementation(async () => answers["machine-mac"]);
    const saved = await saveMachineLimits(mac, { maxRunningTasks: 4 });
    expect(invoke).toHaveBeenCalledWith(
      "remote_request",
      expect.objectContaining({
        machineId: "machine-mac",
        method: "host.settings.save",
        params: { settings: { maxRunningTasks: 4 } },
      }),
    );
    expect(saved).toMatchObject({ machineName: "MacBook", maxRunningTasks: 4 });
  });

  it("words the daily notice for each machine that used its time up", () => {
    expect(
      dailyLimitNotice([
        { machineName: "this computer", limitReached: false },
        { machineName: "MacBook", limitReached: true },
      ]),
    ).toBe("Daily agent time on MacBook is used up; queued work resumes tomorrow.");
    expect(dailyLimitNotice([{ machineName: "MacBook", limitReached: false }])).toBeNull();
    expect(dailyLimitNotice([])).toBeNull();
  });
});
