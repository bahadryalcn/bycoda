// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { newSession } from "../model/session";
import { RemoteOriginMark, remoteOrigin } from "./RemoteOriginMark";

const RUNNING =
  "This conversation is running in the background on this computer. New messages appear automatically.";

it("marks a remotely started conversation while it runs and after it settles", () => {
  const local = newSession("codex", "/fake");
  expect(remoteOrigin(local)).toBeUndefined();
  expect(remoteOrigin({ ...local, continuingElsewhere: true })).toBe("running");
  // The local run took over the turn; the session stays remote in origin.
  expect(remoteOrigin({ ...local, continuingElsewhere: true, busy: true })).toBe("idle");
  expect(remoteOrigin({ ...local, adoptedBase: { count: 1, chain: "d" } })).toBe("idle");
});

it("leaves delegated background work to its parent panel", () => {
  const child = {
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
  expect(remoteOrigin(child)).toBeUndefined();
});

it("names the origin and, while running, the background run", () => {
  expect(renderToString(createElement(RemoteOriginMark, { origin: undefined }))).toBe("");
  const idle = renderToString(createElement(RemoteOriginMark, { origin: "idle" }));
  expect(idle).toContain("Started from a remote connection");
  expect(idle).not.toContain(RUNNING);
  expect(renderToString(createElement(RemoteOriginMark, { origin: "running" }))).toContain(RUNNING);
  expect(
    renderToString(createElement(RemoteOriginMark, { origin: "idle", labelled: true })),
  ).toContain("Remote connection");
});
