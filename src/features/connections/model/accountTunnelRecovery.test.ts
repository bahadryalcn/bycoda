import { describe, expect, it, vi } from "vitest";
vi.mock("../../account", () => ({ accountApi: vi.fn() }));
import { recoverAccountTunnel, withAccountTunnelRecovery } from "./accountTunnelRecovery";

describe("account tunnel recovery", () => {
  const machine = { id: "pc", environmentId: "env" };
  it("re-fetches the same environment, verifies/learns its new tunnel natively, and retries once", async () => {
    let endpoint = "https://old.trycloudflare.com";
    const list = vi.fn(async () => ({
      items: [
        { environmentId: "other", routes: [{ endpoint: "https://wrong.trycloudflare.com" }] },
        { environmentId: "env", routes: [{ endpoint: "https://new.trycloudflare.com" }] },
      ],
    }));
    const learn = vi.fn(async (_machine, _environment, routes: string[]) => {
      endpoint = routes[0];
      return true;
    });
    const send = vi.fn(async () => {
      if (endpoint.includes("old")) throw new Error("Machine is unreachable");
      return endpoint;
    });
    const recover = (id: string, environment: string) =>
      recoverAccountTunnel(id, environment, { list, learn });
    expect(
      await withAccountTunnelRecovery("environment.describe", machine, () => true, send, recover),
    ).toBe("https://new.trycloudflare.com");
    expect(learn).toHaveBeenCalledWith("pc", "env", ["https://new.trycloudflare.com"]);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("does not learn a different environment or retry failed identity verification", async () => {
    const learn = vi.fn(async () => false);
    expect(
      await recoverAccountTunnel("pc", "missing", { list: async () => ({ items: [] }), learn }),
    ).toBe(false);
    expect(learn).not.toHaveBeenCalled();
    const send = vi.fn().mockRejectedValue(new Error("Machine is unreachable"));
    await expect(
      withAccountTunnelRecovery(
        "environment.describe",
        machine,
        () => true,
        send,
        async () => false,
      ),
    ).rejects.toThrow();
    expect(send).toHaveBeenCalledOnce();
  });
  it("preserves credentials, owner disconnects, rejected auth, and unknown effect outcomes", async () => {
    const recover = vi.fn(async () => true);
    for (const [method, current, error] of [
      ["commands.dispatch", true, "Machine is unreachable"],
      ["environment.describe", false, "Machine is unreachable"],
      ["environment.describe", true, "Host rejected request: credentials"],
    ] as const) {
      await expect(
        withAccountTunnelRecovery(
          method,
          machine,
          () => current,
          async () => {
            throw new Error(error);
          },
          recover,
        ),
      ).rejects.toThrow(error);
    }
    expect(recover).not.toHaveBeenCalled();
  });
});
