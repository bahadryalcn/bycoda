import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, remoteRequest, backgroundMachineFor, hostProjectFor, machineCapabilities } =
  vi.hoisted(() => ({
    invoke: vi.fn(),
    remoteRequest: vi.fn(),
    backgroundMachineFor: vi.fn(),
    hostProjectFor: vi.fn(),
    machineCapabilities: vi.fn(),
  }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../connections/model/connections", () => ({ remoteRequest }));
vi.mock("../connections/model/remoteHealth", () => ({
  subscribeRemoteRecovered: () => () => undefined,
}));
vi.mock("../automations/model/hostAutomationClient", () => ({
  backgroundMachineFor,
  hostProjectFor,
}));
vi.mock("../automations/model/machineSnapshot", () => ({ machineCapabilities }));
import { hostFeatureRequest, invalidateFeatureHosts } from "../connections/model/hostFeatureClient";

describe("development server machine routing", () => {
  const local = { id: "local", name: "Windows", endpoint: "http://127.0.0.1:3776" };
  const remote = { id: "mac", name: "Mac", environmentId: "remote-env", endpoint: "ssh://mac" };
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateFeatureHosts();
    invoke.mockImplementation(async (command: string) =>
      command === "remote_machines" ? [local, remote] : local,
    );
    backgroundMachineFor.mockReturnValue(remote);
    hostProjectFor.mockImplementation(async (machine) => ({ id: `${machine.id}-project` }));
    machineCapabilities.mockResolvedValue(["dev.servers", "browser.shared"]);
    remoteRequest.mockResolvedValue({ status: "ok", servers: [] });
  });
  it.each(["list", "details", "start", "stop", "kill", "restart", "logs", "openExternal"])(
    "routes %s to the selected remote host and registered project",
    async (operation) => {
      await hostFeatureRequest(
        "remote://remote-env/Users/owner/app",
        "dev.servers",
        `devServers.${operation}`,
        { id: "server", projectId: "wrong" },
      );
      expect(remoteRequest).toHaveBeenCalledWith("mac", `devServers.${operation}`, {
        id: "server",
        projectId: "mac-project",
      });
      expect(invoke).not.toHaveBeenCalledWith("local_host_connect");
    },
  );
  it("keeps preview on the same remote host", async () => {
    await hostFeatureRequest(
      "remote://remote-env/Users/owner/app",
      "browser.shared",
      "browser.open",
      { url: "http://localhost:5173" },
    );
    expect(remoteRequest).toHaveBeenCalledWith("mac", "browser.open", {
      url: "http://localhost:5173",
      projectId: "mac-project",
    });
  });
  it("never falls back to local discovery if the remote host is unavailable", async () => {
    backgroundMachineFor.mockReturnValue(undefined);
    await expect(
      hostFeatureRequest("remote://remote-env/Users/owner/app", "dev.servers", "devServers.list"),
    ).rejects.toThrow("not connected");
    expect(remoteRequest).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("local_host_connect");
  });
  it("requires the dev-server capability before sending a destructive request", async () => {
    machineCapabilities.mockResolvedValue(["browser.shared"]);
    await expect(
      hostFeatureRequest("remote://remote-env/Users/owner/app", "dev.servers", "devServers.kill"),
    ).rejects.toThrow("Update bycoda Host");
    expect(remoteRequest).not.toHaveBeenCalled();
  });
  it("uses this computer's current host for a local project", async () => {
    await hostFeatureRequest("G:/app", "dev.servers", "devServers.list");
    expect(remoteRequest).toHaveBeenCalledWith("local", "devServers.list", {
      projectId: "local-project",
    });
  });
});
