// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { OwnerApprovalChat, OwnerApprovalInbox } from "./OwnerApprovalRequests";
import {
  ownerApprovalsSnapshot,
  requestOwnerApproval,
  settleOwnerApproval,
} from "../model/ownerApprovals";
import {
  ownerSecretInputsSnapshot,
  requestOwnerSecretInput,
  cancelOwnerSecretInput,
} from "../model/ownerSecretInputs";

it("shows a source request inside its chat and moves it into the shared dialog when hidden", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const render = (visible: boolean) =>
    createElement(
      "div",
      {},
      createElement(OwnerApprovalChat, {
        sessionId: "source",
        visible,
        children: createElement("p", {}, "Conversation"),
      }),
      createElement(OwnerApprovalInbox),
    );
  try {
    await act(async () => root.render(render(true)));
    let answer!: Promise<boolean>;
    await act(async () => {
      answer = requestOwnerApproval({
        id: "ui-request",
        sessionId: "source",
        input: {
          title: "SSH command approval",
          message: "Exact saved target\nCommand: pwd",
          confirmLabel: "Approve",
          cancelLabel: "Cancel",
          deadline: Date.now() + 60_000,
        },
      });
    });
    expect(element.querySelector("section")?.textContent).toContain("Command: pwd");
    const column = element.querySelector("[data-chat-column]");
    expect(column?.className).toContain("max-w-4xl");
    expect(column?.querySelector('[data-variant="card"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => root.render(render(false)));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Command: pwd");
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
        .find((button) => button.textContent?.trim() === "Cancel")!
        .click();
    });
    expect(await answer).toBe(false);
  } finally {
    for (const request of ownerApprovalsSnapshot()) settleOwnerApproval(request.id, false);
    await act(async () => root.unmount());
    element.remove();
  }
});

it("keeps global consent out of a transcript without an original session identity", async () => {
  const element = document.createElement("div");
  const root = createRoot(element);
  let answer!: Promise<boolean>;
  try {
    await act(async () =>
      root.render(createElement(OwnerApprovalChat, { children: "Draft conversation" })),
    );
    await act(async () => {
      answer = requestOwnerApproval({
        id: "unbound",
        input: {
          title: "File access",
          message: "Exact global consent",
          confirmLabel: "Allow",
          cancelLabel: "Cancel",
          deadline: Date.now() + 60_000,
        },
      });
    });
    expect(element.querySelector("section")).toBeNull();
    await act(async () => settleOwnerApproval("unbound", false));
    expect(await answer).toBe(false);
  } finally {
    for (const request of ownerApprovalsSnapshot()) settleOwnerApproval(request.id, false);
    await act(async () => root.unmount());
  }
});

it("shows an Inbox review as its line comments in a dialog the owner can approve", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  let answer!: Promise<boolean>;
  try {
    await act(async () => root.render(createElement(OwnerApprovalInbox)));
    await act(async () => {
      answer = requestOwnerApproval({
        id: "inbox-review",
        sessionId: "hidden",
        input: {
          title: "Inbox operation approval",
          message: "Exact native text",
          confirmLabel: "Approve this operation",
          cancelLabel: "Cancel",
          deadline: Date.now() + 60_000,
          details: {
            kind: "inbox",
            action: "review",
            project: "/repo",
            provider: "github",
            target: "acme/app #12",
            review: {
              event: "COMMENT",
              commitId: "a".repeat(40),
              body: "Summary",
              comments: [
                { path: "src/chart.tsx", line: 57, side: "RIGHT", body: "Tolerance mismatch" },
              ],
            },
          },
        },
      });
    });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('[aria-label="Line comments"]')?.textContent).toContain(
      "Tolerance mismatch",
    );
    expect(dialog.textContent).toContain("L57");
    await act(async () => {
      [...dialog.querySelectorAll("button")]
        .find((button) => button.textContent === "Approve this operation")!
        .click();
    });
    expect(await answer).toBe(true);
  } finally {
    for (const request of ownerApprovalsSnapshot()) settleOwnerApproval(request.id, false);
    await act(async () => root.unmount());
    element.remove();
  }
});

it("approves an Inbox request from the chat directly, with Review opening the full view", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  let answer!: Promise<boolean>;
  try {
    await act(async () =>
      root.render(createElement(OwnerApprovalChat, { sessionId: "chat", children: "Chat" })),
    );
    await act(async () => {
      answer = requestOwnerApproval({
        id: "inline-inbox",
        sessionId: "chat",
        input: {
          title: "Inbox operation approval",
          message: "Exact native text",
          confirmLabel: "Approve this operation",
          cancelLabel: "Cancel",
          deadline: Date.now() + 60_000,
          details: {
            kind: "inbox",
            action: "comment",
            project: "/repo",
            provider: "github",
            target: "acme/app #12",
            body: "Thanks",
          },
        },
      });
    });
    const button = (label: string) =>
      [...document.querySelectorAll("button")].filter((item) => item.textContent === label);
    await act(async () => button("Review")[0]!.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => button("Approve this operation")[0]!.click());
    expect(await answer).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    for (const request of ownerApprovalsSnapshot()) settleOwnerApproval(request.id, false);
    await act(async () => root.unmount());
    element.remove();
  }
});

const closers = {
  Escape: () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  backdrop: () =>
    document
      .querySelector("[data-modal-layer]")!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })),
};

for (const [name, close] of Object.entries(closers)) {
  it(`defers an off-screen approval on ${name} and lets the owner reopen it`, async () => {
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    let answer!: Promise<boolean>;
    let settled = false;
    try {
      await act(async () => root.render(createElement(OwnerApprovalInbox)));
      await act(async () => {
        answer = requestOwnerApproval({
          id: `defer-${name}`,
          input: {
            title: "File access",
            message: "Exact global consent",
            confirmLabel: "Allow",
            cancelLabel: "Cancel",
            deadline: Date.now() + 60_000,
          },
        });
        void answer.then(() => (settled = true));
      });
      await act(async () => close());
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(settled).toBe(false);
      expect(ownerApprovalsSnapshot()).toHaveLength(1);
      const reopen = element.querySelector<HTMLButtonElement>("[data-owner-request-reopen]");
      expect(reopen).not.toBeNull();
      await act(async () => reopen!.click());
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        "Exact global consent",
      );
      await act(async () => {
        [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
          .find((button) => button.textContent?.trim() === "Cancel")!
          .click();
      });
      expect(await answer).toBe(false);
    } finally {
      for (const request of ownerApprovalsSnapshot()) settleOwnerApproval(request.id, false);
      await act(async () => root.unmount());
      element.remove();
    }
  });

  it(`defers an off-screen secret request on ${name} instead of cancelling it`, async () => {
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    let settled = false;
    try {
      await act(async () => root.render(createElement(OwnerApprovalInbox)));
      await act(async () => {
        void requestOwnerSecretInput({
          id: `secret-${name}`,
          input: {
            title: "Secret request",
            message: "Synthetic request",
            fieldLabel: "Credential",
            confirmLabel: "Save",
            cancelLabel: "Cancel",
            deadline: Date.now() + 60_000,
          },
        }).then(() => (settled = true));
      });
      await act(async () => close());
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(settled).toBe(false);
      expect(ownerSecretInputsSnapshot()).toHaveLength(1);
      await act(async () =>
        element.querySelector<HTMLButtonElement>("[data-owner-request-reopen]")!.click(),
      );
      expect(document.querySelector('[role="dialog"] input')).not.toBeNull();
    } finally {
      for (const request of ownerSecretInputsSnapshot()) cancelOwnerSecretInput(request.id);
      await act(async () => root.unmount());
      element.remove();
    }
  });
}
