// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  archiveProject,
  forgetProject,
  loadArchivedProjects,
  readArchivedProjects,
  rememberImportedProjects,
  rememberProject,
} from "./recents";

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

it("reuses the decoded archive while checking current storage and isolating mutable results", () => {
  const first = JSON.stringify([{ path: "/tmp/cache-test", archivedAt: 7 }]);
  const second = JSON.stringify([{ path: "/tmp/replacement", archivedAt: 8 }]);
  localStorage.setItem(ARCHIVE, first);
  const parse = vi.spyOn(JSON, "parse");
  const read = readArchivedProjects();
  read.items[0]!.path = "/tmp/mutated";
  read.items.pop();
  const loaded = loadArchivedProjects();
  expect(loaded).toEqual([{ path: "/tmp/cache-test", archivedAt: 7 }]);
  loaded[0]!.archivedAt = 999;
  expect(readArchivedProjects().items[0]!.archivedAt).toBe(7);
  expect(parse.mock.calls.filter(([raw]) => raw === first)).toHaveLength(1);

  const get = vi.spyOn(localStorage, "getItem");
  get.mockImplementationOnce(() => {
    throw new Error("unavailable");
  });
  expect(readArchivedProjects()).toEqual({ state: "unavailable", items: [] });
  localStorage.setItem(ARCHIVE, second);
  expect(readArchivedProjects().items).toEqual([{ path: "/tmp/replacement", archivedAt: 8 }]);
  localStorage.removeItem(ARCHIVE);
  expect(readArchivedProjects()).toEqual({ state: "ready", items: [] });
});

it("serializes the remaining archive once when restoring a project", async () => {
  localStorage.setItem(
    ARCHIVE,
    JSON.stringify([
      { path: project, archivedAt: 1 },
      { path: "/tmp/keep", archivedAt: 2 },
    ]),
  );
  const stringify = vi.spyOn(JSON, "stringify");
  await rememberProject(project);
  const remaining = '[{"path":"/tmp/keep","archivedAt":2}]';
  expect(localStorage.getItem(ARCHIVE)).toBe(remaining);
  expect(stringify.mock.results.filter(({ value }) => value === remaining)).toHaveLength(1);
});

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

const imported = [{ path: "/tmp/imported", lastUsedAt: 5 }];

it.each(["not-json", "{}"])("does not replace unreadable recents on bulk import (%s)", (raw) => {
  localStorage.setItem(RECENTS, raw);
  expect(() => rememberImportedProjects(imported)).toThrow();
  expect(localStorage.getItem(RECENTS)).toBe(raw);
});

it.each(["not-json", "{}"])(
  "does not re-add archived projects when the archive is unreadable (%s)",
  (raw) => {
    localStorage.setItem(RECENTS, recent);
    localStorage.setItem(ARCHIVE, raw);
    expect(() =>
      rememberImportedProjects([...imported, { path: project, lastUsedAt: 9 }]),
    ).toThrow();
    expect(localStorage.getItem(RECENTS)).toBe(recent);
    expect(localStorage.getItem(ARCHIVE)).toBe(raw);
  },
);

it.each([false, true])("fails a bulk import whose recents write is lost (silent=%s)", (silent) => {
  localStorage.setItem(RECENTS, recent);
  refuseWrite(RECENTS, silent);
  expect(() => rememberImportedProjects(imported)).toThrow("Could not save recent projects.");
  expect(localStorage.getItem(RECENTS)).toBe(recent);
});

it("keeps archived projects archived and existing recents untouched on bulk import", () => {
  localStorage.setItem(RECENTS, recent);
  localStorage.setItem(ARCHIVE, JSON.stringify([{ path: "/tmp/archived", archivedAt: 2 }]));
  const next = rememberImportedProjects([
    { path: "/tmp/archived", lastUsedAt: 8 },
    { path: project, lastUsedAt: 9 },
    ...imported,
  ]);
  expect(next).toEqual([
    { path: project, openedAt: 1 },
    { path: "/tmp/imported", openedAt: 5 },
  ]);
  expect(JSON.parse(localStorage.getItem(RECENTS) ?? "[]")).toEqual(next);
});
