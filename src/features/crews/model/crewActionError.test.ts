import { expect, it } from "vitest";
import { crewActionError, crewActionErrorRecovered } from "./crewActionError";

const local = {
  id: "local",
  name: "This computer (local sync)",
  endpoint: "http://127.0.0.1:3776",
  environmentId: "local-env",
  localHost: true,
};
const mac = {
  id: "mac",
  name: "tailm",
  endpoint: "http://127.0.0.1:61000",
  environmentId: "mac-env",
  ssh: { target: "me@100.64.0.1", remotePort: 3776 },
};
const refused = new Error("Machine is unreachable. Check the host and SSH tunnel, then reconnect.");

it("names this computer without blaming an SSH tunnel it does not use", () => {
  const error = crewActionError(refused, "Pause", local, 10);
  expect(error.connection).toBe(true);
  expect(error.message).toContain("Pause failed on This computer");
  expect(error.message).not.toMatch(/SSH/);
});

it("keeps the native reason for a remote machine and names it", () => {
  const error = crewActionError(refused, "Stop work", mac, 10);
  expect(error.message).toBe(
    "Stop work failed on tailm: Machine is unreachable. Check the host and SSH tunnel, then reconnect.",
  );
});

it("retires only connection failures, and only after a newer successful read", () => {
  const connection = crewActionError(refused, "Pause", local, 10);
  expect(crewActionErrorRecovered(connection, 10)).toBe(false);
  expect(crewActionErrorRecovered(connection, 11)).toBe(true);
  const refusedByHost = crewActionError(new Error("Run changed"), "Pause", local, 10);
  expect(refusedByHost.connection).toBe(false);
  expect(crewActionErrorRecovered(refusedByHost, 99)).toBe(false);
  expect(crewActionErrorRecovered(undefined, 99)).toBe(false);
});
