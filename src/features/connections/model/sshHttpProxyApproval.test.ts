// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
import {
  approveSshHttpProxy,
  revokeSshHttpProxyApproval,
  validHttpProxyCredentials,
  type SshHttpProxyRequest,
} from "./sshHttpProxyApproval";
afterEach(() => vi.clearAllMocks());
const request: SshHttpProxyRequest = {
  connectionId: "server",
  endpoint: {
    host: "target.invalid",
    user: "alice",
    port: 22,
    httpProxy: { host: "proxy.invalid", port: 3128 },
  },
  operation: { kind: "terminal", id: "terminal-1" },
};
it("binds saved authority, exact reviewed route and one operation without serializing credentials into the endpoint", async () => {
  native.invoke.mockResolvedValue({ ticketId: "one-ticket", expiresInSeconds: 30 });
  await approveSshHttpProxy(request, " username ", " password ", true);
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("ssh_http_proxy_credentials_approve", {
    connectionId: "server",
    expectedEndpoint: request.endpoint,
    operation: request.operation,
    username: " username ",
    password: " password ",
    allowPlainHttp: true,
  });
  expect(request.endpoint).not.toHaveProperty("password");
  expect(request.endpoint.httpProxy).toEqual({ host: "proxy.invalid", port: 3128 });
  await approveSshHttpProxy({ ...request, connectionId: undefined }, "user", "", true);
  expect(native.invoke.mock.lastCall?.[1]).toEqual({
    endpoint: request.endpoint,
    expectedEndpoint: request.endpoint,
    operation: request.operation,
    username: "user",
    password: "",
    allowPlainHttp: true,
  });
});
it("accepts literal credentials within byte limits without trimming and rejects header/control injection", () => {
  expect(validHttpProxyCredentials(" user ", " pass ")).toBe(true);
  expect(validHttpProxyCredentials("user", "")).toBe(true);
  for (const [user, password] of [
    ["", "x"],
    ["user:name", "x"],
    ["user\n", "x"],
    ["user", "x\r"],
    ["user", "日".repeat(1400)],
  ])
    expect(validHttpProxyCredentials(user, password)).toBe(false);
});
it("does not expose malformed/long-lived native approvals as operation tickets", async () => {
  for (const result of [
    null,
    { ticketId: "", expiresInSeconds: 30 },
    { ticketId: "ticket", expiresInSeconds: 31 },
    { ticketId: "ticket", expiresInSeconds: 0 },
  ]) {
    native.invoke.mockResolvedValueOnce(result);
    await expect(approveSshHttpProxy(request, "user", "pass", true)).rejects.toThrow(
      "Invalid HTTP proxy approval",
    );
  }
});

it("accepts a runbook-only 120 second grant while preserving other operations at 30 seconds", async () => {
  native.invoke.mockResolvedValue({ ticketId: "runbook-ticket", expiresInSeconds: 120 });
  await expect(approveSshHttpProxy(request, "user", "pass", true)).rejects.toThrow(
    "Invalid HTTP proxy approval",
  );
  const scoped: SshHttpProxyRequest = {
    ...request,
    operation: {
      kind: "runbook",
      runId: "run-1",
      automationId: "book-1",
      revision: 4,
      reviewDigest: "a".repeat(64),
      serverId: "server",
    },
  };
  await expect(approveSshHttpProxy(scoped, "user", "pass", true)).resolves.toEqual({
    ticketId: "runbook-ticket",
    expiresInSeconds: 120,
  });
  expect(native.invoke.mock.lastCall?.[1].operation).toEqual(scoped.operation);
  native.invoke.mockResolvedValue({ ticketId: "too-long", expiresInSeconds: 121 });
  await expect(approveSshHttpProxy(scoped, "user", "pass", true)).rejects.toThrow(
    "Invalid HTTP proxy approval",
  );
});

it("revokes an unused lease through the native window-owned broker", async () => {
  await revokeSshHttpProxyApproval("unused-ticket");
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("ssh_http_proxy_credentials_revoke", {
    ticketId: "unused-ticket",
  });
});
