// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSessionFolders, saveSessionFolders } from "./sessionFolders";

const PROJECTS = 25;
const project = (index: number) => `/work/project-${index}`;
const folder = (id: string) => ({ id, name: id, sessionIds: [`${id}-s`], collapsed: false });

beforeEach(() => {
  localStorage.clear();
  for (let index = 0; index < PROJECTS; index++)
    saveSessionFolders(project(index), [folder(`f${index}`)]);
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("session folder storage reads", () => {
  // perf P3: loadSessionFolders must cache the parsed store by raw string.
  it("does not re-parse an unchanged stored blob for every project it loads", () => {
    loadSessionFolders(project(0));
    const parse = vi.spyOn(JSON, "parse");
    for (let round = 0; round < 4; round++)
      for (let index = 0; index < PROJECTS; index++) loadSessionFolders(project(index));
    expect(parse.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("returns the project's folders and reflects a later save", () => {
    expect(loadSessionFolders(project(3)).map((item) => item.id)).toEqual(["f3"]);
    saveSessionFolders(project(3), [folder("renamed")]);
    expect(loadSessionFolders(project(3)).map((item) => item.id)).toEqual(["renamed"]);
    expect(loadSessionFolders(project(4)).map((item) => item.id)).toEqual(["f4"]);
  });

  it("does not leak edits made to a returned list into later reads", () => {
    loadSessionFolders(project(1)).push(folder("junk"));
    expect(loadSessionFolders(project(1)).map((item) => item.id)).toEqual(["f1"]);
  });
});
