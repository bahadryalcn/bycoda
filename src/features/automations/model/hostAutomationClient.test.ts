import { describe, expect, it } from "vitest";
import { LOCAL_SYNC_MACHINE_NAME } from "../../connections/model/localSync";
import type { RemoteMachine } from "../../connections/model/protocol";
import { draftFromAutomation, newAutomationDraft } from "./automations";
import {
  BACKGROUND_TRIGGER_ERROR,
  automationFromHost,
  backgroundMachineFor,
  hostAutomationFromDraft,
  hostProjectCwd,
} from "./hostAutomationClient";
import type { HostAutomation } from "./hostAutomations";
import { createAutomationTrigger } from "./automations";

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

const stored: HostAutomation = {
  id: "nightly",
  name: "Nightly audit",
  prompt: "Review the repository",
  projectId: "project-1",
  harness: "claude",
  model: "claude:test",
  modelSettings: {},
  runtimeMode: "auto",
  scheduleKind: "daily",
  minute: 0,
  time: "02:30",
  dayOfWeek: 1,
  maxRunMinutes: 60,
  maxRunsPerDay: 2,
  enabled: true,
  nextRunAt: 10,
  lastRunStatus: "succeeded",
  createdAt: 1,
  updatedAt: 2,
};

describe("background automations", () => {
  it("runs a remote project on its own machine and a local one on this computer", () => {
    expect(backgroundMachineFor([mac, local], "remote://env-mac/Users/me/app")).toBe(mac);
    expect(backgroundMachineFor([mac, local], "G:/Projects/app")).toBe(local);
    expect(backgroundMachineFor([mac], "G:/Projects/app")).toBeUndefined();
    expect(backgroundMachineFor([local], "remote://env-mac/Users/me/app")).toBeUndefined();
  });

  it("addresses a host project as a remote path unless the host is this computer", () => {
    const project = { id: "project-1", cwd: "/Users/me/app", name: "app" };
    expect(hostProjectCwd(mac, project)).toBe("remote://env-mac/Users/me/app");
    expect(hostProjectCwd(local, { ...project, cwd: "G:/Projects/app" })).toBe("G:/Projects/app");
  });

  it("shows a host automation as a single time trigger on its machine", () => {
    const automation = automationFromHost(mac, "remote://env-mac/Users/me/app", stored);
    expect(automation).toMatchObject({
      id: "nightly",
      cwd: "remote://env-mac/Users/me/app",
      triggerKind: "time",
      scheduleKind: "daily",
      time: "02:30",
      maxRunMinutes: 60,
      lastRunStatus: "succeeded",
      host: {
        machineId: "machine-mac",
        machineName: "MacBook",
        projectId: "project-1",
      },
    });
    expect(automation.triggers).toHaveLength(1);
    expect(automationFromHost(local, "G:/app", stored).host?.machineName).toBe("this computer");
  });

  it("round-trips a host automation through the editor draft", () => {
    const draft = draftFromAutomation(
      automationFromHost(mac, "remote://env-mac/Users/me/app", stored),
    );
    expect(draft.runInBackground).toBe(true);
    const { nextRunAt, lastRunStatus, createdAt, updatedAt, ...input } = stored;
    expect(hostAutomationFromDraft(draft, "nightly", "project-1")).toEqual(input);
  });

  it("refuses event triggers and more than one schedule", () => {
    const draft = newAutomationDraft("G:/app", "claude", "claude:test");
    expect(() => hostAutomationFromDraft(draft, "id", "project-1")).toThrow(
      BACKGROUND_TRIGGER_ERROR,
    );
    const time = createAutomationTrigger("time", "daily");
    expect(() =>
      hostAutomationFromDraft(
        { ...draft, triggers: [time, createAutomationTrigger("time", "hourly")] },
        "id",
        "project-1",
      ),
    ).toThrow(BACKGROUND_TRIGGER_ERROR);
    expect(() =>
      hostAutomationFromDraft(
        {
          ...draft,
          triggers: [createAutomationTrigger("github", "pull_request_opened")],
        },
        "id",
        "project-1",
      ),
    ).toThrow(BACKGROUND_TRIGGER_ERROR);
  });
});
