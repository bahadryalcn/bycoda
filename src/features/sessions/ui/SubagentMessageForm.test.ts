// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SubagentMessageForm, type SubagentRelay } from "./SubagentMessageForm";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function relay(overrides: Partial<SubagentRelay> = {}): SubagentRelay {
  return {
    draft: "Check the tests",
    setDraft: vi.fn(),
    send: vi.fn(),
    ...overrides,
  };
}

function render(props: SubagentRelay) {
  act(() => root.render(createElement(SubagentMessageForm, { name: "Reviewer", relay: props })));
  return container;
}

function buttonLabels() {
  return [...container.querySelectorAll("button")].map((button) => button.textContent?.trim());
}

it("names the message box after the agent and sends through the relay by default", () => {
  const send = vi.fn();
  render(relay({ send }));
  expect(container.textContent).toContain("Message for Reviewer");
  expect(buttonLabels()).toContain("Relay via main agent");
  expect(buttonLabels()).not.toContain("Send");
  act(() =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })),
  );
  expect(send).toHaveBeenCalledOnce();
});

it("uses direct copy for a delegated child: Send, Open conversation, and the direct hint", () => {
  render(relay({ mode: "direct", onOpenConversation: vi.fn() }));
  expect(buttonLabels()).toContain("Send");
  expect(buttonLabels()).toContain("Open conversation");
  expect(buttonLabels()).not.toContain("Relay via main agent");
  expect(buttonLabels()).not.toContain("Open main conversation");
  expect(container.textContent).not.toContain("Via the main agent");
});

it("keeps the relay copy for native subagents, including Open main conversation", () => {
  render(relay({ onOpenConversation: vi.fn() }));
  expect(buttonLabels()).toContain("Open main conversation");
  expect(buttonLabels()).not.toContain("Open conversation");
  expect(buttonLabels()).toContain("Relay via main agent");
});

it("reports acceptance honestly for each route", () => {
  render(relay({ mode: "direct", status: "accepted" }));
  expect(container.textContent).toContain(
    "Message accepted. It goes to this agent as its next input.",
  );
  render(relay({ status: "accepted" }));
  expect(container.textContent).toContain(
    "Request added to the main conversation. Delivery is not yet confirmed.",
  );
  expect(container.textContent).not.toContain("Message accepted.");
});

it("keeps the draft and says so when a send was rejected", () => {
  render(relay({ mode: "direct", status: "rejected" }));
  expect(container.textContent).toContain(
    "Request was not accepted. Your message is kept here; try again.",
  );
});

it("shows the open error and keeps the form usable", () => {
  render(relay({ mode: "direct", onOpenConversation: vi.fn(), openError: "Session is gone" }));
  expect(container.textContent).toContain("Session is gone");
  expect(buttonLabels()).toContain("Send");
});

it("disables Send for an empty draft or a blocked child", () => {
  render(relay({ mode: "direct", draft: "   " }));
  expect(buttonLabels()).toContain("Send");
  const send = [...container.querySelectorAll("button")].find((b) => b.textContent === "Send");
  expect(send?.disabled).toBe(true);

  render(relay({ mode: "direct", blockedReason: "The child session is not ready." }));
  expect(container.textContent).toContain("The child session is not ready.");
  const blocked = [...container.querySelectorAll("button")].find((b) => b.textContent === "Send");
  expect(blocked?.disabled).toBe(true);
});
