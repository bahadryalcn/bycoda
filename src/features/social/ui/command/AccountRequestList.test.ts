// @vitest-environment happy-dom
import { openErrorDetails } from "../../../sessions/ui/errorDetails.fixture";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialAccountRequest } from "../../model/accountRequests";
import type { SocialClient } from "../../model/socialClient";
import { AccountRequestList } from "./AccountRequestList";

vi.mock("../../../../shared/ui/Modal", () => ({
  Modal: (props: { title: string; children: ReactNode; footer: ReactNode }) =>
    createElement(
      "div",
      { role: "dialog", "aria-label": props.title },
      props.children,
      props.footer,
    ),
  ModalActions: (props: { children: ReactNode }) => createElement("div", null, props.children),
}));

let element: HTMLDivElement, root: Root;
beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

const request: SocialAccountRequest = {
  id: "r1",
  projectId: "p1",
  projectName: "Acme site",
  platform: "linkedin",
  accountType: "organization",
  reason: "Launch posts need a company page.",
  requestedBy: { provider: "codex", actorId: "session:1" },
  status: "pending",
  createdAt: 2,
  updatedAt: 2,
};

function setup(items: SocialAccountRequest[] = [request]) {
  const client = {
    accountRequests: {
      list: vi.fn(async () => ({ items })),
      approve: vi.fn(async () => ({
        request: { ...request, status: "approved" },
        accountId: "acc-1",
      })),
      dismiss: vi.fn(async () => ({ ...request, status: "dismissed" })),
    },
    browserBegin: vi.fn(async () => ({ status: "waiting", expiresAt: 1 })),
    browserWorkflowBegin: vi.fn(async () => undefined),
    browserWorkflowStatus: vi.fn(async () => ({ available: true, reason: "", workflows: [] })),
  };
  return client;
}

async function render(client: ReturnType<typeof setup>, extra = {}) {
  const onNavigate = vi.fn();
  const onCountChange = vi.fn();
  await act(async () => {
    root.render(
      createElement(AccountRequestList, {
        client: client as unknown as SocialClient,
        onNavigate,
        onCountChange,
        ...extra,
      }),
    );
  });
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  return { onNavigate, onCountChange };
}

const button = (text: string) =>
  [...element.querySelectorAll("button")].find((node) => node.textContent === text);

it("lists only pending requests with platform and project and reports the count", async () => {
  const client = setup([request, { ...request, id: "r2", status: "dismissed" }]);
  const { onCountChange } = await render(client);
  expect(element.textContent).toContain("LinkedIn account");
  expect(element.textContent).toContain("Acme site");
  expect(element.querySelectorAll("li")).toHaveLength(1);
  expect(onCountChange).toHaveBeenLastCalledWith(1);
});

it("approves as create and opens the signup window at once, bound to the new account", async () => {
  const client = setup();
  await render(client);
  await act(async () => {
    button("Create account")?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  expect(client.accountRequests.approve).toHaveBeenCalledWith({ id: "r1", mode: "create" });
  expect(element.querySelector('[role="dialog"]')).not.toBeNull();
  expect(client.browserWorkflowBegin).toHaveBeenCalledTimes(1);
  expect(client.browserWorkflowBegin).toHaveBeenCalledWith(
    "acc-1",
    "signup",
    undefined,
    expect.anything(),
  );
});

it("starts the existing browser sign-in and opens the account when the owner already has one", async () => {
  const client = setup([{ ...request, accountType: "member" }]);
  const { onNavigate } = await render(client);
  await act(async () => button("I already have one")?.click());
  expect(client.accountRequests.approve).toHaveBeenCalledWith({ id: "r1", mode: "signin" });
  expect(client.browserBegin).toHaveBeenCalledWith("acc-1");
  expect(onNavigate).toHaveBeenCalledWith("accounts", { accountId: "acc-1" });
});

it("opens LinkedIn Page settings to select the Page before connecting", async () => {
  const client = setup();
  const { onNavigate } = await render(client);
  await act(async () => button("I already have one")?.click());
  expect(client.accountRequests.approve).toHaveBeenCalledWith({ id: "r1", mode: "signin" });
  expect(client.browserBegin).not.toHaveBeenCalled();
  expect(onNavigate).toHaveBeenCalledWith("accounts", { accountId: "acc-1" });
});

it("reopens the existing account's connection settings for a LinkedIn reconnect request", async () => {
  const client = setup([{ ...request, requestedAccountId: "acc-1" }]);
  const { onNavigate } = await render(client);
  expect(button("Create account")).toBeUndefined();
  await act(async () => button("Reconnect")?.click());
  expect(client.accountRequests.approve).toHaveBeenCalledWith({ id: "r1", mode: "signin" });
  expect(client.browserBegin).not.toHaveBeenCalled();
  expect(onNavigate).toHaveBeenCalledWith("accounts", { accountId: "acc-1" });
});

it("dismisses a request and shows a Host failure", async () => {
  const client = setup();
  await render(client);
  await act(async () => button("Dismiss")?.click());
  expect(client.accountRequests.dismiss).toHaveBeenCalledWith("r1");
  client.accountRequests.dismiss.mockRejectedValueOnce(new Error("Request is gone."));
  await act(async () => button("Dismiss")?.click());
  expect(element.textContent).toContain("The request could not be updated. Try again.");
  expect(openErrorDetails(element)).toContain("Request is gone.");
});

it("keeps a way to the approved account when the sign-in window cannot open", async () => {
  const client = setup([{ ...request, accountType: "member" }]);
  client.browserBegin = vi.fn(async () => {
    throw new Error("Install Chrome or Edge");
  });
  const { onNavigate } = await render(client);
  await act(async () => {
    button("I already have one")?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  expect(onNavigate).not.toHaveBeenCalled();
  expect(element.textContent).toContain("The sign-in window could not be opened.");
  await act(async () => button("Open account")?.click());
  expect(onNavigate).toHaveBeenCalledWith("accounts", { accountId: "acc-1" });
});
