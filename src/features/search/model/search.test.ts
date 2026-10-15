import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { cancelProjectSearch, searchProject } from "./search";
import {
  cancelSessionSearch,
  searchSessionContent,
  searchSessions,
} from "../../sessions/data/sessionStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("project search cancellation", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("passes the owner id with search and cancel commands", async () => {
    const options = {
      cwd: "/repo",
      query: "needle",
      searchId: "search-7",
    };
    vi.mocked(invoke).mockResolvedValueOnce({ matches: [], truncated: false });
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await searchProject(options);
    await cancelProjectSearch(options.cwd, options.searchId);

    expect(invoke).toHaveBeenNthCalledWith(1, "search_project", { options });
    expect(invoke).toHaveBeenNthCalledWith(2, "cancel_project_search", {
      cwd: "/repo",
      searchId: "search-7",
    });
  });

  it("passes the owner id with session search and cancel commands", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ hits: [], truncated: false });
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await searchSessions({ query: "needle", searchOwner: "owner-1" });
    await cancelSessionSearch("owner-1");

    expect(invoke).toHaveBeenNthCalledWith(1, "session_search", {
      options: { query: "needle", searchOwner: "owner-1" },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "cancel_session_search", {
      searchOwner: "owner-1",
    });
  });

  it("sends only the set filters with a content search", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      sessions: [],
      truncated: false,
      pending: 3,
    });

    const result = await searchSessionContent({
      query: " needle ",
      searchOwner: "owner-2",
      cwds: ["C:/Work/One/"],
      harness: "codex",
      since: 5,
    });

    expect(invoke).toHaveBeenCalledWith("session_search_content", {
      options: {
        query: "needle",
        searchOwner: "owner-2",
        cwds: ["C:/Work/One"],
        harness: "codex",
        since: 5,
      },
    });
    expect(result.pending).toBe(3);
  });

  it("does not send remote cancellation to this computer", async () => {
    await cancelProjectSearch("remote://env/home/me/repo", "remote-search");
    expect(invoke).not.toHaveBeenCalled();
  });
});
