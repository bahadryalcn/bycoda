import { describe, expect, it } from "vitest";
import { DeviceControlLeases } from "./device-control-leases";

describe("device control leases", () => {
  it("isolates owners and devices, expires and checks revocation", async () => {
    let now = 0;
    let authorized = true;
    const leases = new DeviceControlLeases(() => now, 100);
    const claim = await leases.claim("a", "one", "claim1", async () => authorized);
    expect(claim.leaseId).toBeTruthy();
    await expect(leases.claim("a", "two", "claim2", async () => true)).rejects.toThrow(
      "DEVICE_CONTROL_BUSY",
    );
    await expect(leases.claim("a", "one", "claim3", async () => true)).rejects.toThrow(
      "DEVICE_CONTROL_BUSY",
    );
    expect(await leases.claim("a", "one", "claim1", async () => true)).toEqual(claim);
    expect(await leases.status("a")).toEqual({ deviceId: "a", busy: true });
    await expect(leases.assert("b", "one", claim.leaseId!)).rejects.toThrow(
      "DEVICE_CONTROL_LEASE_INVALID",
    );
    await expect(leases.assert("a", "two", claim.leaseId!)).rejects.toThrow(
      "DEVICE_CONTROL_LEASE_INVALID",
    );
    now = 100;
    await expect(leases.assert("a", "one", claim.leaseId!)).rejects.toThrow(
      "DEVICE_CONTROL_LEASE_INVALID",
    );
    const next = await leases.claim("a", "one", "claim4", async () => authorized);
    authorized = false;
    await expect(leases.assert("a", "one", next.leaseId!)).rejects.toThrow(
      "DEVICE_CONTROL_LEASE_INVALID",
    );
  });

  it("retains uncertain result and rejects changed retries", async () => {
    const leases = new DeviceControlLeases();
    const claim = await leases.claim("a", "one", "claim1", async () => true);
    let calls = 0;
    let replays = 0;
    const send = () =>
      leases.execute(
        "a",
        "one",
        claim.leaseId!,
        "request",
        { x: 1 },
        async () => {
          calls++;
          throw new Error("unknown outcome");
        },
        () => {
          replays++;
        },
      );
    await expect(send()).rejects.toThrow("unknown outcome");
    await expect(send()).rejects.toThrow("unknown outcome");
    expect(calls).toBe(1);
    expect(replays).toBe(1);
    await expect(
      leases.execute("a", "one", claim.leaseId!, "request", { x: 2 }, async () => {}),
    ).rejects.toThrow("DEVICE_REQUEST_CONFLICT");
    expect(await leases.release("a", "one", claim.leaseId!)).toEqual({ released: true });
  });

  it("does not transfer an expired lease while an admitted effect is pending", async () => {
    let now = 0;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const leases = new DeviceControlLeases(() => now, 100);
    const claim = await leases.claim("a", "one", "claim1", async () => true);
    const result = leases.execute("a", "one", claim.leaseId!, "request", {}, () => pending);
    await new Promise((resolve) => setTimeout(resolve, 0));
    now = 100;
    await expect(leases.claim("a", "two", "claim2", async () => true)).rejects.toThrow(
      "DEVICE_CONTROL_BUSY",
    );
    finish();
    await result;
    expect((await leases.claim("a", "two", "claim2", async () => true)).leaseId).toBeTruthy();
  });

  it("holds physical work after observer failure and releases when it settles", async () => {
    let finish!: () => void;
    const physical = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const leases = new DeviceControlLeases();
    const claim = await leases.claim("a", "one", "claim1", async () => true);
    await expect(
      leases.execute("a", "one", claim.leaseId, "request", {}, async (track) => {
        track(physical);
        throw new Error("observer timeout");
      }),
    ).rejects.toThrow("observer timeout");
    await expect(leases.release("a", "one", claim.leaseId)).rejects.toThrow("DEVICE_CONTROL_BUSY");
    finish();
    await physical;
    expect(await leases.release("a", "one", claim.leaseId)).toEqual({ released: true });
  });

  it("retires settled receipts after release without exhausting admission", async () => {
    const leases = new DeviceControlLeases();
    for (let index = 0; index < 4100; index++) {
      const claim = await leases.claim("a", "one", `claim${index}`, async () => true);
      await leases.execute("a", "one", claim.leaseId, `request${index}`, {}, async () => "done");
      await leases.release("a", "one", claim.leaseId);
    }
    expect(await leases.status("a")).toEqual({ deviceId: "a", busy: false });
  });

  it("returns the same receipt after lease expiry without issuing another effect", async () => {
    let now = 0,
      calls = 0;
    const leases = new DeviceControlLeases(() => now, 100);
    const claim = await leases.claim("a", "one", "claim", async () => true);
    const run = () =>
      leases.execute("a", "one", claim.leaseId, "request", { type: "press" }, async () => ++calls);
    expect(await run()).toBe(1);
    now = 100;
    await leases.status("a");
    expect(await run()).toBe(1);
    expect(calls).toBe(1);
    await expect(
      leases.execute("a", "one", claim.leaseId, "new", {}, async () => {}),
    ).rejects.toThrow("DEVICE_CONTROL_LEASE_INVALID");
  });

  it("fences the proven boot target while holding the original device lease", async () => {
    const leases = new DeviceControlLeases();
    const first = await leases.claim("avd", "one", "first", async () => true);
    const other = await leases.claim("emulator-5554", "two", "other", async () => true);
    await expect(
      leases.bindBootTarget("avd", "emulator-5554", "one", first.leaseId),
    ).rejects.toThrow("DEVICE_CONTROL_BUSY");
    await leases.release("emulator-5554", "two", other.leaseId);
    await leases.bindBootTarget("avd", "emulator-5554", "one", first.leaseId);
    await expect(leases.claim("emulator-5554", "two", "new", async () => true)).rejects.toThrow(
      "DEVICE_CONTROL_BUSY",
    );
    await leases.release("avd", "one", first.leaseId);
    expect(
      (await leases.claim("emulator-5554", "two", "new", async () => true)).leaseId,
    ).toBeTruthy();
  });
});
