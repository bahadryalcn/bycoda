import { describe, expect, it, vi } from "vitest";
import { PhonePairingCoordinator } from "./phonePairingCoordinator";
import type { PhonePairingApi, PhonePairingCreated, PhonePairingStatus } from "./phonePairingTypes";
import type { RemoteMachine } from "./protocol";
import type { MobileAccessStatus } from "../../../integrations/mobile-access";

const local: RemoteMachine = {
  id: "local",
  name: "This computer",
  endpoint: "http://127.0.0.1:3776",
  environmentId: "local-environment",
  localHost: true,
};
const remote: RemoteMachine = {
  id: "remote",
  name: "Remote computer",
  endpoint: "http://127.0.0.1:49000",
  environmentId: "remote-environment",
  ssh: { target: "owner@remote", remotePort: 3776 },
};
const ready: MobileAccessStatus = {
  state: "ready",
  endpoint: "https://computer.tail123.ts.net",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  let now = Date.now();
  const ticket = (machine = local): PhonePairingCreated => ({
    pairingId: `pair-${machine.id}`,
    ticket: "a".repeat(43),
    expiresAt: new Date(now + 120_000).toISOString(),
    environmentId: machine.environmentId,
  });
  const api = {
    access: vi.fn<PhonePairingApi["access"]>(async () => ready),
    enable: vi.fn<PhonePairingApi["enable"]>(async () => ready),
    create: vi.fn<PhonePairingApi["create"]>(async (machine) => ticket(machine)),
    status: vi.fn<PhonePairingApi["status"]>(async () => ({
      state: "pending",
    })),
    cancel: vi.fn<PhonePairingApi["cancel"]>(async () => {}),
  };
  const flow = new PhonePairingCoordinator(api, () => now);
  return {
    flow,
    api,
    ticket,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("desktop phone pairing ownership", () => {
  it("starts with LAN and releases a QR when switching to Tailscale", async () => {
    const { flow, api } = fixture();
    api.access.mockResolvedValue({
      state: "ready",
      mode: "lan",
      endpoint: "http://192.168.1.20:3777",
      lanKey: "ab".repeat(32),
    });
    await flow.open(local);
    expect(api.access).toHaveBeenLastCalledWith(local, "lan");
    await flow.create();
    const state = flow.getSnapshot();
    expect(state.stage).toBe("qr");
    if (state.stage === "qr") expect(state.session.code.lanKey).toBe("ab".repeat(32));
    api.access.mockResolvedValue(ready);
    await flow.selectMode("tailscale");
    expect(api.cancel).toHaveBeenCalledWith(local, "pair-local");
    expect(api.access).toHaveBeenLastCalledWith(local, "tailscale");
    expect(flow.getSnapshot()).toMatchObject({ stage: "access", mode: "tailscale" });
  });
  it("does not enable networking on open and single-flights the explicit enable action", async () => {
    const { flow, api } = fixture();
    api.access.mockResolvedValue({ state: "setup-required" });
    await flow.open(local);
    expect(api.enable).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
    const enabling = deferred<MobileAccessStatus>();
    api.enable.mockReturnValueOnce(enabling.promise);
    const first = flow.enable();
    await flow.enable();
    expect(api.enable).toHaveBeenCalledTimes(1);
    enabling.resolve(ready);
    await first;
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(flow.getSnapshot().stage).toBe("qr");
  });

  it("cancels a late-created ticket after close and rejects immediate duplicate creation", async () => {
    const { flow, api, ticket } = fixture();
    await flow.open(local);
    const creating = deferred<PhonePairingCreated>();
    api.create.mockReturnValueOnce(creating.promise);
    const first = flow.create();
    await flow.create();
    expect(api.create).toHaveBeenCalledTimes(1);
    flow.close();
    creating.resolve(ticket());
    await first;
    expect(flow.getSnapshot()).toEqual({ stage: "closed" });
    expect(api.cancel).toHaveBeenCalledWith(local, "pair-local");
  });

  it("does not let an old machine lookup overwrite a newly selected target", async () => {
    const { flow, api } = fixture();
    const lookup = deferred<MobileAccessStatus>();
    api.access.mockReturnValueOnce(lookup.promise);
    const old = flow.open(local);
    await flow.open(remote);
    lookup.resolve({ state: "install-required" });
    await old;
    expect(flow.getSnapshot()).toEqual({
      stage: "access",
      mode: "lan",
      machine: remote,
      access: ready,
    });
  });

  it("releases the old machine QR and ignores a late acceptance after selection changes", async () => {
    const { flow, api } = fixture();
    await flow.open(local);
    await flow.create();
    const status = deferred<PhonePairingStatus>();
    api.status.mockReturnValueOnce(status.promise);
    const checking = flow.check();
    await flow.open(remote);
    status.resolve({ state: "paired", deviceName: "Old phone" });
    await checking;
    expect(api.cancel).toHaveBeenCalledWith(local, "pair-local");
    expect(flow.getSnapshot()).toEqual({
      stage: "access",
      mode: "lan",
      machine: remote,
      access: ready,
    });
    expect(JSON.stringify(flow.getSnapshot())).not.toContain("ticket");
  });

  it("expires and removes the ticket, then discovers the current address before regenerating", async () => {
    const { flow, api, advance } = fixture();
    await flow.open(local);
    await flow.create();
    advance(120_001);
    flow.tick();
    expect(flow.getSnapshot().stage).toBe("expired");
    expect(JSON.stringify(flow.getSnapshot())).not.toContain("ticket");
    expect(api.cancel).toHaveBeenCalledWith(local, "pair-local");
    // Move the fake clock back into the real contract validation window.
    advance(-120_001);
    api.access.mockResolvedValue({
      state: "ready",
      endpoint: "https://new.tail123.ts.net:8443",
    });
    await flow.regenerate();
    const state = flow.getSnapshot();
    expect(state.stage).toBe("qr");
    if (state.stage === "qr")
      expect(state.session.code.endpoint).toBe("https://new.tail123.ts.net:8443");
    expect(api.access).toHaveBeenCalledTimes(2);
  });

  it("keeps confirmation failures separate from success and clears secrets only after host acceptance", async () => {
    const { flow, api } = fixture();
    await flow.open(local);
    await flow.create();
    api.status.mockRejectedValueOnce(new Error("CLI output contains secret"));
    await flow.check();
    const waiting = flow.getSnapshot();
    expect(waiting.stage).toBe("qr");
    if (waiting.stage === "qr") expect(waiting.statusError).toBe("connection");
    api.status.mockResolvedValueOnce({ state: "paired", deviceName: "Phone" });
    await flow.check();
    expect(flow.getSnapshot()).toEqual({
      stage: "paired",
      mode: "lan",
      machine: local,
      deviceName: "Phone",
    });
    expect(JSON.stringify(flow.getSnapshot())).not.toContain("ticket");
    flow.close();
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it("cannot issue tickets while the selected host still requires setup or permission", async () => {
    const { flow, api } = fixture();
    api.access.mockResolvedValue({
      state: "approval-required",
      approvalUrl: "https://login.tailscale.com/a/approve",
    });
    await flow.open(remote);
    await flow.create();
    await flow.enable();
    expect(api.enable).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });
});
