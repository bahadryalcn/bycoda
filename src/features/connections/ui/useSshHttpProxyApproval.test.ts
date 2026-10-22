// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSshHttpProxyApproval } from "./useSshHttpProxyApproval";
import type { SshHttpProxyRequest } from "../model/sshHttpProxyApproval";
const native = vi.hoisted(() => ({ approve: vi.fn(), revoke: vi.fn() }));
vi.mock("../model/sshHttpProxyApproval", async (importActual) => ({
  ...(await importActual<object>()),
  approveSshHttpProxy: native.approve,
  revokeSshHttpProxyApproval: native.revoke,
}));
const target: SshHttpProxyRequest = {
  connectionId: "server-1",
  endpoint: {
    host: "target.invalid",
    user: "alice",
    port: 22,
    httpProxy: { host: "proxy.invalid", port: 3128 },
  },
  operation: { kind: "terminal", id: "terminal-id" },
};
let root: Root, host: HTMLDivElement, api: ReturnType<typeof useSshHttpProxyApproval>;
function Harness() {
  const value = useSshHttpProxyApproval();
  useLayoutEffect(() => {
    api = value;
  });
  return value.dialog;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  native.revoke.mockResolvedValue(undefined);
  native.approve.mockResolvedValue({ ticketId: "one-ticket", expiresInSeconds: 30 });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const button = (name: string) => {
  const found = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === name || item.getAttribute("aria-label") === name,
  );
  if (!found)
    throw new Error(
      `Missing button ${name}: ${[...document.querySelectorAll("button")].map((item) => item.textContent).join(" | ")}`,
    );
  return found;
};
const field = (name: string) => {
  const label = [...document.querySelectorAll("label")].find(
    (item) => item.textContent?.trim() === name,
  )!;
  return document.getElementById(label.htmlFor) as HTMLInputElement;
};
async function input(label: string, value: string) {
  await act(async () => {
    const node = field(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function mount() {
  await act(async () => root.render(createElement(Harness)));
}
async function begin() {
  let promise: Promise<string | undefined | null>;
  await act(async () => {
    promise = api.request(target);
  });
  return { result: promise! };
}
async function credentials() {
  await act(async () => button("Basic").click());
  await input("Proxy username", "synthetic-user");
  await input("Proxy password", "synthetic-secret");
}
it("does nothing on mount/direct routes and requires an explicit anonymous choice for HTTP", async () => {
  await mount();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(native.approve).not.toHaveBeenCalled();
  expect(
    await api.request({ ...target, endpoint: { host: "direct.invalid", port: 22 } }),
  ).toBeUndefined();
  const pending = await begin();
  expect(document.body.textContent).toContain("HTTP CONNECT: proxy.invalid:3128");
  await act(async () => button("Continue without authentication").click());
  expect(await pending.result).toBeUndefined();
  expect(native.approve).not.toHaveBeenCalled();
});
it("requires Basic plaintext consent, dispatches once and clears the owned DOM inputs", async () => {
  await mount();
  const pending = await begin();
  await credentials();
  const user = field("Proxy username"),
    password = field("Proxy password");
  expect(button("Approve this operation").disabled).toBe(true);
  expect(native.approve).not.toHaveBeenCalled();
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  await act(async () => {
    button("Approve this operation").click();
    button("Approve this operation").click();
  });
  expect(await pending.result).toBe("one-ticket");
  expect(native.approve).toHaveBeenCalledExactlyOnceWith(
    target,
    "synthetic-user",
    "synthetic-secret",
    true,
  );
  expect(user.value).toBe("");
  expect(password.value).toBe("");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("cancels/unmounts without approval and refuses overlapping request replacement", async () => {
  await mount();
  const pending = await begin();
  expect(await api.request({ ...target, operation: { kind: "terminal", id: "other" } })).toBeNull();
  await credentials();
  const password = field("Proxy password");
  await act(async () => button("Cancel").click());
  expect(await pending.result).toBeNull();
  expect(password.value).toBe("");
  const second = await begin();
  await act(async () => root.render(null));
  expect(await second.result).toBeNull();
  expect(native.approve).not.toHaveBeenCalled();
});
it("discards a late approval after cancel rather than resolving a newer target request", async () => {
  let answer: (value: any) => void = () => {};
  native.approve.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  await mount();
  const old = await begin();
  await credentials();
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  await act(async () => button("Approve this operation").click());
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click(),
  );
  expect(await old.result).toBeNull();
  const current = await begin();
  await act(async () => answer({ ticketId: "old-ticket", expiresInSeconds: 30 }));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => button("Continue without authentication").click());
  expect(await current.result).toBeUndefined();
  expect(native.approve).toHaveBeenCalledOnce();
  expect(native.revoke).toHaveBeenCalledWith("old-ticket");
});
it("shows native stale-route errors with cleared credentials and requires explicit new input", async () => {
  native.approve.mockRejectedValueOnce(new Error("Proxy target changed"));
  await mount();
  const pending = await begin();
  await credentials();
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  await act(async () => button("Approve this operation").click());
  expect(document.body.textContent).toContain("Proxy target changed");
  expect(field("Proxy username").value).toBe("");
  expect(field("Proxy password").value).toBe("");
  expect(button("Approve this operation").disabled).toBe(true);
  await act(async () => button("Cancel").click());
  expect(await pending.result).toBeNull();
});

it("HTTPS Basic approval binds one runbook target and never grants plain HTTP consent", async () => {
  await mount();
  const request: SshHttpProxyRequest = {
    ...target,
    endpoint: {
      ...target.endpoint,
      httpProxy: { host: "secure.invalid", port: 443, scheme: "https" },
    },
    operation: {
      kind: "runbook",
      runId: "run",
      automationId: "book",
      revision: 3,
      reviewDigest: "a".repeat(64),
      serverId: "server",
    },
  };
  let pending: Promise<string | undefined | null>;
  await act(async () => {
    pending = api.request(request);
  });
  await credentials();
  expect(document.body.textContent).toContain("TLS-verified HTTPS proxy");
  expect(document.body.textContent).not.toContain("without TLS");
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  await act(async () => button("Approve this operation").click());
  expect(await pending!).toBe("one-ticket");
  expect(native.approve).toHaveBeenCalledExactlyOnceWith(
    request,
    "synthetic-user",
    "synthetic-secret",
    false,
  );
});

it("revokes a native grant that arrives after the entire approval surface unmounts", async () => {
  let answer: (value: any) => void = () => {};
  native.approve.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  await mount();
  const pending = await begin();
  await credentials();
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  await act(async () => button("Approve this operation").click());
  await act(async () => root.render(null));
  expect(await pending.result).toBeNull();
  await act(async () => answer({ ticketId: "late-unmounted", expiresInSeconds: 30 }));
  expect(native.revoke).toHaveBeenCalledExactlyOnceWith("late-unmounted");
});
