// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isConnectionFailure } from "../../connections/model/remoteFailure";
import { reportRemoteConnection } from "../../connections/model/remoteHealth";
import { CrewManagementDialog, CrewSessions } from "./CrewSessions";

const feedback = vi.hoisted(() => ({ coordinated: true }));
vi.mock("../../connections/ui/RemoteConnectionFeedback", () => ({
  useRemoteConnectionFeedback: (
    _cwd: string,
    failure?: Parameters<typeof isConnectionFailure>[0],
  ) => feedback.coordinated && (!failure || isConnectionFailure(failure)),
}));
vi.mock("../../connections/model/remoteHealth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../connections/model/remoteHealth")>()),
  reportRemoteConnection: vi.fn(),
}));

type CrewState = ComponentProps<typeof CrewSessions>["state"];
const cwd = "remote://environment/Users/owner/project";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  feedback.coordinated = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(state: Partial<CrewState>) {
  const refetch = vi.fn();
  await act(async () =>
    root.render(createElement(CrewSessions, { cwd, state: { refetch, ...state } as CrewState })),
  );
  return refetch;
}

it("hands an uninitialized remote query failure to the common notice without an empty success state", async () => {
  const error = new Error("Machine is unreachable");
  await render({ error });
  expect(container.textContent).toContain("Not connected");
  expect(container.textContent).not.toContain("Crew host unavailable. Retry");
  expect(reportRemoteConnection).toHaveBeenCalledWith(cwd, "crews", error);
});

it("retains the last Crew work rows during a shared connection interruption", async () => {
  const data = {
    definitions: [{ id: "definition", name: "Review team" }],
    runs: [
      {
        id: "run",
        title: "Review connection recovery",
        status: "active",
        updatedAt: 1,
        definition: { id: "definition", name: "Review team" },
        tasks: [],
        messages: [],
        assignments: [],
      },
    ],
  } as unknown as NonNullable<CrewState["data"]>;
  await render({
    data,
    error: new Error("RPC_CONNECTION_INTERRUPTED: Host connection interrupted"),
  });
  expect(container.textContent).toContain("Review connection recovery");
  expect(container.textContent).not.toContain("Crew host unavailable. Retry");
  expect(container.textContent).not.toContain("Not connected");
});

it("keeps a service failure and its local retry even with an empty cached collection", async () => {
  const data = { definitions: [], runs: [] } as unknown as NonNullable<CrewState["data"]>;
  const refetch = await render({
    data,
    error: new Error("Host rejected request: Crew storage unavailable"),
  });
  const retry = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Crew host unavailable. Retry"),
  )!;
  expect(retry).toBeTruthy();
  await act(async () => retry.click());
  expect(refetch).toHaveBeenCalledOnce();
  expect(reportRemoteConnection).not.toHaveBeenCalled();
});

it("retains standalone connection retry when no common owner is mounted", async () => {
  feedback.coordinated = false;
  await render({ error: new Error("Machine is unreachable") });
  expect(container.textContent).toContain("Crew host unavailable. Retry");
  expect(container.textContent).not.toContain("Not connected");
});

it("does not report recovery before the query has a verified result", async () => {
  await render({ isSuccess: false });
  expect(reportRemoteConnection).not.toHaveBeenCalled();
  const data = { definitions: [], runs: [] } as unknown as NonNullable<CrewState["data"]>;
  await render({ data, isSuccess: true, error: null });
  expect(reportRemoteConnection).toHaveBeenCalledWith(cwd, "crews");
});

it("keeps recovery inside Crew management's modal even when a shared notice provider is mounted", async () => {
  const { RemoteConnectionFeedbackProvider } = await vi.importActual<
    typeof import("../../connections/ui/RemoteConnectionFeedback")
  >("../../connections/ui/RemoteConnectionFeedback");
  const refetch = vi.fn();
  const renderDialog = async (error: Error | null) =>
    act(async () =>
      root.render(
        createElement(RemoteConnectionFeedbackProvider, {
          children: [
            createElement("button", { key: "outside" }, "Shared reconnect"),
            createElement(CrewManagementDialog, {
              key: "dialog",
              cwd,
              state: { error, refetch } as unknown as CrewState,
              onClose: vi.fn(),
            }),
          ],
        }),
      ),
    );
  await renderDialog(new Error("Machine is unreachable"));
  const dialog = document.body.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Machine is unreachable");
  const retry = [...dialog.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  )!;
  expect(retry).toBeTruthy();
  await act(async () => {
    retry.focus();
    retry.click();
  });
  expect(document.activeElement).toBe(retry);
  expect(refetch).toHaveBeenCalledOnce();
  await renderDialog(new Error("Crew storage unavailable"));
  expect(document.body.textContent).toContain("Crew storage unavailable");
  expect(document.body.textContent).not.toContain("Not connected");
  await renderDialog(null);
  expect(document.body.textContent).toContain("Loading crews…");
  expect(document.body.textContent).not.toContain("Not connected");
});
