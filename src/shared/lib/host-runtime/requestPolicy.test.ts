import { expect, it } from "vitest";
import { getHostRpcMethod } from "../../model/host-contracts";
import { hostRpcHasEffect } from "./requestPolicy";

it("classifies effects from exact method metadata independently of retry policy, cost or read-like names", () => {
  for (const method of [
    "goals.list",
    "tasks.save",
    "files.write",
    "devServers.bridgeRead",
    "sessions.queue.get",
  ])
    expect(hostRpcHasEffect(method, getHostRpcMethod(method)!.kind)).toBe(true);
  for (const method of [
    "projects.list",
    "commands.status",
    "subscriptions.open",
    "subscriptions.ack",
    "subscriptions.close",
    "connection.hello",
    "connection.probe",
    "requests.cancel",
  ])
    expect(hostRpcHasEffect(method, getHostRpcMethod(method)!.kind)).toBe(false);
  expect(hostRpcHasEffect("future.read", "control")).toBe(true);
  expect(hostRpcHasEffect("future.operation", "unknown-future-kind")).toBe(true);
});
