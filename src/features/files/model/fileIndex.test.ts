import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectFile } from "../../../platform/tauri/fs";
import { listDir, listProjectFiles, statFiles } from "../../../platform/tauri/fs";
import {
  invalidateProjectFiles,
  loadProjectFiles,
  peekProjectFiles,
  rankProjectFiles,
  rememberOpenedFile,
  resolveFileOpenRequest,
  resolveOpenablePath,
  subscribeProjectFiles,
} from "./fileIndex";
import { scorePath } from "../../../shared/lib/fuzzy";
import { notifyDirsChanged } from "./fileTree";

const cwd = "/Users/me/project";
const files: ProjectFile[] = [
  {
    name: "App.tsx",
    path: "/Users/me/project/apps/desktop/src/App.tsx",
    relative: "apps/desktop/src/App.tsx",
  },
  {
    name: "App.tsx",
    path: "/Users/me/project/apps/web/src/App.tsx",
    relative: "apps/web/src/App.tsx",
  },
  {
    name: "main.tsx",
    path: "/Users/me/project/apps/desktop/src/main.tsx",
    relative: "apps/desktop/src/main.tsx",
  },
];

const extra: ProjectFile = {
  name: "pasted.ts",
  path: "/Users/me/project/pasted.ts",
  relative: "pasted.ts",
};

vi.mock("../../../platform/tauri/fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../platform/tauri/fs")>();
  return {
    ...actual,
    listProjectFiles: vi.fn(async () => files),
    listDir: vi.fn(async () => []),
    statFiles: vi.fn(async () => []),
  };
});

const list = vi.mocked(listProjectFiles);
const dir = vi.mocked(listDir);
const stat = vi.mocked(statFiles);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("resolveOpenablePath", () => {
  beforeEach(() => {
    invalidateProjectFiles();
    list.mockReset();
    list.mockResolvedValue(files);
    dir.mockReset();
    dir.mockResolvedValue([]);
    stat.mockReset();
    stat.mockResolvedValue([]);
  });

  it("maps a basename-only link to the shortest matching project path", async () => {
    const resolved = await resolveOpenablePath(cwd, "App.tsx");
    expect(resolved).toBe(files[1].path);
  });

  it("prefers recently opened files for ambiguous basenames", async () => {
    rememberOpenedFile(cwd, files[1].path);
    const resolved = await resolveOpenablePath(cwd, "App.tsx");
    expect(resolved).toBe(files[1].path);
  });

  it("matches a relative project path", async () => {
    const resolved = await resolveOpenablePath(cwd, "apps/desktop/src/main.tsx");
    expect(resolved).toBe(files[2].path);
  });

  it("still opens a direct file when the optional project index is unavailable", async () => {
    list.mockRejectedValue(new Error("Project scan unavailable"));
    await expect(resolveOpenablePath(cwd, "apps/desktop/src/main.tsx")).resolves.toBe(
      files[2].path,
    );
  });

  it("finds a generated file the index leaves out in an ignored folder", async () => {
    const pdf = `${cwd}/.artifacts/reports/summary.pdf`;
    const entry = (path: string, isDir: boolean, ignored: boolean) => ({
      name: path.split("/").pop()!,
      path,
      isDir,
      ignored,
    });
    stat.mockResolvedValue([{ path: `${cwd}/summary.pdf`, mtimeMs: null }]);
    dir.mockImplementation(async (path) => {
      if (path === cwd)
        return [
          entry(`${cwd}/apps`, true, false),
          entry(`${cwd}/node_modules`, true, true),
          entry(`${cwd}/.artifacts`, true, true),
        ];
      if (path === `${cwd}/.artifacts`) return [entry(`${cwd}/.artifacts/reports`, true, false)];
      if (path === `${cwd}/.artifacts/reports`) return [entry(pdf, false, false)];
      throw new Error(`unexpected listing of ${path}`);
    });
    await expect(resolveOpenablePath(cwd, "summary.pdf")).resolves.toBe(pdf);
  });

  it("finds an ignored file on a remote machine from an absolute remote path", async () => {
    const remote = "remote://env1/Users/me/project";
    const png = `${remote}/Screenshots/lumisqa/ui.png`;
    const entry = (path: string, isDir: boolean, ignored: boolean) => ({
      name: path.split("/").pop()!,
      path,
      isDir,
      ignored,
    });
    list.mockResolvedValue([{ name: "a.ts", path: `${remote}/a.ts`, relative: "a.ts" }]);
    stat.mockResolvedValue([{ path: `${remote}/ui.png`, mtimeMs: null }]);
    dir.mockImplementation(async (path) => {
      if (path === remote) return [entry(`${remote}/Screenshots`, true, true)];
      if (path === `${remote}/Screenshots`)
        return [entry(`${remote}/Screenshots/lumisqa`, true, true)];
      if (path === `${remote}/Screenshots/lumisqa`) return [entry(png, false, false)];
      throw new Error(`unexpected listing of ${path}`);
    });
    await expect(resolveOpenablePath(remote, `${remote}/ui.png`)).resolves.toBe(png);
    // The session's folder need not be the project root the path sits under.
    await expect(resolveOpenablePath(`${remote}/Screenshots`, `${remote}/ui.png`)).resolves.toBe(
      png,
    );
  });

  it("finds a file created after the index was read", async () => {
    const created: ProjectFile = {
      name: "new.ts",
      path: `${cwd}/lib/new.ts`,
      relative: "lib/new.ts",
    };
    await loadProjectFiles(cwd);
    list.mockResolvedValue([...files, created]);
    stat.mockResolvedValue([{ path: `${cwd}/new.ts`, mtimeMs: null }]);
    await expect(resolveOpenablePath(cwd, "new.ts")).resolves.toBe(created.path);
  });

  it("keeps an unindexed path that exists", async () => {
    const ignored = `${cwd}/.artifacts/notes.md`;
    stat.mockResolvedValue([{ path: ignored, mtimeMs: 5 }]);
    await expect(resolveOpenablePath(cwd, ".artifacts/notes.md")).resolves.toBe(ignored);
    expect(dir).not.toHaveBeenCalled();
  });

  it("keeps an existing absolute path ahead of a matching indexed basename", async () => {
    const path = "/outside/My Project/App.tsx";
    stat.mockResolvedValue([{ path, mtimeMs: 5 }]);
    await expect(resolveOpenablePath(cwd, path)).resolves.toBe(path);
    expect(list).not.toHaveBeenCalled();
  });

  it("keeps an existing directory instead of resolving a same-named file", async () => {
    const path = `${cwd}/App.tsx`;
    stat.mockResolvedValue([{ path, mtimeMs: null, isDir: true }]);
    await expect(resolveOpenablePath(cwd, path)).resolves.toBe(path);
    expect(list).not.toHaveBeenCalled();
  });

  it("preserves an exact path even when it is absent from the project index", async () => {
    const ignored = `${cwd}/ignored/App.tsx`;
    await expect(resolveFileOpenRequest(cwd, ignored, { exact: true })).resolves.toBe(ignored);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("loadProjectFiles", () => {
  beforeEach(() => {
    invalidateProjectFiles();
    list.mockReset();
    list.mockResolvedValue(files);
  });

  afterEach(() => {
    vi.useRealTimers();
    invalidateProjectFiles();
  });

  it("returns the cached listing until refresh", async () => {
    await loadProjectFiles(cwd);
    list.mockResolvedValue([...files, extra]);
    expect(await loadProjectFiles(cwd)).toEqual(files);
    expect(list).toHaveBeenCalledTimes(1);
    expect(await loadProjectFiles(cwd, true)).toEqual([...files, extra]);
    expect(peekProjectFiles(cwd)).toEqual([...files, extra]);
  });

  it("does not drop a refresh that arrives while a scan is in flight", async () => {
    const first = deferred<ProjectFile[]>();
    const second = deferred<ProjectFile[]>();
    list.mockImplementationOnce(() => first.promise);
    list.mockImplementationOnce(() => second.promise);

    const initial = loadProjectFiles(cwd);
    const refresh = loadProjectFiles(cwd, true);
    expect(list).toHaveBeenCalledTimes(2);

    first.resolve(files);
    expect(await initial).toEqual(files);
    expect(peekProjectFiles(cwd)).toBeNull();

    second.resolve([...files, extra]);
    expect(await refresh).toEqual([...files, extra]);
    expect(peekProjectFiles(cwd)).toEqual([...files, extra]);
  });

  it("reuses the in-flight scan when refresh is not requested", async () => {
    const pending = deferred<ProjectFile[]>();
    list.mockImplementationOnce(() => pending.promise);

    const first = loadProjectFiles(cwd);
    const second = loadProjectFiles(cwd);
    expect(list).toHaveBeenCalledTimes(1);

    pending.resolve(files);
    expect(await first).toEqual(files);
    expect(await second).toEqual(files);
  });

  it("keeps both worktree indexes during repeated tab switches", async () => {
    const other = "/Users/me/project-worktree";
    const otherFiles = [{ ...extra, path: `${other}/pasted.ts` }];
    list.mockImplementation(async (path) => (path === cwd ? files : otherFiles));

    for (let index = 0; index < 10; index++) {
      expect(await loadProjectFiles(cwd)).toBe(files);
      expect(await loadProjectFiles(other)).toBe(otherFiles);
    }
    expect(list).toHaveBeenCalledTimes(2);
    expect(peekProjectFiles(cwd)).toBe(files);
    expect(peekProjectFiles(other)).toBe(otherFiles);
  });

  it("lets scans for separate worktrees finish independently", async () => {
    const other = "/Users/me/project-worktree";
    const first = deferred<ProjectFile[]>();
    const second = deferred<ProjectFile[]>();
    list.mockImplementationOnce(() => first.promise);
    list.mockImplementationOnce(() => second.promise);
    const firstScan = loadProjectFiles(cwd);
    const secondScan = loadProjectFiles(other);
    expect(loadProjectFiles(cwd)).toBe(firstScan);
    expect(loadProjectFiles(other)).toBe(secondScan);
    first.resolve(files);
    second.resolve([extra]);
    await Promise.all([firstScan, secondScan]);
    expect(peekProjectFiles(cwd)).toBe(files);
    expect(peekProjectFiles(other)).toEqual([extra]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("invalidates one worktree without evicting or cancelling another", async () => {
    const other = "/Users/me/project-worktree";
    await loadProjectFiles(cwd);
    await loadProjectFiles(other);
    invalidateProjectFiles(cwd);
    expect(peekProjectFiles(cwd)).toBeNull();
    expect(await loadProjectFiles(other)).toBe(files);
    expect(list).toHaveBeenCalledTimes(2);
    await loadProjectFiles(cwd);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("does not let an invalidated scan restore its old listing", async () => {
    const pending = deferred<ProjectFile[]>();
    list.mockImplementationOnce(() => pending.promise);
    const scan = loadProjectFiles(cwd);
    invalidateProjectFiles(cwd);
    pending.resolve(files);
    await scan;
    expect(peekProjectFiles(cwd)).toBeNull();
  });

  it("bounds retained worktrees and keeps recently revisited ones", async () => {
    for (let index = 0; index < 8; index++) {
      await loadProjectFiles(`/repo/tree-${index}`);
    }
    await loadProjectFiles("/repo/tree-0");
    await loadProjectFiles("/repo/tree-8");
    expect(peekProjectFiles("/repo/tree-0")).toBe(files);
    expect(peekProjectFiles("/repo/tree-1")).toBeNull();
    expect(list).toHaveBeenCalledTimes(9);
  });

  it("notifies subscribers when the listing changes", async () => {
    const onChange = vi.fn();
    const stop = subscribeProjectFiles(onChange);
    await loadProjectFiles(cwd);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(peekProjectFiles(cwd)).toEqual(files);
    stop();
  });

  it("reloads after a directory change", async () => {
    vi.useFakeTimers();
    await loadProjectFiles(cwd);
    list.mockResolvedValue([...files, extra]);

    const onChange = vi.fn();
    const stop = subscribeProjectFiles(onChange);
    onChange.mockClear();
    notifyDirsChanged();

    await vi.runAllTimersAsync();
    expect(peekProjectFiles(cwd)).toEqual([...files, extra]);
    expect(onChange).toHaveBeenCalled();
    stop();
  });

  it("does not drop a scan for a different project", async () => {
    const other = "/Users/me/other";
    const pending = deferred<ProjectFile[]>();
    list.mockImplementationOnce(() => pending.promise);

    const scan = loadProjectFiles(other);
    invalidateProjectFiles(cwd);
    pending.resolve(files);

    expect(await scan).toEqual(files);
    expect(peekProjectFiles(other)).toEqual(files);
  });
});

describe("rankProjectFiles", () => {
  it("isolates remote machines and shares concurrent refreshes without losing indexes on local navigation", async () => {
    invalidateProjectFiles();
    list.mockReset();
    const first = "remote://first/work/repo";
    const second = "remote://second/work/repo";
    const pending = deferred<ProjectFile[]>();
    list.mockReturnValueOnce(pending.promise).mockResolvedValue(files);
    const a = loadProjectFiles(first);
    const b = loadProjectFiles(first, true);
    expect(list).toHaveBeenCalledTimes(1);
    pending.resolve(files);
    await Promise.all([a, b, loadProjectFiles(second), loadProjectFiles(cwd)]);
    expect(peekProjectFiles(first)).toEqual(files);
    expect(peekProjectFiles(second)).toEqual(files);
    await loadProjectFiles(first);
    expect(list).toHaveBeenCalledTimes(3);
    invalidateProjectFiles(first);
    expect(peekProjectFiles(first)).toBeNull();
    expect(peekProjectFiles(second)).toEqual(files);
  });
  function oldRank(all: ProjectFile[], query: string, recents: string[], limit: number) {
    const recentRank = new Map(recents.map((path, index) => [path, index]));
    const scored = [];
    for (const file of all) {
      const hit = scorePath(query, file.relative, file.name);
      if (!hit) continue;
      const recency = recentRank.get(file.path);
      const score = hit.score + (recency == null ? 0 : (30 - recency) * 8);
      scored.push({ ...file, score, positions: hit.positions });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.relative.length !== b.relative.length) {
        return a.relative.length - b.relative.length;
      }
      return a.relative.localeCompare(b.relative);
    });
    return scored.slice(0, limit);
  }

  const synthetic: ProjectFile[] = [];
  const dirs = ["src", "src/app", "lib", "packages/core/src", "test"];
  const names = ["index.ts", "main.ts", "util.ts", "App.tsx", "mod.rs", "a.ts"];
  for (let i = 0; i < 400; i += 1) {
    const relative = `${dirs[i % dirs.length]}/${names[i % names.length]}`;
    // Repeated relative paths and equal lengths force every tie-break level.
    const rel = i % 7 === 0 ? relative : `${relative.slice(0, -3)}${i % 10}.ts`;
    synthetic.push({
      name: rel.split("/").pop()!,
      path: `/p/${i}/${rel}`,
      relative: rel,
    });
  }

  it("returns the same ordered list as a full sort, for several limits", () => {
    const recents = [synthetic[5].path, synthetic[300].path, synthetic[17].path];
    for (const query of ["ts", "main", "src/app", "idx", "zzz"]) {
      for (const limit of [1, 7, 80, 1000]) {
        expect(rankProjectFiles(synthetic, query, recents, limit)).toEqual(
          oldRank(synthetic, query, recents, limit),
        );
      }
    }
  });
});
