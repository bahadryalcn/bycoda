// @vitest-environment happy-dom
import { act, createElement } from "react";
import { renderToString } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LOADING_DELAY_MS } from "../../../shared/hooks/useDelayedVisible";
import { AdoptedSessionNotice } from "./AdoptedSessionNotice";
import { newSession } from "../../sessions/model/session";
import { adoptedUnsyncedMessage } from "../model/adoptedSessions";
import { setAdoptedSyncing } from "../model/adoptedSyncing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps delegated background work inside the parent panel without a top-level notice", () => {
  const session = {
    ...newSession("codex", "/fake"),
    continuingElsewhere: true,
    modelSettings: {
      delegationParent: JSON.stringify({
        parentSessionId: "parent",
        runId: "run",
        kind: "advisor",
        model: "codex:m",
        startedAt: 1,
      }),
    },
  };
  expect(renderToString(createElement(AdoptedSessionNotice, { session }))).toBe("");
});

it("leaves host execution to the header mark without a notice row", () => {
  const session = { ...newSession("codex", "/fake"), continuingElsewhere: true };
  expect(renderToString(createElement(AdoptedSessionNotice, { session }))).toBe("");
});

it("leaves the pending message's status in its queue row", () => {
  const session = {
    ...newSession("codex", "/fake"),
    continuingElsewhere: true,
    queuedMessages: [{ id: "q", text: "waiting", attachments: [] }],
  };
  const html = renderToString(createElement(AdoptedSessionNotice, { session }));
  expect(html).toBe("");
});
it("does not leave a waiting notice after the mirrored host turn settles", () => {
  const session = newSession("codex", "/fake");
  expect(renderToString(createElement(AdoptedSessionNotice, { session }))).toBe("");
});

it("hides the automatic sync spinner as soon as the desktop turn starts", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const session = newSession("claude", "/fake");
  vi.useFakeTimers();
  try {
    setAdoptedSyncing(new Set([session.id]));
    await act(async () => {
      root.render(createElement(AdoptedSessionNotice, { session }));
    });
    await act(async () => vi.advanceTimersByTime(LOADING_DELAY_MS));
    expect(host.textContent).toContain("Syncing with the local Host");

    await act(async () => {
      root.render(createElement(AdoptedSessionNotice, { session: { ...session, busy: true } }));
    });
    expect(host.textContent).toBe("");
  } finally {
    await act(async () => root.unmount());
    setAdoptedSyncing(new Set());
    vi.useRealTimers();
  }
});

const flagged = () => ({ ...newSession("codex", "/fake"), adoptedSyncConflict: true });

async function failManualSync(error: Error) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onRefresh = vi.fn().mockRejectedValue(error);
  await act(async () => {
    root.render(createElement(AdoptedSessionNotice, { session: flagged(), onRefresh }));
  });
  const sync = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Sync conversation"),
  );
  await act(async () => sync?.click());
  const text = host.textContent ?? "";
  await act(async () => root.unmount());
  host.remove();
  return text;
}

it("keeps the unfinished-sync row for a session the model flagged", () => {
  expect(renderToString(createElement(AdoptedSessionNotice, { session: flagged() }))).toContain(
    adoptedUnsyncedMessage(),
  );
});

it("shows the automatic failure reason only while sync needs attention", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const session = flagged();
  const onRefresh = vi.fn().mockResolvedValue(false);
  try {
    setAdoptedSyncing(new Set(), new Map([[session.id, "RPC_WS_DEADLINE: sessions.adopted"]]));
    await act(async () => {
      root.render(createElement(AdoptedSessionNotice, { session, onRefresh }));
    });
    expect(host.textContent).toContain("This computer is busy right now.");
    expect(host.textContent).toContain("Sync conversation");
    expect(onRefresh).not.toHaveBeenCalled();

    await act(async () => {
      setAdoptedSyncing(new Set());
      root.render(
        createElement(AdoptedSessionNotice, {
          session: { ...session, adoptedSyncConflict: undefined },
          onRefresh,
        }),
      );
    });
    expect(host.textContent).toBe("");
  } finally {
    await act(async () => root.unmount());
    setAdoptedSyncing(new Set());
  }
});

it("names why a failed manual sync did not finish instead of one generic sentence", async () => {
  const timeout = await failManualSync(new Error("RPC_WS_DEADLINE: sessions.adopted timed out"));
  expect(timeout).toContain("This computer is busy right now. Try again in a moment.");
  expect(timeout).toContain(adoptedUnsyncedMessage());
  const refused = await failManualSync(
    new Error("Host rejected request: [RPC_AUTHORIZATION] device is not authorized"),
  );
  expect(refused).toContain("device is not authorized");
  expect(refused).not.toContain("Check the connection and try again");
  expect(refused).toContain(adoptedUnsyncedMessage());
});
