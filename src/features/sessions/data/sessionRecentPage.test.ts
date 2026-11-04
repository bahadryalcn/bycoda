// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { newSession } from "../model/session";
import { saveHostSessionBinding } from "../../connections/model/sessionExecutionBinding";
import { finalizeRecentSessionPages, listRecentSessionsSincePage } from "./sessionStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
});

it("keeps the native cursor even when owner-fenced rows are hidden and adds Host shells once", async () => {
  const host = newSession("codex", "/project");
  saveHostSessionBinding(host, {
    kind: "local-host",
    machineId: "m",
    environmentId: "e",
    projectId: "p",
    sessionId: "remote",
    authorityGeneration: null,
    created: true,
  });
  localStorage.setItem("bycoda.host-session-binding.v1:bad", "{broken");
  const base = {
    cwd: "/project",
    title: "Native",
    harness: "codex",
    model: "m",
    runtimeMode: "supervised",
    createdAt: 1,
    updatedAt: Date.now(),
  };
  const cursor = { activityAt: 2, id: "bad", revision: 7 };
  vi.mocked(invoke)
    .mockResolvedValueOnce({ rows: [{ ...base, id: "bad" }], nextCursor: cursor })
    .mockResolvedValueOnce({ rows: [{ ...base, id: "native" }], nextCursor: null });
  const first = await listRecentSessionsSincePage(0, null);
  expect(first.rows).toEqual([]);
  expect(first.nextCursor).toEqual(cursor);
  const second = await listRecentSessionsSincePage(0, first.nextCursor);
  expect(second.rows.map((row) => row.id)).toEqual(["native"]);
  expect(finalizeRecentSessionPages(second.rows, 0).map((row) => row.id)).toEqual([
    "native",
    host.id,
  ]);
  localStorage.setItem("bycoda.host-session-binding.v1:native", "{broken");
  expect(finalizeRecentSessionPages(second.rows, 0).map((row) => row.id)).toEqual([host.id]);
  expect(invoke).toHaveBeenLastCalledWith("session_list_recent_since_page", { since: 0, cursor });
});
