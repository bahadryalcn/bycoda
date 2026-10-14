import { describe, expect, it, vi } from "vitest";
import {
  ExternalTunnelController,
  readTunnelOverview,
  tunnelUiIssue,
  type TunnelApi,
} from "./externalTunnelController";
import type { TunnelOverview } from "../../../integrations/external-tunnels";

vi.mock("./connections", () => ({ remoteRequest: vi.fn() }));

const status = (): TunnelOverview => ({
  environmentId: "env",
  hostLocalUrl: "http://127.0.0.1:3776",
  publicReachability: "unverified",
  providers: [
    { provider: "cloudflare", installed: true, credential: "not-required" },
    { provider: "ngrok", installed: true, credential: "missing" },
  ],
  tunnels: [],
});
function setup() {
  const api: TunnelApi = {
    status: vi.fn(async () => status()),
    start: vi.fn(async () => ({})),
    stop: vi.fn(async () => ({})),
    credential: vi.fn(async () => ({})),
  };
  return { api, controller: new ExternalTunnelController("env", api) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((r) => {
      resolve = r;
    }),
    resolve: (value: T) => resolve(value),
  };
}

describe("external tunnel status routing", () => {
  it("discards status reads completed after a mutation", async () => {
    const { controller, api } = setup();
    const pending = deferred<TunnelOverview>();
    vi.mocked(api.status).mockReturnValueOnce(pending.promise);
    const read = controller.refresh();
    await controller.start({ provider: "cloudflare", target: "dev-server", localUrl: "3000" });
    expect(api.start).toHaveBeenCalledWith({
      provider: "cloudflare",
      target: "dev-server",
      localUrl: "http://127.0.0.1:3000",
    });
    const newer = controller.getSnapshot();
    pending.resolve({ ...status(), hostLocalUrl: "http://127.0.0.1:9999" });
    await read;
    expect(controller.getSnapshot()).toBe(newer);
  });
  it("does not apply late reads after a machine panel closes", async () => {
    const { controller, api } = setup();
    const pending = deferred<TunnelOverview>();
    vi.mocked(api.status).mockReturnValueOnce(pending.promise);
    const work = controller.refresh();
    controller.close();
    pending.resolve(status());
    await work;
    expect(controller.getSnapshot().overview).toBeUndefined();
    await controller.start({ provider: "cloudflare", target: "host" });
    expect(api.start).not.toHaveBeenCalled();
  });
  it("deduplicates polls and blocks duplicate writes", async () => {
    const { controller, api } = setup();
    const pending = deferred<TunnelOverview>();
    vi.mocked(api.status).mockReturnValueOnce(pending.promise);
    const first = controller.refresh();
    const second = controller.refresh();
    expect(api.status).toHaveBeenCalledTimes(1);
    pending.resolve(status());
    await Promise.all([first, second]);
    const stopping = deferred<unknown>();
    vi.mocked(api.stop).mockReturnValueOnce(stopping.promise);
    const a = controller.stop("owned");
    await controller.stop("owned");
    expect(api.stop).toHaveBeenCalledTimes(1);
    stopping.resolve({});
    await a;
  });
  it("invalidates displayed URLs on connection loss and never exposes diagnostic secrets", async () => {
    const { controller, api } = setup();
    await controller.refresh();
    vi.mocked(api.status).mockRejectedValueOnce(new Error("network private-secret-token"));
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({ phase: "error", issue: "connection" });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("private-secret");
    expect(tunnelUiIssue("Unsupported remote method")).toBe("host-update");
    expect(tunnelUiIssue("Unsupported remote operation")).toBe("host-update");
    expect(tunnelUiIssue("Unknown host method: tunnels.status")).toBe("host-update");
    expect(tunnelUiIssue("Unsupported host method")).toBe("host-update");
  });
  it("rejects cross-host and malformed data and strips non-contract secrets", () => {
    expect(() => readTunnelOverview({ ...status(), environmentId: "other-host" }, "env")).toThrow(
      "invalid-response",
    );
    expect(() => readTunnelOverview({ ...status(), providers: [] }, "env")).toThrow(
      "invalid-response",
    );
    const info = {
      id: "11111111-1111-4111-8111-111111111111",
      provider: "cloudflare",
      target: "host",
      localUrl: "http://127.0.0.1:3776",
      state: "ready",
      canStop: true,
      startedAt: 1,
      publicUrl: "https://owned.trycloudflare.com",
    };
    expect(() =>
      readTunnelOverview(
        {
          ...status(),
          tunnels: [{ ...info, publicUrl: "https://owned.trycloudflare.com/?token=private" }],
        },
        "env",
      ),
    ).toThrow("invalid-response");
    const value = readTunnelOverview(
      { ...status(), token: "private-secret", tunnels: [{ ...info, stderr: "private-secret" }] },
      "env",
    );
    expect(JSON.stringify(value)).not.toContain("private-secret");
    expect(value.tunnels[0].publicUrl).toBe("https://owned.trycloudflare.com");
  });
});
