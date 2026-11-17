import { expect, it } from "vitest";
import { DeviceControlLeases } from "./device-control-leases";
import { conversationLeaseOwner, leaseHolderFromOwner } from "./lease-holder";

const allowed = async () => true;

it("maps a conversation owner to its session and a paired owner to a controller", () => {
  expect(leaseHolderFromOwner(conversationLeaseOwner("abc123", "session:with:colons"))).toEqual({
    kind: "session",
    sessionId: "session:with:colons",
  });
  expect(leaseHolderFromOwner("paired:deadbeef")).toEqual({ kind: "controller" });
});

it("reports the live holder per device and never leaks the token hash or lease id", async () => {
  let wall = 1_000;
  let mono = 0;
  const leases = new DeviceControlLeases(
    () => mono,
    1000,
    () => wall,
  );
  expect(await leases.status("d1")).toEqual({ deviceId: "d1", busy: false });
  const claim = await leases.claim("d1", conversationLeaseOwner("secrethash", "s1"), "r1", allowed);
  await leases.claim("d2", "paired:person", "r2", allowed);
  const status = await leases.status("d1");
  expect(status).toEqual({
    deviceId: "d1",
    busy: true,
    heldBy: { kind: "session", sessionId: "s1" },
  });
  expect(JSON.stringify(status)).not.toContain("secrethash");
  expect(JSON.stringify(status)).not.toContain(claim.leaseId);
  expect((await leases.status("d2")).heldBy).toEqual({ kind: "controller" });
  expect(Object.fromEntries(await leases.holders())).toEqual({
    d1: { kind: "session", sessionId: "s1" },
    d2: { kind: "controller" },
  });
  mono = 1001;
  wall = 3_000;
  expect(await leases.status("d1")).toEqual({ deviceId: "d1", busy: false });
  expect((await leases.holders()).size).toBe(0);
});
