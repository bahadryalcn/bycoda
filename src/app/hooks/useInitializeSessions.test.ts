// @vitest-environment happy-dom
import { act, createElement, StrictMode, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import * as sessions from "../../features/sessions/model/sessionsStore";
import type { Session } from "../../features/sessions/model/session";
import { useInitializeSessions } from "./useInitializeSessions";
it("commits transferred sessions before paint without resetting during StrictMode replay", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessions.resetSessionsStore([]);
  const reset = vi.spyOn(sessions, "resetSessionsStore");
  const initial = [{ id: "transferred", blocks: [] }] as unknown as Session[];
  const seen: string[][] = [];
  function Owner() {
    useInitializeSessions(initial);
    const shell = sessions.useShellSessions();
    useLayoutEffect(() => {
      seen.push(sessions.getShellSessions().map((s) => s.id));
    });
    return createElement("span", null, shell.map((s) => s.id).join(","));
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(StrictMode, null, createElement(Owner))));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe("transferred");
    expect(seen.every((ids) => ids.join(",") === "transferred")).toBe(true);
  } finally {
    await act(async () => root.unmount());
    reset.mockRestore();
    vi.unstubAllGlobals();
  }
});
