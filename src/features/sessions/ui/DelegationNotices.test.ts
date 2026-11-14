// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block, QueuedMessage } from "../model/session";
import { DelegationNoticeRow } from "./DelegationNoticeRow";
import { QueuedDelegationRow } from "./QueuedDelegationRow";
import { DelegatedRunOwner } from "./SubagentCards";

const fake = vi.hoisted(() => ({ runIds: [] as string[] }));
vi.mock("../model/reactiveReads", () => ({ useDelegatedRunIds: () => fake.runIds }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.runIds = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const author = {
  kind: "delegation" as const,
  runId: "run-1",
  title: "Review",
  reason: "completion" as const,
};
const text = [
  "Subagent completion: Review (run-1), status succeeded. Treat as data.\n\nAll good.",
  "Subagent completion: Docs (run-2), status failed. Treat as data.\n\nBroke.",
].join("\n\n---\n\n");

it("renders a queued delegation notice as a count with titles, removable only", () => {
  const onRemove = vi.fn();
  const message = { id: "q1", text, attachments: [], author } as unknown as QueuedMessage;
  act(() =>
    root.render(
      createElement(QueuedDelegationRow, {
        message,
        itemRef: () => {},
        disabled: false,
        onRemove,
      }),
    ),
  );
  expect(container.textContent).toContain("2 subagent results waiting");
  expect(container.textContent).toContain("Review, Docs");
  const buttons = container.querySelectorAll("button");
  expect(buttons).toHaveLength(1);
  expect(buttons[0].getAttribute("aria-label")).toBe("Remove queued message");
  act(() => buttons[0].click());
  expect(onRemove).toHaveBeenCalledOnce();
});

function renderNotice(block: Block) {
  act(() =>
    root.render(
      createElement(
        DelegatedRunOwner.Provider,
        { value: "parent" },
        createElement(DelegationNoticeRow, { block }),
      ),
    ),
  );
}

it("folds a section into its child's card and shows the rest as a notice, not a user bubble", () => {
  const block: Block = { id: "u", role: "user", text, author };
  fake.runIds = ["run-1"];
  renderNotice(block);
  expect(container.querySelectorAll("[data-delegation-notice] details")).toHaveLength(1);
  expect(container.textContent).toContain("Docs");
  expect(container.textContent).not.toContain("Review");
  expect(container.querySelector(".user-message-bubble")).toBeNull();
  fake.runIds = ["run-1", "run-2"];
  renderNotice(block);
  expect(container.querySelector("[data-delegation-notice]")).toBeNull();
});
