import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, openUrl, featureHost, remoteRequest, remoteSessionFor, openHostToolsWindow } =
  vi.hoisted(() => ({
    invoke: vi.fn(),
    openUrl: vi.fn(),
    featureHost: vi.fn(),
    remoteRequest: vi.fn(),
    remoteSessionFor: vi.fn(),
    openHostToolsWindow: vi.fn(),
  }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("./hostFeatureClient", () => ({ featureHost }));
vi.mock("./connections", () => ({ remoteRequest, remoteSessionFor }));
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
  remoteSessionFor.mockReturnValue("host-session");
  invoke.mockResolvedValue("http://127.0.0.1:49123/nested?x=1#here");
  openUrl.mockResolvedValue(undefined);
});

describe("workspace development URLs", () => {
  it("opens a discovered remote HTTP chat link through the private system browser address", async () => {
    const url = "http://localhost:5173/nested?x=1#here";
    await openWorkspaceUrl(cwd, url, "composer-session");
    expect(invoke).toHaveBeenCalledWith("remote_dev_server_url", expect.objectContaining({ url }));
    expect(openUrl).toHaveBeenCalledWith("http://127.0.0.1:49123/nested?x=1#here");
    expect(openHostToolsWindow).not.toHaveBeenCalled();
  });

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

  it.each([
    "http://localhost:5173/nested?x=1#here",
    "http://10.0.0.8:3000/",
    "http://[::1]:5173/",
    "https://localhost:5173/nested",
  ])("opens unsupported remote %s in the owning Host Browser", async (url) => {
    remoteRequest.mockResolvedValue({ status: "ok", servers: [] });
    await openWorkspaceUrl(cwd, url, "composer-session");
    expect(featureHost).toHaveBeenCalledWith(cwd, "browser.shared");
    expect(remoteRequest).toHaveBeenCalledTimes(url.startsWith("https:") ? 0 : 1);
    expect(openHostToolsWindow).toHaveBeenCalledTimes(1);
    expect(openHostToolsWindow).toHaveBeenCalledWith({
      cwd,
      sessionId: "host-session",
      composerSessionId: "composer-session",
      title: new URL(url).host,
      initialTab: "browser",
      initialMachine: "project",
      initialUrl: url,
    });
    expect(openUrl).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("opens remote links without an origin session as a Host Browser request", async () => {
    remoteRequest.mockResolvedValue({ status: "ok", servers: [] });
    await openWorkspaceUrl(cwd, "http://localhost:5173/");
    expect(openHostToolsWindow).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "", initialMachine: "project" }),
    );
  });

  it.each([
    ["0.0.0.0", "127.0.0.1"],
    ["[::]", "[::1]"],
  ])("opens remote listen address %s on Host loopback", async (address, loopback) => {
    remoteRequest.mockResolvedValue({ status: "ok", servers: [] });
    await openWorkspaceUrl(cwd, `http://${address}:5173/patients?active#today`, "composer-session");
    expect(openHostToolsWindow).toHaveBeenCalledWith(
      expect.objectContaining({ initialUrl: `http://${loopback}:5173/patients?active#today` }),
    );
  });

  it("requires the originating conversation's Host binding for remote chat links", async () => {
    remoteSessionFor.mockReturnValueOnce(undefined);
    await expect(
      openWorkspaceUrl(cwd, "http://localhost:5173/", "composer-session"),
    ).rejects.toThrow("Open a session on this Host before using project tools.");
    expect(openHostToolsWindow).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("rejects a binding change during Host discovery", async () => {
    remoteSessionFor.mockReturnValueOnce("host-session").mockReturnValueOnce("another-session");
    await expect(
      openWorkspaceUrl(cwd, "http://localhost:5173/", "composer-session"),
    ).rejects.toThrow("Open a session on this Host before using project tools.");
    expect(openHostToolsWindow).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("opens local development links through the local system browser bridge", async () => {
    await openWorkspaceUrl("C:\\app", "http://localhost:5173/page", "session");
    expect(openUrl).toHaveBeenCalledWith("http://localhost:5173/page");
    expect(openHostToolsWindow).not.toHaveBeenCalled();
    expect(featureHost).not.toHaveBeenCalled();
  });

  it("opens discovered remote endpoints through the exact owning machine bridge", async () => {
    const url = await accessibleDevelopmentUrl(cwd, "http://localhost:5173/nested?x=1#here");
    expect(url).toBe("http://127.0.0.1:49123/nested?x=1#here");
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

  it.each([
    "10.example.com",
    "127.example.com",
    "100.97.example.com",
    "192.168.example.com",
    "172.16.example.com",
  ])(
    "opens public DNS name %s without searching the owning host's development servers",
    async (host) => {
      const url = `http://${host}:5173/docs`;
      await openWorkspaceUrl(cwd, url);
      expect(openUrl).toHaveBeenCalledWith(url);
      expect(featureHost).not.toHaveBeenCalled();
    },
  );

  it("routes a fully qualified localhost name through the owning host", async () => {
    remoteRequest.mockResolvedValue({ status: "ok", servers: [] });
    await openWorkspaceUrl(cwd, "http://localhost.:5173/nested?x=1#here");
    expect(featureHost).toHaveBeenCalledWith(cwd, "browser.shared");
    expect(openHostToolsWindow).toHaveBeenCalledWith(
      expect.objectContaining({ initialUrl: "http://localhost.:5173/nested?x=1#here" }),
    );
    expect(openUrl).not.toHaveBeenCalled();
  });

  it.each(["http", "https"])(
    "rejects credentialed %s development links before opening",
    async (protocol) => {
      await expect(
        openWorkspaceUrl(cwd, `${protocol}://user:example@localhost:5173/`),
      ).rejects.toThrow("Choose an HTTP or HTTPS development server URL without credentials.");
      expect(featureHost).not.toHaveBeenCalled();
      expect(openUrl).not.toHaveBeenCalled();
      expect(openHostToolsWindow).not.toHaveBeenCalled();
    },
  );

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

  it("does not open a local fallback when the owning Host browser fails", async () => {
    remoteRequest.mockResolvedValue({ status: "ok", servers: [] });
    openHostToolsWindow.mockRejectedValue(new Error("Browser setup required"));
    await expect(openWorkspaceUrl(cwd, "http://localhost:5173", "origin")).rejects.toThrow(
      "Browser setup required",
    );
    expect(openUrl).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
