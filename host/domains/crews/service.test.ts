import { expect, it, vi } from "vitest";
import { createHostCrewsService } from "./service";
import { HostDomainAuthorizationError } from "../context";
import { CREWS_RPC_SCHEMAS } from "../../../src/shared/model/host-contracts/crews";
import { getHostRpcMethod, hostRpcHasEffect } from "../../../src/shared/model/host-contracts";

function fixture() {
  let allowed = true;
  let currentGuard: (() => Promise<boolean>) | undefined;
  const controller = new AbortController();
  const call = vi.fn(
    async (..._args: [string, Record<string, unknown>, string]): Promise<unknown> => ({
      retained: true,
    }),
  );
  const service = createHostCrewsService({
    crews: {
      async withAuthorization<T>(guard: () => Promise<boolean>, work: () => Promise<T>) {
        currentGuard = guard;
        await guard();
        return work();
      },
      call,
    },
  });
  return {
    service,
    call,
    controller,
    context: {
      authorized: async () => allowed,
      principalId: "paired-owner",
      signal: controller.signal,
    },
    revoke() {
      allowed = false;
    },
    guard: () => currentGuard!(),
  };
}

it("rejects a forged WS conversation principal and keeps the paired legacy call unbound", async () => {
  const f = fixture();
  const raw = {
    projectId: 7,
    definitionJson: ' {"untouched":true} ',
    principal: { sessionId: "forged" },
  };
  await expect(f.service.call("crews.save", raw, f.context)).rejects.toThrow();
  expect(f.call).not.toHaveBeenCalled();
  await f.service.call("crews.save", raw, f.context, { legacy: true });
  // The legacy owner still owns coercion and JSON parsing; there is no fourth
  // conversation-principal argument, even when legacy params contain one.
  expect(f.call.mock.calls).toEqual([["crews.save", raw, "7"]]);
  expect(f.call.mock.calls[0][1].definitionJson).toBe(raw.definitionJson);
});

it("rechecks a revoked grant after an awaited owner result without repeating the mutation", async () => {
  const f = fixture();
  f.call.mockImplementationOnce(async () => {
    f.revoke();
    return { id: "actual-retained-run" };
  });
  await expect(
    f.service.call("crews.pause", { projectId: "project", runId: "run" }, f.context),
  ).rejects.toBeInstanceOf(HostDomainAuthorizationError);
  expect(f.call).toHaveBeenCalledOnce();
  expect(await f.guard()).toBe(false);
});

it("detaches an admitted mutation from caller cancellation while retaining its grant guard", async () => {
  const f = fixture();
  const accepted = { id: "same-owner-result" };
  f.call.mockImplementationOnce(async () => {
    f.controller.abort();
    expect(await f.guard()).toBe(true);
    return accepted;
  });
  expect(
    await f.service.call("crews.pause", { projectId: "project", runId: "run" }, f.context),
  ).toBe(accepted);
  expect(f.call).toHaveBeenCalledOnce();
});

it("keeps query cancellation and rejects cancellation before admission", async () => {
  const f = fixture();
  f.call.mockImplementationOnce(async () => {
    f.controller.abort();
    return { id: "not-disclosed" };
  });
  await expect(
    f.service.call("crews.get", { projectId: "project", runId: "run" }, f.context),
  ).rejects.toThrow("Request cancelled");
  await expect(
    f.service.call("crews.stop", { projectId: "project", runId: "run" }, f.context),
  ).rejects.toThrow("Request cancelled");
  expect(f.call).toHaveBeenCalledOnce();
});

it.each(["crews.active.list"] as const)(
  "retains caller cancellation for %s without exposing its completed result",
  async (method) => {
    const f = fixture();
    f.call.mockImplementationOnce(async () => {
      f.controller.abort();
      await expect(f.guard()).rejects.toThrow("Request cancelled");
      return { retained: true };
    });
    await expect(f.service.call(method, {}, f.context)).rejects.toThrow("Request cancelled");
    expect(f.call).toHaveBeenCalledOnce();
  },
);

it("accounts default-bootstrapping list as an effect and reserves control admission for Stop", () => {
  const queries = new Set(["crews.schema", "crews.inspect", "crews.get", "crews.active.list"]);
  for (const method of Object.keys(CREWS_RPC_SCHEMAS)) {
    const policy = getHostRpcMethod(method)!;
    expect(policy.requiredCapability).toBe("transport.ws.crews.v2");
    expect(hostRpcHasEffect(method, policy.kind)).toBe(!queries.has(method));
    expect(policy.cost).toBe(method === "crews.stop" ? "control" : "read");
    if (!queries.has(method))
      expect(policy).toMatchObject({ retry: "never", cancellation: "wait-only" });
  }
});
