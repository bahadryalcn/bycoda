// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ApprovalToasts } from "./ApprovalToasts";
import { newSession } from "../model/session";
import {
  captureApprovalRequest,
  readApprovalIntent,
  submitApprovalIntent,
} from "../model/approvalIntents";
import {
  registerRemoteSessionActions,
  publishRemoteSessionActionSource,
} from "../../connections/model/remoteSessionActions";
import type { HostSession } from "../../connections/model/protocol";
import { rememberNotificationProjects } from "../../notifications/model/notificationProjects";
import type { ApprovalDispatch } from "./ApprovalDecisionContext";
import { createApprovalOccurrenceId } from "../../../shared/model/approvalOccurrence";

it("recaptures a global rendered request when its owner registers and then commits its actual source", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const session = newSession("codex", "G:/late-approval-source");
  const occurrenceId = createApprovalOccurrenceId();
  session.hostBinding = {
    kind: "local-host",
    machineId: "late-machine",
    environmentId: "late-environment",
    projectId: "late-project",
    sessionId: "late-host-session",
    authorityGeneration: 7,
    created: true,
  };
  session.blocks = [
    {
      id: "late-block",
      role: "approval",
      text: "Original request",
      approval: { requestId: 852, occurrenceId },
    },
  ];
  const snapshot: HostSession = {
    projectId: "late-project",
    revision: 4,
    updatedAt: 1,
    status: "running",
    runId: "late-run",
    authorityGeneration: 7,
    session: { ...session, id: "late-host-session" },
  };
  let source: { session: typeof session; snapshot: HostSession } | undefined;
  const approve = vi.fn();
  const actions = {
    approve,
    approvalOccurrenceSupported: true,
    approvalSource: () => source,
  } as Parameters<typeof registerRemoteSessionActions>[1];
  const dispatch: ApprovalDispatch = (_id, id, decision, expected) =>
    submitApprovalIntent(session, id, decision, expected, () => session);
  rememberNotificationProjects([
    {
      id: "late-project",
      kind: "repository",
      name: "Late source",
      detail: "synthetic",
      paths: [session.cwd],
    },
  ]);
  let release = () => {};
  try {
    act(() =>
      root.render(
        createElement(ApprovalToasts, {
          notices: [
            {
              session,
              sessionId: session.id,
              kind: "approval",
              label: "Original request",
              requestId: 852,
            },
          ],
          onFocusSession: vi.fn(),
          onApproval: dispatch,
        }),
      ),
    );
    act(() => {
      release = registerRemoteSessionActions(session.id, actions);
    });
    act(() => {
      source = { session, snapshot };
      publishRemoteSessionActionSource(session.id, actions);
    });
    const allow = () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Allow",
      )!;
    expect(allow()).toBeDefined();
    await act(async () => allow().click());
    expect(approve).toHaveBeenCalledExactlyOnceWith(852, "allow", occurrenceId);
    expect(allow().disabled).toBe(true);
    expect(document.body.textContent).toContain("Waiting for confirmation");
  } finally {
    act(() => {
      root.unmount();
      release();
    });
    node.remove();
    vi.unstubAllGlobals();
  }
});

it("shows the conserved repeat guard in an uncaptured shadow after the original pane owner detaches", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const shadow = newSession("codex", "G:/shadow-approval-source");
  const occurrenceId = createApprovalOccurrenceId();
  shadow.hostBinding = {
    kind: "local-host",
    machineId: "shadow-machine",
    environmentId: "shadow-environment",
    projectId: "shadow-project",
    sessionId: "shadow-host-session",
    authorityGeneration: 7,
    created: true,
  };
  shadow.blocks = [
    {
      id: "shadow-block",
      role: "approval",
      text: "Original pane request",
      approval: { requestId: 853, occurrenceId },
    },
  ];
  const pane = { ...shadow, cwd: "G:/actual-pane", model: "actual-model" };
  const snapshot: HostSession = {
    projectId: "shadow-project",
    revision: 4,
    updatedAt: 1,
    status: "running",
    runId: "shadow-run",
    authorityGeneration: 7,
    session: { ...pane, id: "shadow-host-session" },
  };
  const approve = vi.fn();
  const actions = {
    approve,
    approvalOccurrenceSupported: true,
    approvalSource: () => ({ session: pane, snapshot }),
  } as Parameters<typeof registerRemoteSessionActions>[1];
  const release = registerRemoteSessionActions(pane.id, actions);
  rememberNotificationProjects([
    {
      id: "shadow-project",
      kind: "repository",
      name: "Shadow source",
      detail: "synthetic",
      paths: [shadow.cwd],
    },
  ]);
  try {
    submitApprovalIntent(pane, 853, "allow", captureApprovalRequest(pane, 853), () => pane);
    release();
    expect(readApprovalIntent(shadow, 853)).toBeUndefined();
    const dispatch: ApprovalDispatch = (_id, id, decision, expected) =>
      submitApprovalIntent(shadow, id, decision, expected, () => shadow);
    act(() =>
      root.render(
        createElement(ApprovalToasts, {
          notices: [
            {
              session: shadow,
              sessionId: shadow.id,
              kind: "approval",
              label: "Original pane request",
              requestId: 853,
            },
          ],
          onFocusSession: vi.fn(),
          onApproval: dispatch,
        }),
      ),
    );
    const allow = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Allow",
    )!;
    expect(allow.disabled).toBe(true);
    expect(document.body.textContent).toContain("Waiting for confirmation");
    act(() => allow.click());
    expect(approve).toHaveBeenCalledExactlyOnceWith(853, "allow", occurrenceId);
  } finally {
    act(() => root.unmount());
    release();
    node.remove();
    vi.unstubAllGlobals();
  }
});
