// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { gateProjectLocation } from "./submitProjectLocation";
import type { SubmitDeps, SubmitInput, SubmitPreflight } from "./submitTypes";
import { newSession } from "../../../../features/sessions/model/session";
import {
  resetSessionsStore,
  setSessions,
  useSession,
} from "../../../../features/sessions/model/sessionsStore";
import { pathKey } from "../../../../shared/lib/paths";

afterEach(() => {
  resetSessionsStore([]);
  vi.unstubAllGlobals();
});

it("keeps the conversation busy on screen while the prepared send starts", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const session = newSession("claude", "/repo/project");
  resetSessionsStore([session]);
  const committed: boolean[] = [];
  function Probe() {
    const busy = !!useSession(session.id)?.busy;
    useLayoutEffect(() => {
      committed.push(busy);
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));

  // The send that follows preparation marks the conversation busy again in the
  // same tick, as the run-lease and usage-budget gates do.
  const submit = vi.fn((sessionId: string) => {
    setSessions((all) =>
      all.map((s) => (s.id === sessionId ? { ...s, busy: true, worktreePreparing: true } : s)),
    );
    return true;
  });
  const ctx = {
    applyProjectLocationChange: vi.fn(),
    enqueueHarnessEvent: vi.fn(),
    flushHarnessEvents: vi.fn(),
    refs: {
      turnGen: { current: new Map<string, number>() },
      projectLocationSyncs: {
        current: new Map([
          [
            pathKey(session.cwd),
            Promise.resolve({ path: session.cwd, identity: "", moved: false }),
          ],
        ]),
      },
      submitAfterProjectSyncRef: { current: submit },
    },
  } as unknown as SubmitDeps;
  const input: SubmitInput = {
    sessionId: session.id,
    text: "hello",
    attachments: [],
    options: undefined,
  };
  const pre = { storedCurrent: session, current: session, intent: "default" } as SubmitPreflight;

  let accepted: boolean | undefined;
  await act(async () => {
    accepted = await gateProjectLocation(ctx, input, pre);
  });

  expect(accepted).toBe(true);
  expect(submit).toHaveBeenCalledWith(
    session.id,
    "hello",
    [],
    expect.objectContaining({ projectLocationReady: true }),
  );
  // Idle once before the send, then busy without an idle frame in between.
  expect(committed.slice(committed.indexOf(true))).not.toContain(false);
  expect(committed.at(-1)).toBe(true);
  act(() => root.unmount());
});
