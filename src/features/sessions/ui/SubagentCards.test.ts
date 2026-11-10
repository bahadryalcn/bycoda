// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CREW_MEMBER_KEY,
  DELEGATION_PARENT_KEY,
} from "../../../shared/model/host-contracts/delegation";
import { delegatedCardBlock } from "../model/delegatedCards";
import { newSession, type Session } from "../model/session";
import { DelegatedRunOwner, SubagentRow } from "./SubagentCards";

const fake = vi.hoisted(() => ({
  open: vi.fn(),
  stop: vi.fn(() => Promise.resolve()),
  child: undefined as unknown,
}));

vi.mock("../model/sessionsStore", () => ({ useSession: () => fake.child }));
vi.mock("./delegatedFocus", () => ({
  requestViewDelegated: fake.open,
  stopDelegated: fake.stop,
}));

let container: HTMLDivElement;
let root: Root;

function child(busy: boolean): Session {
  return {
    ...newSession("codex", "/repo", "codex:gpt-a"),
    id: "child-1",
    title: "Review the parser",
    busy,
    modelSettings: {
      [DELEGATION_PARENT_KEY]: JSON.stringify({
        parentSessionId: "parent-1",
        runId: "ask_1",
        kind: "subagent",
        model: "codex:gpt-a",
        startedAt: 1,
      }),
      [CREW_MEMBER_KEY]: JSON.stringify({ id: "m1", name: "Reviewer", handle: "reviewer" }),
    },
  };
}

function render(session: Session) {
  fake.child = session;
  act(() => {
    root.render(
      createElement(
        DelegatedRunOwner.Provider,
        { value: "parent-1" },
        createElement(SubagentRow, { block: delegatedCardBlock(session) }),
      ),
    );
  });
}

beforeEach(() => {
  fake.open.mockClear();
  fake.stop.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("shows the member's identity, task and status, and opens the child", () => {
  render(child(true));
  const text = container.textContent ?? "";
  expect(text).toContain("Reviewer");
  expect(text).toContain("@reviewer");
  expect(text).toContain("Review the parser");
  expect(text).toContain("Running");
  const open = container.querySelector<HTMLButtonElement>('button[aria-label^="Open Reviewer"]');
  act(() => open?.click());
  expect(fake.open).toHaveBeenCalledWith("parent-1", "child-1");
});

it("stops a running member and offers no Stop once it is done", () => {
  render(child(true));
  const stop = container.querySelector<HTMLButtonElement>('button[aria-label="Stop Reviewer"]');
  act(() => stop?.click());
  expect(fake.stop).toHaveBeenCalledWith("parent-1", "child-1");
  render(child(false));
  expect(container.querySelector('button[aria-label^="Stop"]')).toBeNull();
  expect(container.textContent).toContain("Done");
});
