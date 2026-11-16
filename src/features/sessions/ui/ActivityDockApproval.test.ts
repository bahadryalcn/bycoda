// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Block, type Session } from "../model/session";
import { ActivityDock } from "./ActivityDock";
import { ApprovalDecisionProvider } from "./ApprovalDecisionContext";
import { useReportApprovalCardOnScreen } from "./approvalCardVisibility";

let container: HTMLDivElement;
let root: Root;
let intersect: ((visible: boolean) => void) | undefined;

const blocks: Block[] = [
  { id: "u1", role: "user", text: "go", startedAt: 1_000 },
  {
    id: "approval",
    role: "tool",
    text: "Run pnpm test",
    tool: { kind: "shell", status: "pending" },
    approval: { requestId: 7 },
  },
];
const session: Session = { ...newSession("claude", "/repo"), id: "s1", busy: true, blocks };

function Card() {
  const ref = useReportApprovalCardOnScreen<HTMLDivElement>("s1", 7);
  return createElement("div", { ref, className: "agent-transcript-card" });
}

function render(dispatch: () => void, card = false) {
  act(() =>
    root.render(
      createElement(ApprovalDecisionProvider, {
        session,
        dispatch,
        children: [
          card ? createElement(Card, { key: "card" }) : null,
          createElement(ActivityDock, {
            key: "dock",
            sessionId: "s1",
            blocks,
            busy: true,
            pendingQuestion: false,
            atEnd: true,
            onOpenAgent: () => {},
          }),
        ],
      }),
    ),
  );
}

const dockButtons = () =>
  [...container.querySelectorAll("[data-dock-approval] button")].map((b) => b.textContent);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        intersect = (visible) => callback([{ isIntersecting: visible }]);
      }
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  intersect = undefined;
  vi.unstubAllGlobals();
});

it("offers Deny and Allow in the dock and sends the decision for the pending request", async () => {
  const dispatch = vi.fn();
  render(dispatch);
  expect(dockButtons()).toEqual(["Deny", "Allow"]);
  const allow = container.querySelector<HTMLButtonElement>(
    '[data-dock-approval] [data-button-variant="primary"]',
  )!;
  await act(async () => allow.click());
  expect(dispatch.mock.calls[0]?.slice(0, 3)).toEqual(["s1", 7, "allow"]);
});

it("steps aside while the transcript's approval card is on screen", () => {
  render(vi.fn(), true);
  expect(dockButtons()).toEqual(["Deny", "Allow"]);
  act(() => intersect!(true));
  expect(dockButtons()).toEqual([]);
  act(() => intersect!(false));
  expect(dockButtons()).toEqual(["Deny", "Allow"]);
});
