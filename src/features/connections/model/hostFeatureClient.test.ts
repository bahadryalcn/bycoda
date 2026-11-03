import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const remoteRequest = vi.fn();
const machineCapabilities = vi.fn();
const hostProjectFor = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("./connections", () => ({ remoteRequest: (...args: unknown[]) => remoteRequest(...args) }));
vi.mock("./remoteHealth", () => ({ subscribeRemoteRecovered: () => () => undefined }));
vi.mock("../../automations/model/machineSnapshot", () => ({
  machineCapabilities: (...args: unknown[]) => machineCapabilities(...args),
}));
vi.mock("../../automations/model/hostAutomationClient", () => ({
  backgroundMachineFor: (machines: { environmentId: string }[], cwd: string) =>
    machines.find((machine) => cwd.startsWith(`remote://${machine.environmentId}/`)),
  hostProjectFor: (...args: unknown[]) => hostProjectFor(...args),
}));

import {
  hostFeatureRequest,
  hostToolRequest,
  invalidateFeatureHosts,
  listHostToolMachines,
} from "./hostFeatureClient";
import type { RemoteMachine } from "./protocol";

describe("hostFeatureRequest", () => {
  beforeEach(() => {
    invalidateFeatureHosts();
    invoke.mockReset();
    remoteRequest.mockReset();
    machineCapabilities.mockReset().mockResolvedValue(["dev.servers"]);
    hostProjectFor.mockReset().mockResolvedValue({ id: "project-1" });
    invoke.mockImplementation(async (command: string) =>
      command === "remote_machines"
        ? []
        : { id: "local", endpoint: "http://127.0.0.1:1", name: "local" },
    );
    remoteRequest.mockResolvedValue([]);
  });

  it("starts the local host launcher once per project", async () => {
    await Promise.all([
      hostFeatureRequest("/repo", "dev.servers", "devServers.list"),
      hostFeatureRequest("/repo", "dev.servers", "devServers.list"),
    ]);
    await hostFeatureRequest("/repo", "dev.servers", "devServers.list");
    expect(invoke.mock.calls.filter(([command]) => command === "local_host_connect")).toHaveLength(
      1,
    );
    expect(remoteRequest).toHaveBeenCalledWith("local", "devServers.list", {
      projectId: "project-1",
    });
  });

  it("resolves again after a failed request", async () => {
    remoteRequest.mockRejectedValueOnce(new Error("gone"));
    await expect(hostFeatureRequest("/repo", "dev.servers", "devServers.list")).rejects.toThrow(
      "gone",
    );
    await hostFeatureRequest("/repo", "dev.servers", "devServers.list");
    expect(invoke.mock.calls.filter(([command]) => command === "local_host_connect")).toHaveLength(
      2,
    );
  });

  it("uses the host now running on this computer before an older saved local link", async () => {
    invoke.mockImplementation(async (command: string) =>
      command === "remote_machines"
        ? [{ id: "legacy", endpoint: "http://127.0.0.1:3774", name: "local" }]
        : { id: "current", endpoint: "http://127.0.0.1:3776", name: "local" },
    );
    await hostFeatureRequest("/repo", "dev.servers", "devServers.list");
    expect(remoteRequest).toHaveBeenCalledWith("current", "devServers.list", {
      projectId: "project-1",
    });
  });

  it("rejects tools the host does not offer", async () => {
    await expect(hostFeatureRequest("/repo", "device.host", "devices.status")).rejects.toThrow(
      "Update",
    );
  });
});

describe("explicit host tool targets", () => {
  const local: RemoteMachine = {
    id: "local",
    name: "Desktop",
    environmentId: "local-env",
    endpoint: "http://127.0.0.1:3776",
    localHost: true,
  };
  const mac: RemoteMachine = {
    id: "mac",
    name: "MacBook",
    environmentId: "mac-env",
    endpoint: "https://mac.example",
  };
  beforeEach(() => {
    invalidateFeatureHosts();
    invoke
      .mockReset()
      .mockImplementation(async (command: string) =>
        command === "local_host_connect" ? local : [local, mac],
      );
    remoteRequest.mockReset().mockResolvedValue({ ok: true });
    machineCapabilities
      .mockReset()
      .mockResolvedValue([
        "dev.servers",
        "device.host",
        "browser.shared",
        "browser.shared.setup",
        "browser.annotation",
        "resources.diagnostics",
        "host.tools.machine-targets",
      ]);
    hostProjectFor.mockReset().mockResolvedValue({ id: "owning-project" });
  });

  it("keeps default requests on the conversation's owning project", async () => {
    await hostToolRequest("remote://mac-env/Users/user/repo", "device.host", "devices.status", {
      sessionId: "mac-session",
    });
    expect(hostProjectFor).toHaveBeenCalledWith(mac, "remote://mac-env/Users/user/repo");
    expect(remoteRequest).toHaveBeenCalledWith("mac", "devices.status", {
      projectId: "owning-project",
      sessionId: "mac-session",
    });
    expect(invoke).not.toHaveBeenCalledWith("local_host_connect");
  });
  it("routes only the exact assistant and desktop owner methods with their advertised capability", async () => {
    machineCapabilities.mockResolvedValue(["assistant.v1", "desktop.control.v1"]);
    for (const [capability, method, params] of [
      ["assistant.v1", "assistant.request", { op: "threads.open", projectId: "canonical-remote" }],
      ["desktop.control.v1", "desktop.request", { op: "status" }],
      ["desktop.control.v1", "desktop.helper.request", { op: "status" }],
    ] as const) {
      await hostToolRequest("", capability, method, params, { kind: "local" });
      expect(remoteRequest).toHaveBeenLastCalledWith(
        "local",
        method,
        params,
        false,
        false,
        "local-env",
      );
    }
    expect(hostProjectFor).not.toHaveBeenCalled();
    await expect(
      hostToolRequest(
        "",
        "browser.shared",
        "assistant.request",
        { op: "snapshot" },
        { kind: "local" },
      ),
    ).rejects.toThrow("explicit computer and capability");
    await expect(
      hostToolRequest("", "assistant.v1", "assistant.request", {}, { kind: "project" }),
    ).rejects.toThrow("explicit computer and capability");
    await expect(
      hostToolRequest("", "assistant.v1", "assistant.request.unsafe", {}, { kind: "local" }),
    ).rejects.toThrow("cannot use another computer");
  });
  it("pins remote assistant IDs to the captured environment and refuses changed routes before disclosure", async () => {
    machineCapabilities.mockResolvedValue(["assistant.v1"]);
    const request = {
      op: "threads.append",
      threadId: "remote-thread",
      sessionId: "actual-remote",
      idempotencyKey: "original-id",
      text: "accepted speech",
    };
    await hostToolRequest(
      "",
      "assistant.v1",
      "assistant.request",
      request,
      { kind: "machine", machineId: "mac" },
      "mac-env",
    );
    expect(remoteRequest).toHaveBeenCalledWith(
      "mac",
      "assistant.request",
      request,
      false,
      false,
      "mac-env",
    );
    await expect(
      hostToolRequest(
        "",
        "assistant.v1",
        "assistant.request",
        request,
        { kind: "machine", machineId: "mac" },
        "other-env",
      ),
    ).rejects.toThrow("captured Host");
    remoteRequest.mockImplementationOnce(async () => {
      invoke.mockResolvedValue([local, { ...mac, environmentId: "replaced" }]);
      return { ok: true };
    });
    await expect(
      hostToolRequest(
        "",
        "assistant.v1",
        "assistant.request",
        request,
        { kind: "machine", machineId: "mac" },
        "mac-env",
      ),
    ).rejects.toThrow("captured Host");
    expect(hostProjectFor).not.toHaveBeenCalled();
  });
  it("checks owner capability and captured machine again before any delayed dispatch", async () => {
    let release!: (value: string[]) => void;
    machineCapabilities.mockImplementationOnce(() => new Promise((done) => (release = done)));
    const pending = hostToolRequest(
      "",
      "assistant.v1",
      "assistant.request",
      { op: "threads.open", projectId: "original" },
      { kind: "machine", machineId: "mac" },
      "mac-env",
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    invoke.mockResolvedValue([local, { ...mac, environmentId: "new-environment" }]);
    release(["assistant.v1"]);
    await expect(pending).rejects.toThrow("captured Host");
    expect(remoteRequest).not.toHaveBeenCalled();
    invalidateFeatureHosts();
    invoke.mockResolvedValue([local, mac]);
    machineCapabilities.mockResolvedValue([]);
    for (const [capability, method] of [
      ["assistant.v1", "assistant.request"],
      ["desktop.control.v1", "desktop.request"],
      ["desktop.control.v1", "desktop.helper.request"],
    ])
      await expect(
        hostToolRequest("", capability, method, {}, { kind: "machine", machineId: "mac" }),
      ).rejects.toThrow("Update");
    expect(remoteRequest).not.toHaveBeenCalled();
  });

  it("uses this computer for a remote conversation without registering its directory", async () => {
    await Promise.all([
      hostToolRequest(
        "remote://mac-env/Users/user/repo",
        "device.host",
        "devices.status",
        {
          projectId: "mac-project",
          sessionId: "mac-session",
        },
        { kind: "local" },
      ),
      hostToolRequest(
        "remote://mac-env/Users/user/repo",
        "resources.diagnostics",
        "resources.read",
        {},
        { kind: "local" },
      ),
    ]);
    expect(invoke.mock.calls.filter(([method]) => method === "local_host_connect")).toHaveLength(1);
    expect(hostProjectFor).not.toHaveBeenCalled();
    expect(remoteRequest).toHaveBeenCalledWith("local", "devices.status", {});
    expect(remoteRequest).toHaveBeenCalledWith("local", "resources.read", {});
  });

  it("runs realtime and cloud voice requests on this computer", async () => {
    machineCapabilities.mockResolvedValue(["voice.realtime.v2", "voice.cloud.v1"]);
    await hostToolRequest(
      "G:/repo",
      "voice.realtime.v2",
      "voice.realtime.secret",
      { provider: "openai" },
      { kind: "local" },
    );
    await hostToolRequest("G:/repo", "voice.cloud.v1", "voice.cloud.status", {}, { kind: "local" });
    expect(remoteRequest).toHaveBeenCalledWith("local", "voice.realtime.secret", {
      provider: "openai",
    });
    expect(remoteRequest).toHaveBeenCalledWith("local", "voice.cloud.status", {});
  });

  it("uses the selected MacBook for a local conversation and omits foreign project/session IDs", async () => {
    await hostToolRequest(
      "G:/repo",
      "device.host",
      "devices.boot",
      {
        projectId: "windows-project",
        sessionId: "windows-session",
        deviceId: "ios-simulator",
      },
      { kind: "machine", machineId: "mac" },
    );
    expect(remoteRequest).toHaveBeenCalledWith("mac", "devices.boot", {
      deviceId: "ios-simulator",
    });
    expect(hostProjectFor).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("local_host_connect");
  });

  it("never falls back when the selected computer was removed or the local host fails", async () => {
    await expect(
      hostToolRequest(
        "G:/repo",
        "device.host",
        "devices.status",
        {},
        {
          kind: "machine",
          machineId: "removed",
        },
      ),
    ).rejects.toThrow("no longer connected");
    expect(invoke).not.toHaveBeenCalledWith("local_host_connect");
    invoke.mockImplementation(async () => {
      throw new Error("local launcher failed");
    });
    await expect(
      hostToolRequest(
        "remote://mac-env/repo",
        "device.host",
        "devices.status",
        {},
        {
          kind: "local",
        },
      ),
    ).rejects.toThrow("local launcher failed");
    expect(remoteRequest).not.toHaveBeenCalled();
    expect(hostProjectFor).not.toHaveBeenCalled();
  });

  it("re-resolves a failed explicit host without choosing this computer", async () => {
    const target = { kind: "machine", machineId: "mac" } as const;
    remoteRequest.mockRejectedValueOnce(new Error("Mac offline"));
    await expect(
      hostToolRequest("G:/repo", "browser.shared", "browser.status", {}, target),
    ).rejects.toThrow("Mac offline");
    await hostToolRequest("G:/repo", "browser.shared", "browser.status", {}, target);
    expect(invoke.mock.calls.filter(([method]) => method === "remote_machines")).toHaveLength(2);
    expect(invoke).not.toHaveBeenCalledWith("local_host_connect");
    expect(remoteRequest.mock.calls.map(([id]) => id)).toEqual(["mac", "mac"]);
  });

  it("requires machine-target support for projectless device and browser setup operations", async () => {
    machineCapabilities.mockResolvedValue([
      "device.host",
      "browser.shared",
      "browser.shared.setup",
      "resources.diagnostics",
    ]);
    for (const [capability, method] of [
      ["device.host", "devices.status"],
      ["browser.shared.setup", "browser.setup"],
    ]) {
      await expect(
        hostToolRequest(
          "G:/repo",
          capability,
          method,
          {},
          {
            kind: "machine",
            machineId: "mac",
          },
        ),
      ).rejects.toThrow("Update");
    }
    expect(remoteRequest).not.toHaveBeenCalled();
    await hostToolRequest(
      "G:/repo",
      "browser.shared",
      "browser.status",
      {},
      { kind: "machine", machineId: "mac" },
    );
    await hostToolRequest(
      "G:/repo",
      "resources.diagnostics",
      "resources.read",
      {},
      { kind: "machine", machineId: "mac" },
    );
    expect(remoteRequest).toHaveBeenCalledWith("mac", "browser.status", {});
    expect(remoteRequest).toHaveBeenCalledWith("mac", "resources.read", {});
  });

  it("does not retarget project tools or authorize unknown host methods", async () => {
    for (const method of ["devServers.list", "browser.execute", "devices.exec"]) {
      await expect(
        hostToolRequest(
          "G:/repo",
          "dev.servers",
          method,
          {},
          {
            kind: "machine",
            machineId: "mac",
          },
        ),
      ).rejects.toThrow("follows the conversation's project");
    }
    expect(invoke).not.toHaveBeenCalled();
    expect(remoteRequest).not.toHaveBeenCalled();
  });

  it("routes log reads to the selected machine without foreign conversation identity", async () => {
    machineCapabilities.mockResolvedValue(["runtime.logs"]);
    invoke.mockResolvedValue([
      { id: "mac", name: "Mac", environmentId: "mac-env", endpoint: "ssh://mac" },
    ]);
    await hostToolRequest(
      "G:/repo",
      "runtime.logs",
      "runtimeLogs.read",
      {
        projectId: "windows-project",
        sessionId: "windows-session",
        after: 12,
        limit: 100,
      },
      { kind: "machine", machineId: "mac" },
    );
    expect(remoteRequest).toHaveBeenCalledWith("mac", "runtimeLogs.read", {
      after: 12,
      limit: 100,
    });
    expect(hostProjectFor).not.toHaveBeenCalled();
  });

  it("keeps browser annotations bound to the owning project", async () => {
    await expect(
      hostToolRequest(
        "G:/repo",
        "browser.annotation",
        "browser.annotation.start",
        {
          sessionId: "windows-session",
        },
        { kind: "machine", machineId: "mac" },
      ),
    ).rejects.toThrow("only on this project's computer");
    expect(hostProjectFor).not.toHaveBeenCalled();
    expect(remoteRequest).not.toHaveBeenCalled();
    await hostToolRequest(
      "remote://mac-env/Users/user/repo",
      "browser.annotation",
      "browser.annotation.start",
      {
        sessionId: "mac-session",
      },
      { kind: "machine", machineId: "mac" },
    );
    expect(remoteRequest).toHaveBeenCalledWith("mac", "browser.annotation.start", {
      projectId: "owning-project",
      sessionId: "mac-session",
    });
  });

  it("discovers this computer and remote machines without opening conversation projects", async () => {
    invoke.mockImplementation(async (command: string) =>
      command === "local_host_connect"
        ? local
        : [
            { ...local, id: "old-local", endpoint: "http://127.0.0.1:3774" },
            local,
            mac,
            { ...mac, id: "mac-alternate" },
          ],
    );
    expect(await listHostToolMachines()).toEqual([local, mac]);
    expect(hostProjectFor).not.toHaveBeenCalled();
    expect(remoteRequest).not.toHaveBeenCalled();
  });
});
