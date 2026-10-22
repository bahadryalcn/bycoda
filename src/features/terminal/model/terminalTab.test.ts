import { describe, expect, it } from "vitest";
import { newTerminalFile } from "../../workspace/model/layout";
import {
  applyTerminalMeta,
  defaultTerminalTitle,
  listRunningTerminals,
  runningTerminalChipLabel,
  parseOsc7Cwd,
  scanOscCwd,
  terminalTabLabel,
  newTerminalCwd,
} from "./terminalTab";

describe("newTerminalCwd", () => {
  it("prefers an active worktree over a pane in another checkout", () => {
    expect(
      newTerminalCwd({
        activeFile: { cwd: "/main" },
        session: { cwd: "/main", worktreeCwd: "/worktree" },
        fallback: "/fallback",
      }),
    ).toBe("/worktree");
  });
  it("excludes removed worktrees and retains the focused pane fallback", () => {
    expect(
      newTerminalCwd({
        activeFile: { cwd: "/pane" },
        session: { cwd: "/main", worktreeCwd: "/removed", worktreeRemoved: true },
        fallback: "/fallback",
      }),
    ).toBe("/pane");
    expect(newTerminalCwd({ session: { cwd: "/main" }, fallback: "/fallback" })).toBe("/main");
    expect(newTerminalCwd({ fallback: "/fallback" })).toBe("/fallback");
  });
});

describe("defaultTerminalTitle", () => {
  it("uses the directory basename", () => {
    expect(defaultTerminalTitle("/Users/dev/agent-terminal")).toBe("agent-terminal");
    expect(defaultTerminalTitle("/")).toBe("Terminal");
  });
});

describe("terminalTabLabel", () => {
  it("prefers the dynamic title on the tab", () => {
    const file = newTerminalFile("/repo", "npm");
    expect(terminalTabLabel(file)).toBe("npm");
  });
});

describe("applyTerminalMeta", () => {
  it("records a foreground process and clears it", () => {
    const file = newTerminalFile("/repo", "repo");
    const running = applyTerminalMeta(file, {
      title: "vite",
      foreground: "vite",
    });
    expect(running).toMatchObject({ path: "vite", foreground: "vite" });
    expect(running).not.toBe(file);

    const idle = applyTerminalMeta(running, {
      title: "repo",
      foreground: null,
    });
    expect(idle.path).toBe("repo");
    expect(idle.foreground).toBeUndefined();
  });

  it("returns the same object when nothing changes", () => {
    const file = applyTerminalMeta(newTerminalFile("/repo", "vite"), {
      foreground: "vite",
    });
    expect(applyTerminalMeta(file, { foreground: "vite" })).toBe(file);
  });
});

describe("listRunningTerminals", () => {
  it("skips idle shells", () => {
    const idle = newTerminalFile("/repo");
    const running = applyTerminalMeta(newTerminalFile("/repo", "dev"), {
      foreground: "vite",
    });
    expect(listRunningTerminals([idle, running])).toEqual([
      {
        id: running.id,
        process: "vite",
        cwd: "/repo",
        label: "repo",
      },
    ]);
  });
});

describe("runningTerminalChipLabel", () => {
  it("joins unique names and collapses duplicates", () => {
    expect(
      runningTerminalChipLabel([
        { id: "a", process: "vite", cwd: "/a", label: "a" },
        { id: "b", process: "jest", cwd: "/b", label: "b" },
      ]),
    ).toBe("vite · jest");
    expect(
      runningTerminalChipLabel([
        { id: "a", process: "vite", cwd: "/a", label: "a" },
        { id: "b", process: "vite", cwd: "/b", label: "b" },
      ]),
    ).toBe("vite ×2");
  });
});

describe("scanOscCwd", () => {
  it("extracts cwd from OSC 7 reports", () => {
    const chunk = "\x1b]7;file://host/Users/dev/repo\x07";
    const { cwd, rest } = scanOscCwd(chunk, "");
    expect(cwd).toBe("/Users/dev/repo");
    expect(rest).toBe("");
  });

  it("keeps a trailing buffer for split sequences", () => {
    const partial = "\x1b]7;file://host/Users/dev";
    const { cwd, rest } = scanOscCwd("/repo\x07", partial);
    expect(cwd).toBe("/Users/dev/repo");
    expect(rest).toBe("");
  });
});

describe("parseOsc7Cwd", () => {
  it("extracts and decodes the path from an OSC 7 payload", () => {
    expect(parseOsc7Cwd("file://host/Users/dev/my%20repo")).toBe("/Users/dev/my repo");
    expect(parseOsc7Cwd("file:///C:/work")).toBe("/C:/work");
  });

  it("ignores payloads that are not file URLs", () => {
    expect(parseOsc7Cwd("http://host/x")).toBeUndefined();
    expect(parseOsc7Cwd("file://host")).toBeUndefined();
  });
});
