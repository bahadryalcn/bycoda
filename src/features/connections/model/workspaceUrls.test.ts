import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, openUrl, featureHost, remoteRequest, openHostToolsWindow } = vi.hoisted(() => ({
  invoke: vi.fn(),
  openUrl: vi.fn(),
  featureHost: vi.fn(),
  remoteRequest: vi.fn(),
  openHostToolsWindow: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("./hostFeatureClient", () => ({ featureHost }));
vi.mock("./connections", () => ({ remoteRequest }));
vi.mock("../../host-tools/ToolsWorkspace", () => ({ openHostToolsWindow }));
import { accessibleDevelopmentUrl, isHostDevelopmentUrl, openWorkspaceUrl } from "./workspaceUrls";

const cwd = "remote://owner/home/me/app";
const endpoint = { port: 5173, address: "0.0.0.0", url: "http://127.0.0.1:5173" };
const server = {
  id: "server",
  projectId: "project",
  association: "cwd",
  managed: false,
  state: "running",
  name: "vite",
  logsAvailable: false,
  process: { pid: 51, startedAt: "birth", name: "node" },
  endpoints: [endpoint],
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  featureHost.mockResolvedValue({
    machine: { id: "mac", environmentId: "owner" },
    projectId: "project",
  });
  remoteRequest.mockResolvedValue({ status: "ok", servers: [server] });
  invoke.mockResolvedValue("http://127.0.0.1:49123/nested?x=1#here");
  openUrl.mockResolvedValue(undefined);
});

describe("workspace development URLs", () => {
  it.each([
    "localhost",
    "127.0.0.1",
    "127.2.3.4",
    "0.0.0.0",
    "[::1]",
    "[::]",
    "10.0.0.8",
    "100.97.82.8",
    "192.168.2.5",
  ])("identifies the owning host's %s URL", (host) => {
    expect(isHostDevelopmentUrl(`http://${host}:5173/`)).toBe(true);
  });

  it("opens remote loopback through the exact owning machine and preserves the destination", async () => {
    await openWorkspaceUrl(cwd, "http://localhost:5173/nested?x=1#here");
    expect(featureHost).toHaveBeenCalledWith(cwd, "dev.servers.private-access");
    expect(remoteRequest).toHaveBeenCalledWith("mac", "devServers.list", { projectId: "project" });
    expect(invoke).toHaveBeenCalledWith("remote_dev_server_url", {
      machineId: "mac",
      environmentId: "owner",
      projectId: "project",
      serverId: "server",
      identity: { pid: 51, startedAt: "birth" },
      port: 5173,
      address: "0.0.0.0",
      url: "http://localhost:5173/nested?x=1#here",
    });
    expect(openUrl).toHaveBeenCalledWith("http://127.0.0.1:49123/nested?x=1#here");
  });

  it("never opens a local fallback when the owning computer is disconnected", async () => {
    featureHost.mockRejectedValue(new Error("Owner disconnected"));
    await expect(openWorkspaceUrl(cwd, "http://localhost:5173")).rejects.toThrow(
      "Owner disconnected",
    );
    expect(openUrl).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects another project's server and ambiguous process ownership", async () => {
    remoteRequest.mockResolvedValue({
      status: "ok",
      servers: [{ ...server, projectId: "elsewhere" }],
    });
    await expect(accessibleDevelopmentUrl(cwd, endpoint.url)).rejects.toThrow(
      "No running development server",
    );
    remoteRequest.mockResolvedValue({
      status: "ok",
      servers: [server, { ...server, id: "another" }],
    });
    await expect(accessibleDevelopmentUrl(cwd, endpoint.url)).rejects.toThrow("More than one");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps ordinary web links local and makes local wildcard URLs usable", async () => {
    await openWorkspaceUrl(cwd, "https://example.com/docs");
    await openWorkspaceUrl("C:\\app", "http://0.0.0.0:5173/page");
    expect(openUrl.mock.calls).toEqual([
      ["https://example.com/docs"],
      ["http://127.0.0.1:5173/page"],
    ]);
    expect(featureHost).not.toHaveBeenCalled();
  });

  it("matches private IP links only to their exact discovered listening address", async () => {
    await expect(accessibleDevelopmentUrl(cwd, "http://192.168.2.8:5173/")).rejects.toThrow(
      "No running",
    );
    remoteRequest.mockResolvedValue({
      status: "ok",
      servers: [{ ...server, endpoints: [{ ...endpoint, address: "192.168.2.8" }] }],
    });
    await accessibleDevelopmentUrl(cwd, "http://192.168.2.8:5173/");
    expect(invoke).toHaveBeenCalledWith(
      "remote_dev_server_url",
      expect.objectContaining({ address: "192.168.2.8" }),
    );
  });

  it("opens remote HTTPS in the owning host's browser preview", async () => {
    await openWorkspaceUrl(cwd, "https://localhost:5173/nested");
    expect(featureHost).toHaveBeenCalledWith(cwd, "browser.shared");
    expect(openHostToolsWindow).toHaveBeenCalledWith({
      cwd,
      sessionId: "",
      title: "localhost:5173",
      initialTab: "browser",
      initialUrl: "https://localhost:5173/nested",
    });
    expect(openUrl).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
