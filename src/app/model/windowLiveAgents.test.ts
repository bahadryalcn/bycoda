import { describe, expect, it } from "vitest";
import { mergeWindowLiveAgents } from "./windowLiveAgents";
import type { LiveAgent } from "../../features/sessions/model/liveAgents";

const agent = (id: string, activity = "Working"): LiveAgent => ({
  id,
  cwd: "/project",
  title: id,
  harness: "claude",
  activity,
  needsApproval: false,
  done: false,
});

describe("cross-window working summaries", () => {
  it("clears stale host notifications after the adopted owner has seen the session", () => {
    const done = { ...agent("host-id", "Done"), done: true };
    expect(
      mergeWindowLiveAgents(
        [done],
        [
          {
            ownerWindowLabel: "window-2",
            agents: [],
            ownedSessionKeys: { "shell-id": "host-id" },
          },
        ],
        "main",
        {},
      ),
    ).toEqual([]);
    expect(
      mergeWindowLiveAgents(
        [],
        [
          {
            ownerWindowLabel: "window-2",
            agents: [done],
          },
        ],
        "main",
        { "shell-id": "host-id" },
      ),
    ).toEqual([]);
  });

  it("retains local ownership during acknowledged handoff and adds other owners", () => {
    const local = agent("local", "local activity");
    expect(
      mergeWindowLiveAgents(
        [local],
        [
          { ownerWindowLabel: "main", agents: [agent("stale")] },
          {
            ownerWindowLabel: "window-2",
            agents: [agent("local"), agent("other")],
          },
        ],
        "main",
      ),
    ).toEqual([local, { ...agent("other"), ownerWindowLabel: "window-2" }]);
  });

  it("deduplicates host work advertised by several windows and retains approval priority", () => {
    const waiting = { ...agent("waiting"), needsApproval: true };
    expect(
      mergeWindowLiveAgents(
        [],
        [
          { ownerWindowLabel: "window-1", agents: [agent("host"), waiting] },
          { ownerWindowLabel: "window-2", agents: [agent("host")] },
        ],
        "main",
      ),
    ).toEqual([
      { ...waiting, ownerWindowLabel: "window-1" },
      { ...agent("host"), ownerWindowLabel: "window-1" },
    ]);
  });

  it("drops departed windows when their snapshots are removed", () => {
    expect(mergeWindowLiveAgents([agent("local")], [], "main")).toEqual([agent("local")]);
  });

  it("focuses the actual adopted owner instead of a locally synthesized host summary", () => {
    expect(
      mergeWindowLiveAgents(
        [agent("host-id")],
        [
          {
            ownerWindowLabel: "window-2",
            agents: [agent("shell-id")],
            ownedSessionKeys: { "shell-id": "host-id" },
          },
        ],
        "main",
        {},
      ),
    ).toEqual([{ ...agent("shell-id"), ownerWindowLabel: "window-2" }]);
  });
});
