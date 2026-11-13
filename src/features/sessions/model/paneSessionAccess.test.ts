import { expect, it, vi } from "vitest";
import type { Session } from "./session";
const state = vi.hoisted(() => ({ sessions: [] as Session[] }));
vi.mock("./sessionsStore", () => ({
  getSessions: () => state.sessions,
  selectSessionById: (sessions: Session[], id: string) =>
    sessions.find((session) => session.id === id),
}));
import { currentSessionAccessor } from "./paneSessionAccess";

it("reads the newest local state at event time and follows the committed remote projection", () => {
  const rendered = { current: { id: "pane", title: "Rendered" } as Session };
  const remote = { current: false };
  const access = currentSessionAccessor(rendered, remote);
  expect(access.current).toBe(rendered.current);
  const latest = { ...rendered.current, title: "Live store" };
  state.sessions = [latest];
  expect(access.current).toBe(latest);
  remote.current = true;
  expect(access.current).toBe(rendered.current);
  rendered.current = { ...rendered.current, title: "Latest Host projection" };
  expect(access.current.title).toBe("Latest Host projection");
});
