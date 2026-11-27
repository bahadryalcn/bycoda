// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  markAutoContinueDue,
  resetAutoContinueForTests,
} from "../../../features/sessions/model/autoContinue";
import { CONTINUE_PROMPT, markTurnInterrupted } from "../../../features/sessions/model/inFlight";
import { newSession, type Session } from "../../../features/sessions/model/session";
import { newTab } from "../../../features/workspace/model/layout";
import {
  captureSessionRecovery,
  setSessionRecovery,
} from "../../../features/workspace/model/sessionRecovery";
import { collectWorkspaceSnapshot } from "../../../features/workspace/model/workspaceSnapshot";
import { useAutoContinue } from "./useAutoContinue";

vi.mock("../../../integrations/harness", () => ({ isLiveHarness: () => true }));

let root: Root;
let session: Session;
const onSubmit = vi.fn();

function Harness({ sessions }: { sessions: Session[] }) {
  useAutoContinue({
    sessions,
    sessionsRef: { current: sessions },
    windowTransferPending: false,
    windowTransferPendingRef: { current: false },
    movingSessionIds: { current: new Set() },
    onSubmit,
  });
  return null;
}

async function render() {
  await act(async () => {
    root.render(createElement(Harness, { sessions: [session] }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetAutoContinueForTests();
  setSessionRecovery(null);
  onSubmit.mockReset();
  root = createRoot(document.createElement("div"));
  session = markTurnInterrupted({
    ...newSession("codex", "/project"),
    providerSessionId: "thread-1",
    blocks: [{ id: "prompt", role: "user", text: "Implement the feature" }],
    busy: true,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  resetAutoContinueForTests();
  setSessionRecovery(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("sends Continue for a due chat that this launch also listed in recovery", async () => {
  const tab = newTab(session.id);
  setSessionRecovery(
    captureSessionRecovery(
      null,
      collectWorkspaceSnapshot([tab], [session], tab.id, session.cwd, new Map()),
    ),
  );
  markAutoContinueDue(session.id);

  await render();

  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(session.id, CONTINUE_PROMPT);
});

it("sends Continue when the decision lands after the first render", async () => {
  await render();
  expect(onSubmit).not.toHaveBeenCalled();

  await act(async () => {
    markAutoContinueDue(session.id);
    await vi.advanceTimersByTimeAsync(0);
  });

  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(session.id, CONTINUE_PROMPT);
});
