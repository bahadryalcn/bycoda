// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMobileProjectDirectory } from "./mobileProjectDirectory";
import { rememberProject } from "./recents";
import { saveSessionFolders } from "../../sessions/model/sessionFolders";
import { saveSessionOrder } from "../../sessions/model/sessionOrder";

const PROJECTS = 30;
const TICKS = 10;
const paths = Array.from({ length: PROJECTS }, (_, index) => `/work/project-${index}`);

beforeEach(() => {
  localStorage.clear();
  paths.forEach((cwd, index) => {
    rememberProject(cwd);
    saveSessionFolders(cwd, [
      { id: `f${index}`, name: "Work", sessionIds: ["s"], collapsed: false },
    ]);
    saveSessionOrder(cwd, { loose: ["s", "t"] });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("mobile project directory rebuilds", () => {
  // perf P3: unchanged inputs must not re-parse localStorage per project per tick.
  it("parses stored state at most once per rebuild when nothing changed", () => {
    buildMobileProjectDirectory(paths);
    const parse = vi.spyOn(JSON, "parse");
    for (let tick = 0; tick < TICKS; tick++) buildMobileProjectDirectory(paths);
    expect(parse.mock.calls.length).toBeLessThanOrEqual(TICKS);
  });

  // #1419: the live beat must not scan or read storage while nothing was written.
  it("does not scan or read storage for unchanged inputs", () => {
    const first = buildMobileProjectDirectory(paths);
    const key = vi.spyOn(Storage.prototype, "key");
    const read = vi.spyOn(Storage.prototype, "getItem");
    for (let tick = 0; tick < TICKS; tick++) expect(buildMobileProjectDirectory(paths)).toBe(first);
    expect(key).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("rebuilds after a stored write from another window", () => {
    const first = buildMobileProjectDirectory(paths);
    localStorage.setItem("bycoda.sessionOrder", "{}");
    window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.sessionOrder" }));
    expect(buildMobileProjectDirectory(paths)).not.toBe(first);
  });

  it("rebuilds after the paths change", () => {
    const first = buildMobileProjectDirectory(paths);
    expect(buildMobileProjectDirectory([...paths, "/work/extra"])).not.toBe(first);
  });

  it("returns an equal directory for unchanged inputs", () => {
    const first = buildMobileProjectDirectory(paths);
    expect(first.projects.length).toBe(PROJECTS);
    expect(JSON.stringify(buildMobileProjectDirectory(paths))).toBe(JSON.stringify(first));
  });

  it("reflects a saved session folder on the next build", () => {
    buildMobileProjectDirectory(paths);
    saveSessionFolders(paths[0], [
      { id: "fresh", name: "Fresh", sessionIds: ["x"], collapsed: true },
    ]);
    const project = buildMobileProjectDirectory(paths).projects.find((row) => row.cwd === paths[0]);
    expect(project?.sessionLayout?.folders.map((item) => item.id)).toEqual(["fresh"]);
  });
});
