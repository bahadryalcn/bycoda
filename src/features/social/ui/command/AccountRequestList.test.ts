// @vitest-environment happy-dom
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
    browserWorkflowBegin: vi.fn(),
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

it("approves as create and opens signup bound to the new account", async () => {
  const client = setup();
  await render(client);
  await act(async () => button("Create account")?.click());
  expect(client.accountRequests.approve).toHaveBeenCalledWith({ id: "r1", mode: "create" });
  expect(element.querySelector('[role="dialog"]')).not.toBeNull();
  const open = [...element.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("Open sign-up window"),
  );
  await act(async () => open?.click());
  expect(client.browserWorkflowBegin).toHaveBeenCalledWith(
    "acc-1",
    "signup",
    undefined,
    expect.anything(),
  );
});

it("starts the existing browser sign-in and opens the account when the owner already has one", async () => {
  const client = setup();
  const { onNavigate } = await render(client);
  await act(async () => button("I already have one")?.click());
  expect(client.accountRequests.approve).toHaveBeenCalledWith({ id: "r1", mode: "signin" });
  expect(client.browserBegin).toHaveBeenCalledWith("acc-1");
  expect(onNavigate).toHaveBeenCalledWith("accounts", { accountId: "acc-1" });
});

it("dismisses a request and shows a Host failure", async () => {
  const client = setup();
  await render(client);
  await act(async () => button("Dismiss")?.click());
  expect(client.accountRequests.dismiss).toHaveBeenCalledWith("r1");
  client.accountRequests.dismiss.mockRejectedValueOnce(new Error("Request is gone."));
  await act(async () => button("Dismiss")?.click());
  expect(element.textContent).toContain("Request is gone.");
});
