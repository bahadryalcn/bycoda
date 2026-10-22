// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SshAgentForwarding } from "./SshAgentForwarding";
import type { ServerRecord } from "../model/serverInventory";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
const server: ServerRecord = {
  id: "saved-target",
  name: "Server",
  kind: "ssh",
  sshEndpoint: { host: "server.invalid", user: "alice", port: 22 },
  metadata: { tags: [], favorite: false },
};
const review = () => ({
  reviewId: "one-use-review",
  endpointFingerprint: "canonical-endpoint-digest",
  expiresAt: Date.now() + 30_000,
  agentAvailable: true,
  summary: { host: "server.invalid", user: "alice", port: 22, jumpHosts: [] },
});
let root: Root, host: HTMLDivElement;
const approve = vi.fn(),
  close = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  native.invoke.mockResolvedValue(review());
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const render = (value = server) =>
  act(async () =>
    root.render(
      createElement(SshAgentForwarding, { server: value, onApprove: approve, onClose: close }),
    ),
  );
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;
it("reviews the explicit current target and approves exactly once without saving permissions", async () => {
  await render();
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("ssh_agent_forwarding_review", {
    connectionId: server.id,
  });
  expect(approve).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("alice@server.invalid:22");
  expect(document.body.textContent).toContain("remote target can use identities");
  const action = button("Approve and connect");
  expect(action.disabled).toBe(false);
  await act(async () => {
    action.click();
    action.click();
  });
  expect(approve).toHaveBeenCalledExactlyOnceWith(server, "one-use-review");
  expect(close).toHaveBeenCalledOnce();
  expect(native.invoke).toHaveBeenCalledTimes(1);
});
it("expires without renewing or reconnecting and only an explicit retry gets a fresh review", async () => {
  vi.useFakeTimers();
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(button("Approve and connect").disabled).toBe(true);
  expect(native.invoke).toHaveBeenCalledTimes(1);
  await act(async () => button("Approve and connect").click());
  expect(approve).not.toHaveBeenCalled();
  native.invoke.mockResolvedValue({ ...review(), reviewId: "new-review" });
  await act(async () => button("Request new review").click());
  expect(native.invoke).toHaveBeenCalledTimes(2);
  expect(button("Approve and connect").disabled).toBe(false);
});
it("invalidates a changed endpoint before approval and does not auto-review the replacement", async () => {
  await render();
  const changed = { ...server, sshEndpoint: { ...server.sshEndpoint!, host: "other.invalid" } };
  await render(changed);
  expect(document.body.textContent).toContain(
    "Agent forwarding target changed. Request a new review.",
  );
  expect(button("Approve and connect").disabled).toBe(true);
  expect(native.invoke).toHaveBeenCalledTimes(1);
  await render(server);
  expect(button("Approve and connect").disabled).toBe(true);
  await render(changed);
  await act(async () => button("Approve and connect").click());
  expect(approve).not.toHaveBeenCalled();
  native.invoke.mockResolvedValue({
    ...review(),
    summary: { ...review().summary, host: "other.invalid" },
  });
  await act(async () => button("Request new review").click());
  await act(async () => button("Approve and connect").click());
  expect(approve).toHaveBeenCalledWith(changed, "one-use-review");
});
it("rejects unavailable, malformed or mismatched native targets with explicit retry", async () => {
  native.invoke.mockResolvedValue({
    ...review(),
    summary: { ...review().summary, host: "wrong.invalid" },
  });
  await render();
  expect(button("Approve and connect").disabled).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("target changed");
  native.invoke.mockResolvedValue({ ...review(), agentAvailable: false });
  await act(async () => button("Request new review").click());
  expect(button("Approve and connect").disabled).toBe(true);
  expect(approve).not.toHaveBeenCalled();
  native.invoke.mockRejectedValue(new Error("Agent forwarding through jumps is unavailable"));
  await act(async () => button("Request new review").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("through jumps");
  expect(approve).not.toHaveBeenCalled();
  native.invoke.mockResolvedValue({ reviewId: "malformed" });
  await act(async () => button("Request new review").click());
  expect(button("Approve and connect").disabled).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("review is unavailable");
});
it("ignores late answers after target changes or unmount and prevents concurrent duplicate review requests", async () => {
  let finish!: (value: unknown) => void;
  native.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  expect(button("Request new review").disabled).toBe(true);
  await act(async () => {
    button("Request new review").click();
    button("Request new review").click();
  });
  expect(native.invoke).toHaveBeenCalledTimes(1);
  await render({ ...server, id: "replacement" });
  await act(async () => finish(review()));
  expect(button("Approve and connect").disabled).toBe(true);
  expect(approve).not.toHaveBeenCalled();
  await act(async () => button("Request new review").click());
  expect(native.invoke).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
  await act(async () => finish(review()));
  expect(approve).not.toHaveBeenCalled();
  root = createRoot(host);
});

it("shows the current HTTP upstream in the review and invalidates approval if its profile changes", async () => {
  const proxy = {
    ...server,
    sshEndpoint: { ...server.sshEndpoint!, httpProxy: { host: "proxy.invalid", port: 3128 } },
  };
  await render(proxy);
  expect(document.body.textContent).toContain("HTTP CONNECT: proxy.invalid:3128");
  expect(button("Approve and connect").disabled).toBe(false);
  await render({
    ...proxy,
    sshEndpoint: { ...proxy.sshEndpoint, httpProxy: { host: "other-proxy.invalid", port: 3128 } },
  });
  expect(button("Approve and connect").disabled).toBe(true);
  expect(native.invoke).toHaveBeenCalledTimes(1);
});

it("reviews an inherited native target only with validated configuration and an explicit inheritance binding", async () => {
  const configuration = {
    digest: "a".repeat(64),
    environment: [{ name: "APP_STAGE", value: "prod" }],
    shellKind: "posix",
    provenance: { user: { source: "group", groupId: "group-1", revision: 4 } },
  };
  const inherited = {
    ...server,
    metadata: {
      ...server.metadata,
      sshInheritance: {
        groupId: "group-1",
        fields: ["user" as const, "port" as const],
        environment: true,
      },
    },
  };
  native.invoke.mockResolvedValue({
    ...review(),
    summary: { ...review().summary, user: "group-user", port: 2222, configuration },
  });
  await render(inherited);
  expect(button("Approve and connect").disabled).toBe(false);
  expect(document.body.textContent).toContain("group-user@server.invalid:2222");
  expect(document.body.textContent).toContain("APP_STAGE=prod");
  await render({
    ...inherited,
    metadata: {
      ...inherited.metadata,
      sshInheritance: { ...inherited.metadata.sshInheritance, environment: false },
    },
  });
  expect(button("Approve and connect").disabled).toBe(true);
  await act(async () => button("Request new review").click());
  expect(button("Approve and connect").disabled).toBe(false);
  await render(server);
  await act(async () => button("Request new review").click());
  expect(button("Approve and connect").disabled).toBe(true);
});
it("does not use malformed runtime metadata to accept a changed review target", async () => {
  native.invoke.mockResolvedValue({
    ...review(),
    summary: {
      ...review().summary,
      user: "other-user",
      configuration: { digest: "not-a-digest", environment: [], shellKind: null, provenance: {} },
    },
  });
  await render({
    ...server,
    metadata: {
      ...server.metadata,
      sshInheritance: { groupId: "group-1", fields: ["user"], environment: false },
    },
  });
  expect(button("Approve and connect").disabled).toBe(true);
  expect(approve).not.toHaveBeenCalled();
});
