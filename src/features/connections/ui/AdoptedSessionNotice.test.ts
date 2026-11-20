// @vitest-environment happy-dom
import { act, createElement } from "react";
import { renderToString } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AdoptedSessionNotice } from "./AdoptedSessionNotice";
import { newSession } from "../../sessions/model/session";
import { ADOPTED_RUNNING_REASON, ADOPTED_UNSYNCED_MESSAGE } from "../model/adoptedSessions";
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

it("shows queued waiting during host execution without hiding or replacing the composer", () => {
  const session = {
    ...newSession("codex", "/fake"),
    continuingElsewhere: true,
    queuedMessages: [{ id: "q", text: "waiting", attachments: [] }],
  };
  const html = renderToString(createElement(AdoptedSessionNotice, { session }));
  expect(html).toContain('role="status"');
  expect(html).not.toContain(ADOPTED_RUNNING_REASON);
  expect(html).toContain("Queue is waiting for the current turn to finish.");
});
it("does not leave a waiting notice after the mirrored host turn settles", () => {
  const session = newSession("codex", "/fake");
  expect(renderToString(createElement(AdoptedSessionNotice, { session }))).toBe("");
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
    ADOPTED_UNSYNCED_MESSAGE,
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
  expect(timeout).toContain(ADOPTED_UNSYNCED_MESSAGE);
  const refused = await failManualSync(
    new Error("Host rejected request: [RPC_AUTHORIZATION] device is not authorized"),
  );
  expect(refused).toContain("device is not authorized");
  expect(refused).not.toContain("Check the connection and try again");
  expect(refused).toContain(ADOPTED_UNSYNCED_MESSAGE);
});
