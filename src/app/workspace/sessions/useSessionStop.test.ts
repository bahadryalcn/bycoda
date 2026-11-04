// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../../features/sessions/model/session";
import { useSessionStop, type SessionStopDeps } from "./useSessionStop";
import { appendPreparingHandoff } from "../../../features/sessions/model/handoff";
import { isSessionErrorBlock, sessionIssue } from "../../../features/sessions/model/sessionIssue";
import { registerRemoteSessionActions } from "../../../features/connections/model/remoteSessionActions";

const {
  cancel,
  notify,
  noteStop,
  cancelAdopted,
  remoteProject,
  orchestrationRun,
  orchestratorStop,
} = vi.hoisted(() => ({
  cancel: vi.fn(),
  cancelAdopted: vi.fn(),
  notify: vi.fn(),
  noteStop: vi.fn(),
  remoteProject: vi.fn(),
  orchestrationRun: vi.fn(),
  orchestratorStop: vi.fn(),
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
  orchestrator: { stopForSession: orchestratorStop, forSession: orchestrationRun },
}));
vi.mock("../../../features/connections/model/remoteProjects", () => ({
  remoteProjectFor: remoteProject,
}));
vi.mock("../helpers/workspaceNotify", () => ({ notifyFinishedWorkspace: notify }));

let root: Root;
let container: HTMLDivElement;
let stop: (id: string, managed?: boolean, current?: () => boolean) => void;
let deps: SessionStopDeps;
const current = () => deps.sessionsRef.current[0];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cancel.mockReset();
  remoteProject.mockReset();
  orchestrationRun.mockReset();
  orchestratorStop.mockReset();
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

it("does not cancel a replacement turn after flushing pending events", () => {
  let original = true;
  deps.flushHarnessEvents = () => {
    original = false;
  };
  act(() =>
    root.render(
      createElement(function Fixture() {
        stop = useSessionStop(deps).onStop;
        return null;
      }),
    ),
  );
  stop(current().id, false, () => original);
  expect(cancel).not.toHaveBeenCalled();
});

it("does not redirect a guarded desktop stop to a new remote or orchestration owner", () => {
  const guard = () => true;
  remoteProject.mockReturnValue({ id: "remote" });
  stop(current().id, false, guard);
  expect(orchestratorStop).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  remoteProject.mockReturnValue(undefined);
  orchestrationRun.mockReturnValue({ leadId: current().id });
  stop(current().id, false, guard);
  expect(orchestratorStop).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
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

it("cancels the original preparing handoff without clearing its unresolved cleanup source", async () => {
  const source = {
    from: "claude" as const,
    fromModel: "claude:sonnet",
    fromSettings: { thinking: "high" },
    fromProviderSessionId: "claude-original",
  };
  const id = current().id;
  deps.sessionsRef.current = [
    appendPreparingHandoff({ ...current(), pendingSwitch: source }, "claude", "codex", source),
  ];
  stop(id);
  await vi.waitFor(() => expect(current().busy).toBe(false));
  expect(current().blocks.at(-1)?.handoff).toMatchObject({
    status: "cancelled",
    pending: false,
    source,
  });
  expect(current().pendingSwitch).toEqual(source);
  expect(deps.turnGen.current.get(id)).toBe(2);
  expect(cancel).toHaveBeenCalledWith("claude", id);
});

it("stops only the mirrored host run and fences follow-ups preparing on the desktop", async () => {
  const id = current().id;
  deps.sessionsRef.current = [
    { ...current(), busy: false, continuingElsewhere: true, adoptedRunId: "seen-host-run" },
  ];
  stop(id);
  expect(current().queueStatus).toBe("paused");
  expect(deps.turnGen.current.get(id)).toBe(2);
  expect(cancelAdopted).toHaveBeenCalledWith(id, "seen-host-run", undefined);
  expect(cancel).not.toHaveBeenCalled();
  // Only the host mirror may announce that its turn actually finished.
  expect(current().continuingElsewhere).toBe(true);
});

it("binds adopted Stop to the generation displayed when the owner clicks it", () => {
  const id = current().id;
  deps.sessionsRef.current = [
    {
      ...current(),
      busy: false,
      continuingElsewhere: true,
      adoptedRunId: "seen-host-run",
      adoptedAuthorityGeneration: 2,
    },
  ];
  stop(id);
  expect(cancelAdopted).toHaveBeenCalledWith(id, "seen-host-run", 2);
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

it("routes explicitly Host-owned local Stop to the owner and stays closed after detach", () => {
  const id = current().id;
  deps.sessionsRef.current = [
    {
      ...current(),
      hostBinding: {
        kind: "local-host",
        machineId: "local",
        environmentId: "home",
        projectId: "project",
        sessionId: id,
        authorityGeneration: 1,
        created: true,
      },
    },
  ];
  const ownerStop = vi.fn();
  const detach = registerRemoteSessionActions(id, { stop: ownerStop } as never);
  stop(id);
  expect(ownerStop).toHaveBeenCalledOnce();
  detach();
  stop(id);
  expect(cancel).not.toHaveBeenCalled();
  expect(cancelAdopted).not.toHaveBeenCalled();
  expect(noteStop).not.toHaveBeenCalled();
});
