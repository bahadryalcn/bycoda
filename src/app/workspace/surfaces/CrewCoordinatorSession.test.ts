// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Session } from "../../../features/sessions/model/session";
import { resetSessionsStore } from "../../../features/sessions/model/sessionsStore";
import { CrewCoordinatorSession } from "./CrewCoordinatorSession";
import type { WorkspaceSessionPaneProps } from "../layout/WorkspaceMainArea";

const { pane, stopRequest, managed, confirmStop } = vi.hoisted(() => ({
  pane: vi.fn((_props: Record<string, unknown>) => null),
  stopRequest: vi.fn(async () => undefined),
  managed: vi.fn((): { runId: string; role: string } | undefined => undefined),
  confirmStop: vi.fn(async () => true),
}));
vi.mock("../../../features/sessions/ui/SessionPane", () => ({ SessionPane: pane }));
vi.mock("../../../features/connections/model/connections", () => ({
  remoteSessionFor: () => undefined,
  remoteRequest: stopRequest,
}));
vi.mock("../../../features/crews/public/managed", () => ({ crewManagedSession: managed }));
vi.mock("../../model/sessionWindowOwnership", () => ({
  reserveSessionWindow: async () => async () => undefined,
}));
vi.mock("../../../shared/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: confirmStop, dialog: null }),
}));

it("renders the canonical coordinator with existing app handlers after host adoption", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const coordinator = { id: "lead", cwd: "/crew", blocks: [] } as unknown as Session;
  resetSessionsStore([coordinator]);
  const target = { machineId: "host", projectId: "project", sessionId: "lead", cwd: "/crew" };
  const onOpen = vi.fn(async () => undefined);
  const onSubmit = vi.fn();
  const root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      createElement(CrewCoordinatorSession, {
        target,
        onOpen,
        paneProps: { onSubmit } as unknown as WorkspaceSessionPaneProps,
      }),
    ),
  );
  expect(onOpen).toHaveBeenCalledWith(target);
  expect(pane).toHaveBeenLastCalledWith(
    expect.objectContaining({
      session: coordinator,
      onSubmit,
      embedded: true,
      crewCoordinatorChat: true,
    }),
    undefined,
  );
  await act(async () => root.unmount());
  resetSessionsStore([]);
  vi.unstubAllGlobals();
});

it("routes inline Stop through confirmed Crew stop on the exact owner host", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  managed.mockReturnValue({ runId: "run", role: "coordinator" });
  const coordinator = { id: "lead", cwd: "/crew", blocks: [] } as unknown as Session;
  resetSessionsStore([coordinator]);
  const normalStop = vi.fn();
  const root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      createElement(CrewCoordinatorSession, {
        target: { machineId: "host", projectId: "project", sessionId: "lead", cwd: "/crew" },
        onOpen: async () => undefined,
        paneProps: { onStop: normalStop } as unknown as WorkspaceSessionPaneProps,
      }),
    ),
  );
  const props = pane.mock.calls.at(-1)![0];
  await act(async () => (props.onStop as (id: string) => void)("lead"));
  expect(confirmStop).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: "Stop work" }));
  expect(stopRequest).toHaveBeenCalledWith(
    "host",
    "crews.stop",
    { projectId: "project", runId: "run" },
    false,
    true,
  );
  expect(normalStop).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  managed.mockReturnValue(undefined);
  resetSessionsStore([]);
  vi.unstubAllGlobals();
});
