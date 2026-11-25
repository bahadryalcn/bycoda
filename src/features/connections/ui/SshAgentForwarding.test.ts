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
// A disabled control that explains why stays focusable: it is aria-disabled, not `disabled`.
const blocked = (element: HTMLButtonElement) =>
  element.disabled || element.getAttribute("aria-disabled") === "true";
it("reviews the explicit current target and approves exactly once without saving permissions", async () => {
  await render();
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("ssh_agent_forwarding_review", {
    connectionId: server.id,
  });
  expect(approve).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("alice@server.invalid:22");
  expect(document.body.textContent).toContain(
    "remote target can use identities from your SSH agent",
  );
  const action = button("Approve and connect");
  expect(blocked(action)).toBe(false);
  await act(async () => {
    action.click();
    action.click();
  });
  expect(approve).toHaveBeenCalledExactlyOnceWith(server, "one-use-review");
  expect(close).toHaveBeenCalledOnce();
  expect(native.invoke).toHaveBeenCalledTimes(1);
});
/** The raw text behind the alert's Details link: opens it, reads the page, closes it again. */
const detailsText = async () => {
  const trigger = [...document.querySelectorAll("button")].find(
    (entry) => entry.textContent === "Details",
  )!;
  await act(async () => trigger.click());
  const text = document.body.textContent ?? "";
  await act(async () => trigger.click());
  return text;
};
it("replaces an expired review with a fresh one, never approving on its own", async () => {
  vi.useFakeTimers();
  await render();
  // Built at call time: the replacement expires 30 s after the moment it is read.
  native.invoke.mockImplementation(async () => ({ ...review(), reviewId: "new-review" }));
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(native.invoke).toHaveBeenCalledTimes(2);
  expect(approve).not.toHaveBeenCalled();
  expect(blocked(button("Approve and connect"))).toBe(false);
  await act(async () => button("Approve and connect").click());
  expect(approve).toHaveBeenCalledExactlyOnceWith(server, "new-review");
  expect(vi.getTimerCount()).toBe(0);
});
it("reviews a changed endpoint again and approves only what the native side returned for it", async () => {
  await render();
  const changed = { ...server, sshEndpoint: { ...server.sshEndpoint!, host: "other.invalid" } };
  // The first answer still names the old host, so the changed target is rejected with one error.
  await render(changed);
  expect(native.invoke).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not review the SSH agent target.",
  );
  expect(await detailsText()).toContain("Agent forwarding target changed.");
  expect(blocked(button("Approve and connect"))).toBe(true);
  await act(async () => button("Approve and connect").click());
  expect(approve).not.toHaveBeenCalled();
  native.invoke.mockResolvedValue({
    ...review(),
    summary: { ...review().summary, host: "other.invalid" },
  });
  await act(async () => button("Retry").click());
  await act(async () => button("Approve and connect").click());
  expect(approve).toHaveBeenCalledWith(changed, "one-use-review");
});
it("rejects unavailable, malformed or mismatched native targets with one error and Retry", async () => {
  native.invoke.mockResolvedValue({
    ...review(),
    summary: { ...review().summary, host: "wrong.invalid" },
  });
  await render();
  expect(blocked(button("Approve and connect"))).toBe(true);
  expect(await detailsText()).toContain("target changed");
  native.invoke.mockResolvedValue({ ...review(), agentAvailable: false });
  await act(async () => button("Retry").click());
  expect(blocked(button("Approve and connect"))).toBe(true);
  expect(approve).not.toHaveBeenCalled();
  native.invoke.mockRejectedValue(new Error("Agent forwarding through jumps is unavailable"));
  await act(async () => button("Retry").click());
  expect(await detailsText()).toContain("through jumps");
  expect(approve).not.toHaveBeenCalled();
  native.invoke.mockResolvedValue({ reviewId: "malformed" });
  await act(async () => button("Retry").click());
  expect(blocked(button("Approve and connect"))).toBe(true);
  expect(await detailsText()).toContain("review is unavailable");
});
it("ignores late answers after target changes or unmount", async () => {
  let finish!: (value: unknown) => void;
  native.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  expect(blocked(button("Approve and connect"))).toBe(true);
  expect(native.invoke).toHaveBeenCalledTimes(1);
  await render({ ...server, id: "replacement" });
  expect(native.invoke).toHaveBeenCalledTimes(2);
  await act(async () => finish(review()));
  expect(blocked(button("Approve and connect"))).toBe(false);
  await act(async () => root.unmount());
  await act(async () => finish(review()));
  expect(approve).not.toHaveBeenCalled();
  root = createRoot(host);
});

it("shows the current HTTP upstream in the review and reviews again if its profile changes", async () => {
  const proxy = {
    ...server,
    sshEndpoint: { ...server.sshEndpoint!, httpProxy: { host: "proxy.invalid", port: 3128 } },
  };
  await render(proxy);
  expect(document.body.textContent).toContain("HTTP CONNECT: proxy.invalid:3128");
  expect(blocked(button("Approve and connect"))).toBe(false);
  await render({
    ...proxy,
    sshEndpoint: { ...proxy.sshEndpoint, httpProxy: { host: "other-proxy.invalid", port: 3128 } },
  });
  expect(native.invoke).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain("HTTP CONNECT: other-proxy.invalid:3128");
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
  expect(blocked(button("Approve and connect"))).toBe(false);
  expect(document.body.textContent).toContain("group-user@server.invalid:2222");
  expect(document.body.textContent).toContain("APP_STAGE=prod");
  await render({
    ...inherited,
    metadata: {
      ...inherited.metadata,
      sshInheritance: { ...inherited.metadata.sshInheritance, environment: false },
    },
  });
  expect(native.invoke).toHaveBeenCalledTimes(2);
  expect(blocked(button("Approve and connect"))).toBe(false);
  await render(server);
  expect(native.invoke).toHaveBeenCalledTimes(3);
  expect(blocked(button("Approve and connect"))).toBe(true);
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
  expect(blocked(button("Approve and connect"))).toBe(true);
  expect(approve).not.toHaveBeenCalled();
});
