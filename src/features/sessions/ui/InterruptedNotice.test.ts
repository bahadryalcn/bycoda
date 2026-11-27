// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InterruptedNotice, isOwnerStoppedLatestTurn } from "./InterruptedNotice";
import { setLanguagePreference } from "../../../shared/i18n";
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
import { captureSessionRecovery, setSessionRecovery } from "../../workspace/model/sessionRecovery";

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
  await setLanguagePreference("en");
});

it("localizes both local and hosted recovery explanations when the language changes", async () => {
  await act(async () => setLanguagePreference("en"));
  await render();
  expect(container.textContent).toContain("This turn was cut off when bycoda quit.");
  await act(async () => setLanguagePreference("tr"));
  expect(container.textContent).toContain("bycoda kapandığında bu tur kesintiye uğradı.");
  await render({ message: "The host stopped this turn before it finished." });
  expect(container.textContent).toContain("Host bu turu tamamlanmadan durdurdu.");
  expect(container.textContent).not.toContain("The host stopped");
});

async function render(extra: Partial<Parameters<typeof InterruptedNotice>[0]> = {}) {
  await act(async () => {
    root.render(createElement(InterruptedNotice, { session, onContinue, ...extra }));
  });
}

it("offers manual continuation while an automatic continuation is still pending", async () => {
  markAutoContinueDue(session.id);
  const tab = newTab(session.id);
  setSessionRecovery(
    captureSessionRecovery(
      null,
      collectWorkspaceSnapshot([tab], [session], tab.id, session.cwd, new Map()),
    ),
  );
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
  // A disabled action with a reason stays focusable: aria-disabled, presses swallowed.
  expect(button.getAttribute("aria-disabled")).toBe("true");
  await act(async () => button.click());
  expect(onContinue).not.toHaveBeenCalled();
  await render({ session: { ...session, continuingElsewhere: true } });
  expect(container.querySelector("button")).toBeNull();
  await render({ session: { ...session, worktreeRemoved: true } });
  expect(container.querySelector("button")).toBeNull();
});

const stoppedSession = (): Session => ({
  ...newSession("codex", "/project"),
  providerSessionId: "thread-1",
  blocks: [
    { id: "prompt", role: "user", text: "Refactor it", turnOutcome: "stopped", turnStoppedAt: 1 },
    { id: "partial", role: "assistant", text: "Starting" },
  ],
});

it("offers Continue after the owner pressed Stop on the latest turn", async () => {
  const stopped = stoppedSession();
  expect(isOwnerStoppedLatestTurn(stopped)).toBe(true);
  await render({ session: stopped });
  expect(container.querySelector("[data-owner-stopped]")).not.toBeNull();
  expect(container.textContent).toContain("You stopped this turn");
  await act(async () => container.querySelector("button")!.click());
  expect(onContinue).toHaveBeenCalledOnce();
});

it("stops showing the stopped notice once another turn starts or runs", () => {
  const stopped = stoppedSession();
  expect(isOwnerStoppedLatestTurn({ ...stopped, busy: true })).toBe(false);
  expect(
    isOwnerStoppedLatestTurn({
      ...stopped,
      blocks: [...stopped.blocks, { id: "next", role: "user", text: "Continue" }],
    }),
  ).toBe(false);
  // A steer or answer continues the stopped turn rather than starting a new one.
  expect(
    isOwnerStoppedLatestTurn({
      ...stopped,
      blocks: [
        ...stopped.blocks,
        { id: "steer", role: "user", text: "Also", continuationOf: "prompt" },
      ],
    }),
  ).toBe(true);
  expect(isOwnerStoppedLatestTurn({ ...stopped, worktreeRemoved: true })).toBe(false);
});

it("shows the stopped notice without Continue when there is no provider thread to resume", async () => {
  await render({ session: { ...stoppedSession(), providerSessionId: undefined } });
  expect(container.textContent).toContain("You stopped this turn");
  expect(container.querySelector("button")).toBeNull();
});
