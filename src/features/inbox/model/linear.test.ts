// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  clearLinearCache,
  disconnectLinear,
  linearIssueComment,
  linearIssueDetails,
  linearIssueThread,
  linearTeamIdsForFetch,
  peekLinearIssueDetails,
  peekLinearIssueThread,
  saveLinearToken,
  readHiddenLinearTeamIds,
  requireHiddenLinearTeamIds,
  saveHiddenLinearTeamIds,
  subscribeLinearScope,
} from "./linear";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("linear issue details cache", () => {
  it("caps at 128 entries, evicting the least recently read", async () => {
    vi.mocked(invoke).mockImplementation(
      async (_command, args) => ({ id: (args as { id: string }).id }) as never,
    );
    for (let i = 0; i < 128; i++) await linearIssueDetails(`lin-${i}`);
    // Reading lin-0 refreshes it, so lin-1 is now the oldest.
    expect(peekLinearIssueDetails("lin-0")).not.toBeNull();
    await linearIssueDetails("lin-128");

    expect(peekLinearIssueDetails("lin-0")).not.toBeNull();
    expect(peekLinearIssueDetails("lin-1")).toBeNull();
    expect(peekLinearIssueDetails("lin-2")).not.toBeNull();
    expect(peekLinearIssueDetails("lin-128")).not.toBeNull();
  });
});

/** Holds each call of one command until the test settles it, so completions can arrive out of order. */
function holdCommand(command: string) {
  const held: ((value: unknown) => void)[] = [];
  vi.mocked(invoke).mockImplementation(((name: string, args: unknown) => {
    if (name !== command) return Promise.resolve({ args });
    return new Promise((resolve) => held.push(resolve));
  }) as never);
  return held;
}

describe("linear thread cache", () => {
  it("caps at 128 entries, evicting the least recently read", async () => {
    clearLinearCache();
    vi.mocked(invoke).mockImplementation(
      async (_command, args) => ({ comments: [], id: (args as { id: string }).id }) as never,
    );
    for (let i = 0; i < 128; i++) await linearIssueThread(`thr-${i}`);
    expect(peekLinearIssueThread("thr-0")).not.toBeNull();
    await linearIssueThread("thr-128");

    expect(peekLinearIssueThread("thr-0")).not.toBeNull();
    expect(peekLinearIssueThread("thr-1")).toBeNull();
    expect(peekLinearIssueThread("thr-128")).not.toBeNull();
  });

  it("keeps the forced refresh result when the older request resolves last", async () => {
    clearLinearCache();
    const held = holdCommand("linear_issue_thread");
    const stale = linearIssueThread("lin-a");
    const fresh = linearIssueThread("lin-a", { force: true });
    expect(held).toHaveLength(2);
    held[1]({ comments: ["fresh"] });
    await fresh;
    held[0]({ comments: ["stale"] });
    await stale;

    expect(peekLinearIssueThread("lin-a")).toEqual({ comments: ["fresh"] });
  });

  it("does not cache a thread that was in flight when a comment was posted", async () => {
    clearLinearCache();
    const held = holdCommand("linear_issue_thread");
    const stale = linearIssueThread("lin-b");
    await linearIssueComment("lin-b", "hello");
    held[0]({ comments: ["before comment"] });
    await stale;

    expect(peekLinearIssueThread("lin-b")).toBeNull();
  });
});

describe("linear cache scope", () => {
  it("clears cached details and threads when the token is saved or removed", async () => {
    for (const change of [
      () => saveLinearToken(" lin_api_new "),
      () => disconnectLinear(),
    ] as const) {
      clearLinearCache();
      vi.mocked(invoke).mockImplementation(
        async (_command, args) => ({ id: (args as { id?: string }).id, connected: true }) as never,
      );
      await linearIssueDetails("lin-c");
      await linearIssueThread("lin-c");
      expect(peekLinearIssueDetails("lin-c")).not.toBeNull();
      expect(peekLinearIssueThread("lin-c")).not.toBeNull();

      await change();

      expect(peekLinearIssueDetails("lin-c")).toBeNull();
      expect(peekLinearIssueThread("lin-c")).toBeNull();
    }
  });

  it("sends the trimmed token to the Host and an empty one on disconnect", async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue({ connected: true } as never);
    await saveLinearToken(" lin_api_new ");
    await disconnectLinear();

    expect(invoke).toHaveBeenNthCalledWith(1, "linear_set_token", { token: "lin_api_new" });
    expect(invoke).toHaveBeenNthCalledWith(2, "linear_set_token", { token: "" });
  });

  it("does not repopulate details or threads from requests started before a token change", async () => {
    clearLinearCache();
    const heldThread = holdCommand("linear_issue_thread");
    const thread = linearIssueThread("lin-d");
    await disconnectLinear();
    heldThread[0]({ comments: ["old account"] });
    await thread;
    expect(peekLinearIssueThread("lin-d")).toBeNull();

    const heldDetails = holdCommand("linear_issue_details");
    const details = linearIssueDetails("lin-d");
    await saveLinearToken("lin_api_other");
    heldDetails[0]({ body: "old account" });
    await details;
    expect(peekLinearIssueDetails("lin-d")).toBeNull();
  });
});

describe("linearTeamIdsForFetch", () => {
  const teams = [
    { id: "t1", key: "ENG", name: "Engineering" },
    { id: "t2", key: "DES", name: "Design" },
  ];

  it("sends no team filter when nothing is hidden", () => {
    expect(linearTeamIdsForFetch(teams, [])).toBeNull();
  });

  it("keeps visible team ids", () => {
    expect(linearTeamIdsForFetch(teams, ["t2"])).toEqual(["t1"]);
  });

  it("returns empty when every known team is hidden", () => {
    expect(linearTeamIdsForFetch(teams, ["t1", "t2"])).toEqual([]);
  });

  it("sends no team filter when hidden ids match no team", () => {
    expect(linearTeamIdsForFetch(teams, ["gone"])).toBeNull();
  });

  it("keeps later-page teams when one or every first-page team is hidden", () => {
    const allTeams = Array.from({ length: 53 }, (_, index) => ({
      id: `team-${index}`,
      key: `T${index}`,
      name: `Team ${index}`,
    }));
    expect(linearTeamIdsForFetch(allTeams, ["team-0"])).toHaveLength(52);
    expect(linearTeamIdsForFetch(allTeams, ["team-0"])).toContain("team-52");
    expect(
      linearTeamIdsForFetch(
        allTeams,
        allTeams.slice(0, 50).map((team) => team.id),
      ),
    ).toEqual(["team-50", "team-51", "team-52"]);
  });
});

describe("linear saved team scope", () => {
  it("separates an empty scope from an unreadable one and fails closed", () => {
    localStorage.removeItem("bycoda.linearHiddenTeams");
    expect(readHiddenLinearTeamIds()).toEqual([]);
    localStorage.setItem("bycoda.linearHiddenTeams", "{not json");
    expect(readHiddenLinearTeamIds()).toBeNull();
    expect(() => requireHiddenLinearTeamIds()).toThrow("scope is unavailable");
    localStorage.removeItem("bycoda.linearHiddenTeams");
  });

  it("reports whether a save was read back and tells sibling windows", () => {
    const changed = vi.fn();
    const stop = subscribeLinearScope(changed);
    expect(saveHiddenLinearTeamIds(["t1"])).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.linearHiddenTeams" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(changed).toHaveBeenCalledTimes(2);
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(saveHiddenLinearTeamIds(["t2"])).toBe(false);
    setItem.mockRestore();
    expect(readHiddenLinearTeamIds()).toEqual(["t1"]);
    stop();
    localStorage.removeItem("bycoda.linearHiddenTeams");
  });
});
