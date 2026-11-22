// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SubagentMessageForm, type SubagentRelay } from "./SubagentMessageForm";
import { SubagentChatComposer } from "./SubagentMessageForm";
import { newSession, type Attachment } from "../model/session";

const ownerComposer = vi.hoisted(() => ({ props: undefined as unknown }));
vi.mock("./Composer", () => ({
  Composer: (props: unknown) => {
    ownerComposer.props = props;
    return null;
  },
}));

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

it("uses direct copy for a delegated child: Send, Open session, and the direct hint", () => {
  render(relay({ mode: "direct", onOpenConversation: vi.fn() }));
  expect(buttonLabels()).toContain("Send");
  expect(buttonLabels()).toContain("Open session");
  expect(buttonLabels()).not.toContain("Relay via main agent");
  expect(buttonLabels()).not.toContain("Open main conversation");
  expect(container.textContent).not.toContain("Via the main agent");
});

it("keeps native relay controls without a redundant link to the already open main conversation", () => {
  render(relay({ onOpenConversation: vi.fn() }));
  expect(buttonLabels()).not.toContain("Open main conversation");
  expect(buttonLabels()).not.toContain("Open session");
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

it("announces the Ctrl/Cmd+Enter send shortcut on the message box", () => {
  render(relay({ mode: "direct" }));
  const message = container.querySelector("textarea")!;
  expect(message.getAttribute("aria-keyshortcuts")).toBe("Control+Enter Meta+Enter");
});

it("shows the shared Mod+Enter hint on the send button in both routes", () => {
  render(relay({ mode: "direct" }));
  const send = [...container.querySelectorAll("button")].find((b) => b.textContent === "Send")!;
  expect(send.hasAttribute("data-tooltip-owner")).toBe(true);

  render(relay());
  const relayButton = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Relay via main agent",
  )!;
  expect(relayButton.hasAttribute("data-tooltip-owner")).toBe(true);
});

it("leaves Enter to insert a newline; Ctrl/Cmd+Enter sends only outside IME composition", () => {
  const send = vi.fn();
  const setDraft = vi.fn();
  render(relay({ mode: "direct", send, setDraft }));
  const message = container.querySelector("textarea")!;

  act(() => {
    message.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  expect(send).not.toHaveBeenCalled();

  act(() => {
    message.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(send).toHaveBeenCalledOnce();

  act(() => {
    message.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(send).toHaveBeenCalledOnce();
  expect(setDraft).not.toHaveBeenCalled();
});

it("uses the normal composer and keeps direct Steer, Queue and attachments on the child", () => {
  const session = { ...newSession("codex", "/project"), id: "child", busy: true };
  const onSubmit = vi.fn(() => true);
  act(() =>
    root.render(
      createElement(SubagentChatComposer, {
        name: "Reviewer",
        session,
        visible: true,
        remoteSession: true,
        remoteFeatures: { attachments: true, plan: false, draft: false, steer: true },
        onSubmit,
      }),
    ),
  );
  const props = ownerComposer.props as import("react").ComponentProps<
    typeof import("./Composer").Composer
  >;
  expect(props).toMatchObject({
    sessionId: "child",
    enabled: true,
    busy: true,
    hideIdentityControls: true,
    remoteFeatures: { attachments: true, steer: true },
  });
  expect(props.compact).not.toBe(true);
  const attachments: Attachment[] = [
    {
      id: "image",
      name: "proof.png",
      kind: "image",
      mimeType: "image/png",
      size: 16,
      path: "/project/proof.png",
    },
  ];
  props.onSubmit("$review", attachments, { followUpBehavior: "steer" });
  props.onSubmit("When done", attachments, { followUpBehavior: "queue" });
  expect(onSubmit.mock.calls).toEqual([
    ["$review", attachments, { followUpBehavior: "steer" }],
    ["When done", attachments, { followUpBehavior: "queue" }],
  ]);
});
