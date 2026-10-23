// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { expect, it, vi } from "vitest";
import type { Session } from "../../../features/sessions/model/session";
import {
  historySourceProjection,
  useHistorySourceRegistration,
} from "./useHistorySourceRegistration";
const snapshots = vi.hoisted(() => ({ sessions: [] as Session[] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("../../../features/sessions/model/sessionsStore", () => ({
  useShellSessionsSelector: (selector: (sessions: Session[]) => unknown) =>
    selector(snapshots.sessions),
}));
const source = { id: "idle", cwd: "/project", busy: false, blocks: [] } as unknown as Session;
it("updates sources without withdrawing them and refreshes the latest snapshot until unmount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  const root = createRoot(container);
  function Registration() {
    useHistorySourceRegistration();
    return null;
  }
  const published = () =>
    vi.mocked(invoke).mock.calls.filter(([name]) => name === "control_history_sources");
  try {
    vi.mocked(invoke).mockClear();
    snapshots.sessions = [source];
    await act(async () => root.render(createElement(Registration)));
    snapshots.sessions = [{ ...source, worktreeCwd: "/next" }];
    await act(async () => root.render(createElement(Registration)));
    expect(published().map(([, args]) => args)).toEqual([
      { sources: [{ sessionId: "idle", cwd: "/project" }] },
      { sources: [{ sessionId: "idle", cwd: "/next" }] },
    ]);
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(published().at(-1)?.[1]).toEqual({ sources: [{ sessionId: "idle", cwd: "/next" }] });
    await act(async () => root.unmount());
    expect(published().at(-1)?.[1]).toEqual({ sources: [] });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    snapshots.sessions = [];
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
it("registers a completed idle open session without granting app or provider access", () => {
  expect(historySourceProjection([source], () => false)).toEqual([
    { sessionId: "idle", cwd: "/project" },
  ]);
  expect(historySourceProjection([], () => false)).toEqual([]);
});
it("tracks actual working checkout and removes locked/remote/orchestration sources", () => {
  const worktree = { ...source, worktreeCwd: "/project-worktree" };
  expect(historySourceProjection([worktree], () => false)).toEqual([
    { sessionId: "idle", cwd: "/project-worktree" },
  ]);
  expect(historySourceProjection([worktree], (cwd) => cwd === "/project-worktree")).toEqual([]);
  expect(historySourceProjection([source], (cwd) => cwd === "/project")).toEqual([]);
  expect(
    historySourceProjection(
      [
        { ...source, cwd: "remote://host/project" },
        { ...source, orchestrationLeadId: "lead" },
      ],
      () => false,
    ),
  ).toEqual([]);
});
