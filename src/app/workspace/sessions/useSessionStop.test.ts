// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../../features/sessions/model/session";
import { useSessionStop, type SessionStopDeps } from "./useSessionStop";
import { isSessionErrorBlock, sessionIssue } from "../../../features/sessions/model/sessionIssue";

const { cancel, notify, noteStop, cancelAdopted } = vi.hoisted(() => ({
  cancel: vi.fn(),
  cancelAdopted: vi.fn(),
  notify: vi.fn(),
  noteStop: vi.fn(),
}));
vi.mock("../../../features/connections/model/adoptedSessionCommands", () => ({
  cancelAdoptedTurn: cancelAdopted,
}));
vi.mock("../../../features/connections/model/useSharedLocalQueues", () => ({
  noteSharedLocalStop: noteStop,
}));
vi.mock("../../../integrations/harness", async (original) => ({
  ...(await original<typeof import("../../../integrations/harness")>()),
  cancelHarnessTurn: cancel,
}));
vi.mock("../../../features/orchestration/model/orchestration", () => ({
  orchestrator: { stopForSession: () => undefined },
}));
vi.mock("../../../features/connections/model/remoteProjects", () => ({
  remoteProjectFor: () => undefined,
}));
vi.mock("../helpers/workspaceNotify", () => ({ notifyFinishedWorkspace: notify }));

let root: Root;
let container: HTMLDivElement;
let stop: (id: string) => void;
let deps: SessionStopDeps;
const current = () => deps.sessionsRef.current[0];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cancel.mockReset();
  notify.mockReset();
  noteStop.mockReset();
  cancelAdopted.mockReset().mockResolvedValue(undefined);
  const session: Session = {
    ...newSession("claude", "/repo"),
    busy: true,
    queuedMessages: [{ id: "q", text: "next", attachments: [] }],
  };
  const sessionsRef = { current: [session] };
  deps = {
    sessionsRef,
    setSessions: (update) => {
      sessionsRef.current = typeof update === "function" ? update(sessionsRef.current) : update;
    },
    turnGen: { current: new Map([[session.id, 1]]) },
    flushHarnessEvents: vi.fn(),
    deferWorkspaceWork: vi.fn(),
    tabsRef: { current: [] },
    activeTabIdRef: { current: "" },
    projectTerminalFocusedRef: { current: false },
    onStopRef: { current: () => undefined },
  };
  function Harness() {
    stop = useSessionStop(deps).onStop;
    return null;
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("pauses the queue immediately and keeps events and Stop actionable after delivery failure", async () => {
  let reject!: (error: Error) => void;
  cancel.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  stop(current().id);
  expect(current().queueStatus).toBe("paused");
  expect(current().busy).toBe(true);
  expect(deps.turnGen.current.get(current().id)).toBe(1);
  reject(new Error("pipe unavailable"));
  await vi.waitFor(() => expect(current().blocks.at(-1)?.text).toContain("pipe unavailable"));
  // AgentTranscript renders this established error block contract as an alert.
  expect(isSessionErrorBlock(current().blocks.at(-1)!)).toBe(true);
  expect(sessionIssue(current())).toBe("failed");
  expect(current().busy).toBe(true);
  expect(deps.turnGen.current.get(current().id)).toBe(1);
  expect(notify).not.toHaveBeenCalled();
  cancel.mockResolvedValueOnce(undefined);
  stop(current().id);
  await vi.waitFor(() => expect(current().busy).toBe(false));
  expect(sessionIssue(current())).toBeUndefined();
  expect(deps.turnGen.current.get(current().id)).toBe(2);
  expect(cancel).toHaveBeenCalledTimes(2);
});

it("stops only the mirrored host run and fences follow-ups preparing on the desktop", async () => {
  const id = current().id;
  deps.sessionsRef.current = [
    { ...current(), busy: false, continuingElsewhere: true, adoptedRunId: "seen-host-run" },
  ];
  stop(id);
  expect(current().queueStatus).toBe("paused");
  expect(deps.turnGen.current.get(id)).toBe(2);
  expect(cancelAdopted).toHaveBeenCalledWith(id, "seen-host-run");
  expect(cancel).not.toHaveBeenCalled();
  // Only the host mirror may announce that its turn actually finished.
  expect(current().continuingElsewhere).toBe(true);
});

it.each(["success", "failure"])(
  "does not overwrite a newer turn when an old Stop settles with %s",
  async (outcome) => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    cancel.mockImplementationOnce(
      () =>
        new Promise<void>((done, fail) => {
          resolve = done;
          reject = fail;
        }),
    );
    const id = current().id;
    stop(id);
    deps.turnGen.current.set(id, 2);
    deps.sessionsRef.current = [{ ...current(), busy: true, queueStatus: undefined }];
    if (outcome === "success") resolve();
    else reject(new Error("old failure"));
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(current().busy).toBe(true);
    expect(sessionIssue(current())).toBeUndefined();
    expect(deps.turnGen.current.get(id)).toBe(2);
    expect(notify).not.toHaveBeenCalled();
  },
);

it("tells the shared queue about Stop so an unsettled send pauses it when it settles", () => {
  const id = current().id;
  stop(id);
  expect(noteStop).toHaveBeenCalledExactlyOnceWith(id);
});
