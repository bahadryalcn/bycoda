import { describe, expect, it } from "vitest";
import { dedupeHostToolMachines, hostToolTargetKey, targetIsProjectHost } from "./hostToolTarget";
import type { RemoteMachine } from "./protocol";

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

describe("host tool targets", () => {
  it("keys explicit targets independently from the owning project", () => {
    expect(hostToolTargetKey({ kind: "project" })).toBe("project");
    expect(hostToolTargetKey({ kind: "local" })).toBe("local");
    expect(hostToolTargetKey({ kind: "machine", machineId: "mac" })).toBe("machine:mac");
  });

  it("allows project annotations only on the owning environment", () => {
    const cwd = "remote://mac-env/Users/user/project";
    expect(targetIsProjectHost(cwd, { kind: "project" }, [])).toBe(true);
    expect(targetIsProjectHost(cwd, { kind: "local" }, [local, mac])).toBe(false);
    expect(targetIsProjectHost(cwd, { kind: "machine", machineId: "mac" }, [local, mac])).toBe(
      true,
    );
    expect(targetIsProjectHost(cwd, { kind: "machine", machineId: "local" }, [local, mac])).toBe(
      false,
    );
    expect(targetIsProjectHost(cwd, { kind: "machine", machineId: "gone" }, [local, mac])).toBe(
      false,
    );
  });

  it("identifies this computer without treating an SSH loopback tunnel as local", () => {
    const tunnel: RemoteMachine = {
      ...mac,
      endpoint: "http://127.0.0.1:3774",
      ssh: {
        target: "user@mac",
        port: null,
        remotePort: 3776,
      },
    };
    expect(targetIsProjectHost("G:/repo", { kind: "local" }, [])).toBe(true);
    expect(targetIsProjectHost("G:/repo", { kind: "machine", machineId: "local" }, [local])).toBe(
      true,
    );
    expect(targetIsProjectHost("G:/repo", { kind: "machine", machineId: "mac" }, [tunnel])).toBe(
      false,
    );
    expect(targetIsProjectHost("remote://invalid", { kind: "local" }, [local])).toBe(false);
    expect(targetIsProjectHost("", { kind: "project" }, [local])).toBe(false);
  });

  it("keeps current local metadata and one row per saved host identity", () => {
    const oldLocal = {
      ...local,
      id: "old-local",
      environmentId: "old-local-env",
      endpoint: "http://127.0.0.1:3774",
    };
    const duplicateMac = { ...mac, id: "second-mac", endpoint: "https://alternate.example" };
    expect(dedupeHostToolMachines(local, [oldLocal, local, mac, duplicateMac])).toEqual([
      local,
      mac,
    ]);
    expect(dedupeHostToolMachines(null, [mac, duplicateMac])).toEqual([mac]);
  });
});
