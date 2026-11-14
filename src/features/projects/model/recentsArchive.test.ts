// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { archiveProject, forgetProject, rememberProject } from "./recents";

const RECENTS = "bycoda.recentProjects";
const ARCHIVE = "bycoda.archivedProjects";
const project = "/tmp/project";
const recent = JSON.stringify([{ path: project, openedAt: 1 }]);
const archived = JSON.stringify([{ path: project, archivedAt: 1 }]);

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function refuseWrite(key: string, silent = false) {
  const write = localStorage.setItem.bind(localStorage);
  vi.spyOn(localStorage, "setItem").mockImplementation((target, value) => {
    if (target === key) {
      if (!silent) throw new Error("Storage unavailable");
      return;
    }
    write(target, value);
  });
}

it.each([false, true])("retains the rail entry when archive writes fail (silent=%s)", (silent) => {
  localStorage.setItem(RECENTS, recent);
  refuseWrite(ARCHIVE, silent);
  expect(() => archiveProject(project)).toThrow();
  expect(localStorage.getItem(RECENTS)).toBe(recent);
  expect(localStorage.getItem(ARCHIVE)).toBeNull();
});

it("retains the archived entry when restoring cannot save recents", async () => {
  localStorage.setItem(ARCHIVE, archived);
  refuseWrite(RECENTS);
  await expect(rememberProject(project)).rejects.toThrow();
  expect(localStorage.getItem(ARCHIVE)).toBe(archived);
});

it.each(["not-json", "{}"])("does not replace an unreadable archive (%s)", (raw) => {
  localStorage.setItem(RECENTS, recent);
  localStorage.setItem(ARCHIVE, raw);
  expect(() => archiveProject(project)).toThrow();
  expect(localStorage.getItem(RECENTS)).toBe(recent);
  expect(localStorage.getItem(ARCHIVE)).toBe(raw);
});

it("keeps both copies retryable when removing the archived entry fails", async () => {
  localStorage.setItem(ARCHIVE, archived);
  refuseWrite(ARCHIVE);
  await expect(rememberProject(project)).rejects.toThrow();
  expect(localStorage.getItem(ARCHIVE)).toBe(archived);
  expect(JSON.parse(localStorage.getItem(RECENTS) ?? "[]")).toEqual([
    expect.objectContaining({ path: project }),
  ]);
  vi.restoreAllMocks();
  await rememberProject(project);
  expect(localStorage.getItem(ARCHIVE)).toBe("[]");
});

it("does not overwrite unreadable recents while restoring an archived project", async () => {
  localStorage.setItem(ARCHIVE, archived);
  localStorage.setItem(RECENTS, "not-json");
  await expect(rememberProject(project)).rejects.toThrow();
  expect(localStorage.getItem(RECENTS)).toBe("not-json");
  expect(localStorage.getItem(ARCHIVE)).toBe(archived);
});

it.each(["read", "write"])(
  "retains the archived deletion target after a recents %s failure",
  (failure) => {
    localStorage.setItem(ARCHIVE, archived);
    if (failure === "read") localStorage.setItem(RECENTS, "not-json");
    else refuseWrite(RECENTS);
    expect(() => forgetProject(project)).toThrow();
    expect(localStorage.getItem(ARCHIVE)).toBe(archived);
  },
);
