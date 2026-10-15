// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InterruptedNotice } from "./InterruptedNotice";
import { newSession, type Session } from "../model/session";
import { markTurnInterrupted } from "../model/inFlight";
import {
  claimAutoContinue,
  isAutoContinueDue,
  markAutoContinueDue,
  resetAutoContinueForTests,
} from "../model/autoContinue";
import { newTab } from "../../workspace/model/layout";
import { collectWorkspaceSnapshot } from "../../workspace/model/workspaceSnapshot";
import {
  captureSessionRecovery,
  isRecoverySessionHeld,
  setSessionRecovery,
} from "../../workspace/model/sessionRecovery";

let root: Root;
let container: HTMLDivElement;
let session: Session;
const onContinue = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetAutoContinueForTests();
  setSessionRecovery(null);
  onContinue.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  session = markTurnInterrupted({
    ...newSession("codex", "/project"),
    providerSessionId: "thread-1",
    blocks: [{ id: "prompt", role: "user", text: "Implement the feature" }],
    busy: true,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetAutoContinueForTests();
  setSessionRecovery(null);
  vi.unstubAllGlobals();
});

async function render(extra: Partial<Parameters<typeof InterruptedNotice>[0]> = {}) {
  await act(async () => {
    root.render(createElement(InterruptedNotice, { session, onContinue, ...extra }));
  });
}

it("offers manual continuation when recovery holds an automatic continuation", async () => {
  markAutoContinueDue(session.id);
  const tab = newTab(session.id);
  setSessionRecovery(
    captureSessionRecovery(
      null,
      collectWorkspaceSnapshot([tab], [session], tab.id, session.cwd, new Map()),
    ),
  );
  expect(isRecoverySessionHeld(session.id)).toBe(true);
  expect(isAutoContinueDue(session.id)).toBe(true);

  await render();
  const button = container.querySelector("button")!;
  expect(button).not.toBeNull();
  expect(button.disabled).toBe(false);
  await act(async () => button.click());

  expect(onContinue).toHaveBeenCalledOnce();
  expect(claimAutoContinue(session.id)).toBe(false);
});

it("keeps recovery available after an automatic claim did not start a turn", async () => {
  markAutoContinueDue(session.id);
  expect(claimAutoContinue(session.id)).toBe(true);
  await render();
  expect(container.querySelector("button")).not.toBeNull();
});

it("hides recovery once a new turn starts or the interrupt is no longer current", async () => {
  await render({ session: { ...session, busy: true } });
  expect(container.querySelector("button")).toBeNull();
  await render({
    session: {
      ...session,
      blocks: [...session.blocks, { id: "next", role: "user", text: "Continue" }],
    },
  });
  expect(container.querySelector("button")).toBeNull();
});

it("preserves host interruption authority and send restrictions", async () => {
  await render({ interruptedTurn: false });
  expect(container.querySelector("button")).toBeNull();
  await render({ interruptedTurn: true, blockedReason: "Host unavailable" });
  const button = container.querySelector("button")!;
  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  expect(onContinue).not.toHaveBeenCalled();
  await render({ session: { ...session, continuingElsewhere: true } });
  expect(container.querySelector("button")).toBeNull();
  await render({ session: { ...session, worktreeRemoved: true } });
  expect(container.querySelector("button")).toBeNull();
});
