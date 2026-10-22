import { beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import {
  forwardRuntimeId,
  listSshForwards,
  startSshForward,
  stopSshForward,
  validateForwardRule,
} from "./sshForwards";
describe("SSH forwarding contracts", () => {
  beforeEach(() => invoke.mockReset());
  it("rejects invalid ports, option injection and blank destinations", () => {
    for (const localPort of ["0", "65536", "1.5", ""])
      expect(() =>
        validateForwardRule({ name: "", localPort, targetHost: "localhost", targetPort: "22" }),
      ).toThrow();
    for (const targetHost of ["", "-oProxyCommand=x", "host;command", "host user"])
      expect(() =>
        validateForwardRule({ name: "", localPort: "1234", targetHost, targetPort: "22" }),
      ).toThrow();
  });
  it("scopes runtime identity to connection and keeps start explicit", async () => {
    const rule = {
      id: "rule",
      ...validateForwardRule({
        name: "",
        localPort: "1234",
        targetHost: "127.0.0.1",
        targetPort: "5432",
      }),
    };
    expect(forwardRuntimeId("one", rule.id)).not.toEqual(forwardRuntimeId("two", rule.id));
    expect(invoke).not.toHaveBeenCalled();
    await listSshForwards();
    expect(invoke).toHaveBeenLastCalledWith("ssh_forward_list");
    await startSshForward("one", rule);
    expect(invoke).toHaveBeenLastCalledWith("ssh_forward_start", {
      id: "one:rule",
      connectionId: "one",
      localPort: 1234,
      kind: "local",
      targetHost: "127.0.0.1",
      targetPort: 5432,
    });
    await stopSshForward("one:rule");
    expect(invoke).toHaveBeenLastCalledWith("ssh_forward_stop", { id: "one:rule" });
  });
  it("validates dynamic loopback rules without copying a hidden local destination", async () => {
    const rule = {
      id: "proxy",
      ...validateForwardRule({
        kind: "dynamic",
        name: "",
        localPort: "1080",
        targetHost: "old.local",
        targetPort: "5432",
      }),
    };
    expect(rule).toMatchObject({ kind: "dynamic", localPort: 1080, targetHost: "", targetPort: 0 });
    expect(invoke).not.toHaveBeenCalled();
    await startSshForward("one", rule);
    expect(invoke).toHaveBeenCalledWith("ssh_forward_start", {
      id: "one:proxy",
      connectionId: "one",
      kind: "dynamic",
      localPort: 1080,
      targetHost: "",
      targetPort: 0,
    });
    expect(() =>
      validateForwardRule({
        kind: "dynamic",
        name: "",
        localPort: "0",
        targetHost: "",
        targetPort: "",
      }),
    ).toThrow();
  });
});
