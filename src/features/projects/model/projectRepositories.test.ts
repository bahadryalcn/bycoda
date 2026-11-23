import { beforeEach, describe, expect, it, vi } from "vitest";

const gitRemotes = vi.hoisted(() => vi.fn());
const connection = vi.hoisted(() => ({ status: "connected" }));
vi.mock("../../../platform/tauri/fs", () => ({ gitRemotes }));
vi.mock("../../connections/public/remoteHealth", () => ({
  readRemoteConnection: () => connection,
}));

import {
  foldLinkedProjects,
  linkedProjectOnMachine,
  hasLinkableCopy,
  loadProjectRepositories,
  loadSeparatedProjects,
  projectLinks,
  refreshProjectRepositories,
  repositoryIdFromUrl,
  resetProjectRepositoryReads,
  setProjectShownSeparately,
  subscribeProjectRepositories,
} from "./projectRepositories";
import { pathKey } from "../../../shared/lib/paths";

const PC = "G:\Projects\clinic";
const MAC = "remote://mac-env/Users/me/clinic";
const repositories = (entries: Record<string, string>) =>
  Object.fromEntries(Object.entries(entries).map(([path, id]) => [pathKey(path), id]));

describe("repositoryIdFromUrl", () => {
  it("gives every spelling of one hosted repository the same id", () => {
    const id = "github.com/owner/clinic";
    for (const url of [
      "https://github.com/Owner/Clinic.git",
      "https://token@github.com/owner/clinic/",
      "git@github.com:owner/clinic.git",
      "ssh://git@github.com:22/owner/clinic",
    ])
      expect(repositoryIdFromUrl(url)).toBe(id);
  });

  it("links nothing through a local remote", () => {
    for (const url of [
      "C:/repos/clinic",
      "C:\repos\clinic",
      "/srv/git/clinic.git",
      "file:///srv/clinic",
      "",
    ])
      expect(repositoryIdFromUrl(url)).toBe("");
  });
});

describe("projectLinks", () => {
  it("folds another machine's copy into this computer's row", () => {
    const links = projectLinks(
      [MAC, PC],
      repositories({ [PC]: "h/o/clinic", [MAC]: "h/o/clinic" }),
    );
    expect(links.rowOf(MAC)).toBe(PC);
    expect(links.rowOf(PC)).toBe(PC);
    expect(linkedProjectOnMachine(links, PC, "mac-env")).toBe(MAC);
    expect(linkedProjectOnMachine(links, MAC, undefined)).toBe(PC);
    expect(linkedProjectOnMachine(links, PC, "other-env")).toBeUndefined();
  });

  it("keeps two clones on one machine as separate rows", () => {
    const second = "G:\Projects\clinic-2";
    const links = projectLinks(
      [PC, second, MAC],
      repositories({ [PC]: "h/o/clinic", [second]: "h/o/clinic", [MAC]: "h/o/clinic" }),
    );
    expect(links.rowOf(second)).toBe(second);
    expect(links.rowOf(MAC)).toBe(PC);
    expect(links.copiesOf(second)).toEqual([second]);
  });

  it("leaves folders without a hosted remote alone", () => {
    const links = projectLinks([PC, MAC], repositories({ [PC]: "", [MAC]: "" }));
    expect(links.rowOf(MAC)).toBe(MAC);
  });

  it("drops folded copies from the rail and keeps the newest use", () => {
    const links = projectLinks(
      [PC, MAC],
      repositories({ [PC]: "h/o/clinic", [MAC]: "h/o/clinic" }),
    );
    expect(
      foldLinkedProjects(
        [
          { path: MAC, openedAt: 9 },
          { path: PC, openedAt: 3 },
        ],
        links,
      ),
    ).toEqual([{ path: PC, openedAt: 9 }]);
  });
});

describe("projects shown separately", () => {
  const same = repositories({ [PC]: "h/o/clinic", [MAC]: "h/o/clinic" });

  it("keeps a separated project as its own row and folds nothing into it", () => {
    const links = projectLinks([PC, MAC], same, new Set([pathKey(MAC)]));
    expect(links.rowOf(MAC)).toBe(MAC);
    expect(links.rowOf(PC)).toBe(PC);
    expect(links.copiesOf(PC)).toEqual([PC]);
    const other = "remote://pi-env/home/me/clinic";
    const three = projectLinks(
      [PC, MAC, other],
      repositories({ [PC]: "h/o/clinic", [MAC]: "h/o/clinic", [other]: "h/o/clinic" }),
      new Set([pathKey(PC)]),
    );
    expect(three.rowOf(PC)).toBe(PC);
    expect(three.rowOf(other)).toBe(MAC);
  });

  it("offers the choice only where another machine has the repository", () => {
    expect(hasLinkableCopy(PC, [PC, MAC], same)).toBe(true);
    expect(hasLinkableCopy(PC, [PC, "G:\\Projects\\clinic-2"], same)).toBe(false);
    expect(hasLinkableCopy(PC, [PC, MAC], repositories({ [PC]: "", [MAC]: "" }))).toBe(false);
  });

  describe("saved", () => {
    beforeEach(() => {
      const stored = new Map<string, string>();
      vi.stubGlobal("localStorage", {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => void stored.set(key, value),
      });
      vi.stubGlobal("window", new EventTarget());
      resetProjectRepositoryReads();
      gitRemotes.mockReset();
      connection.status = "connected";
    });

    it("persists, notifies and keeps the set stable until it changes", () => {
      const listener = vi.fn();
      const stop = subscribeProjectRepositories(listener);
      const empty = loadSeparatedProjects();
      expect(loadSeparatedProjects()).toBe(empty);
      setProjectShownSeparately(MAC, true);
      expect(listener).toHaveBeenCalledTimes(1);
      const saved = loadSeparatedProjects();
      expect(saved).not.toBe(empty);
      expect([...saved]).toEqual([pathKey(MAC)]);
      expect(loadSeparatedProjects()).toBe(saved);
      setProjectShownSeparately(MAC, true);
      expect(listener).toHaveBeenCalledTimes(1);
      setProjectShownSeparately(MAC, false);
      expect(loadSeparatedProjects().size).toBe(0);
      stop();
    });

    it("forgets projects that left the rail", async () => {
      gitRemotes.mockResolvedValue([{ name: "origin", url: "git@github.com:owner/clinic.git" }]);
      setProjectShownSeparately(PC, true);
      setProjectShownSeparately(MAC, true);
      await refreshProjectRepositories([PC]);
      expect([...loadSeparatedProjects()]).toEqual([pathKey(PC)]);
    });
  });
});

describe("refreshProjectRepositories", () => {
  beforeEach(() => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    });
    vi.stubGlobal("window", new EventTarget());
    resetProjectRepositoryReads();
    gitRemotes.mockReset();
    connection.status = "connected";
  });

  it("reads origin once and saves it by project", async () => {
    gitRemotes.mockResolvedValue([
      { name: "fork", url: "git@github.com:me/clinic.git" },
      { name: "origin", url: "git@github.com:owner/clinic.git" },
    ]);
    await refreshProjectRepositories([PC, MAC]);
    await refreshProjectRepositories([PC, MAC]);
    expect(gitRemotes).toHaveBeenCalledTimes(2);
    expect(loadProjectRepositories()).toEqual(
      repositories({ [PC]: "github.com/owner/clinic", [MAC]: "github.com/owner/clinic" }),
    );
  });

  it("keeps an offline machine's identity and asks again once it connects", async () => {
    gitRemotes.mockResolvedValue([{ name: "origin", url: "git@github.com:owner/clinic.git" }]);
    await refreshProjectRepositories([MAC]);
    resetProjectRepositoryReads();
    connection.status = "disconnected";
    await refreshProjectRepositories([MAC]);
    expect(gitRemotes).toHaveBeenCalledTimes(1);
    expect(loadProjectRepositories()[pathKey(MAC)]).toBe("github.com/owner/clinic");
    connection.status = "connected";
    gitRemotes.mockRejectedValueOnce(new Error("timeout"));
    await refreshProjectRepositories([MAC]);
    await refreshProjectRepositories([MAC]);
    expect(gitRemotes).toHaveBeenCalledTimes(3);
  });

  it("forgets projects that left the rail", async () => {
    gitRemotes.mockResolvedValue([{ name: "origin", url: "git@github.com:owner/clinic.git" }]);
    await refreshProjectRepositories([PC, MAC]);
    await refreshProjectRepositories([PC]);
    expect(Object.keys(loadProjectRepositories())).toEqual([pathKey(PC)]);
  });
});
