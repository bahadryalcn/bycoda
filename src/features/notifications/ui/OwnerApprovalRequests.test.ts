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
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => root.render(render(false)));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Command: pwd");
    await act(async () => {
      (document.querySelector("[data-confirm-cancel]") as HTMLButtonElement).click();
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
