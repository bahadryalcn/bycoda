// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { routeSubmitSession } from "./submitRouting";
import type { SubmitDeps } from "./submitTypes";
import { sessionsRef } from "../../../../features/sessions/model/sessionsStore";
import { remoteSessionActions } from "../../../../features/connections/model/remoteSessionActions";
import { saveHostSessionBinding } from "../../../../features/connections/model/sessionExecutionBinding";
import { newDefaultSession } from "../../../../features/sessions/model/session";

const shared = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("../../../../features/connections/model/remoteProjects", () => ({
  remoteProjectFor: () => undefined,
}));
vi.mock("../../../../features/connections/model/remoteSessionActions", () => ({
  remoteSessionActions: vi.fn(),
}));
vi.mock("../../../../features/connections/model/useSharedLocalQueues", () => ({
  sharedLocalQueueClaiming: () => false,
  submitSharedLocalQueue: (...args: unknown[]) => shared.submit(...args),
}));
vi.mock("../../../../features/sessions/model/sessionsStore", () => ({
  sessionsRef: { current: [] },
  getSessions: () => [],
  setSessions: vi.fn(),
}));
vi.mock("./submitClearConversation", () => ({ submitClearConversation: vi.fn() }));

beforeEach(() => { shared.submit.mockReset(); localStorage.clear(); vi.mocked(remoteSessionActions).mockReset(); });

it.each([undefined, "steer", "queue"] as const)("routes explicit local Host %s intent only to its registered owner", (followUpBehavior) => {
  const session = newDefaultSession("G:/local");
  sessionsRef.current = [saveHostSessionBinding(session, { kind: "local-host", machineId: "local", environmentId: "home", projectId: "project", sessionId: session.id, authorityGeneration: 1, created: true })];
  const submit = vi.fn(() => true);
  vi.mocked(remoteSessionActions).mockReturnValue({ submit } as never);
  const ctx = { refs: { windowTransferPendingRef: { current: false }, movingSessionIds: { current: new Set() }, editedResends: { isActive: () => false }, retiringTurns: { current: new Set() }, turnGen: { current: new Map() } } } as unknown as SubmitDeps;
  expect(routeSubmitSession(ctx, { sessionId: session.id, text: "follow up", attachments: [], options: { followUpBehavior } })).toBe(true);
  expect(submit).toHaveBeenCalledWith("follow up", [], { followUpBehavior });
  expect(shared.submit).not.toHaveBeenCalled();
  vi.mocked(remoteSessionActions).mockReturnValue(undefined);
  expect(routeSubmitSession(ctx, { sessionId: session.id, text: "offline", attachments: [] })).toBe(false);
  expect(shared.submit).not.toHaveBeenCalled();
});

it.each([
  ["another row changes", true],
  ["selected row changes", false],
  ["selected row disappears", false],
  ["Stop invalidates preparation", false],
  ["queue is paused", false],
  ["queue edit starts", false],
] as const)("revalidates selected Steer when %s", (change, accepted) => {
  const selected = { id: "selected", text: "queued", attachments: [] };
  const session = {
    id: "chat",
    cwd: "/fake",
    queuedMessages: [selected, { ...selected, id: "other" }],
    queueStatus: "active",
  } as (typeof sessionsRef.current)[number];
  sessionsRef.current = [session];
  const turnGen = { current: new Map([["chat", 1]]) };
  const ctx = {
    refs: {
      windowTransferPendingRef: { current: false },
      movingSessionIds: { current: new Set() },
      editedResends: { isActive: () => false },
      retiringTurns: { current: new Set() },
      turnGen,
    },
  } as unknown as SubmitDeps;
  routeSubmitSession(ctx, {
    sessionId: "chat",
    text: selected.text,
    attachments: [],
    options: { queuedMessageId: selected.id, followUpBehavior: "steer" },
  });
  const valid = shared.submit.mock.calls[0][4] as () => boolean;
  const latest = { ...session, queuedMessages: session.queuedMessages!.map((row) => ({ ...row })) };
  if (change === "another row changes") latest.queuedMessages[1].text = "unrelated edit";
  if (change === "selected row changes") latest.queuedMessages[0].text = "new selected text";
  if (change === "selected row disappears") latest.queuedMessages.shift();
  if (change === "Stop invalidates preparation") turnGen.current.set("chat", 2);
  if (change === "queue is paused") latest.queueStatus = "paused";
  if (change === "queue edit starts") latest.editingQueuedMessageId = "selected";
  sessionsRef.current = [latest];
  expect(valid()).toBe(accepted);
});
