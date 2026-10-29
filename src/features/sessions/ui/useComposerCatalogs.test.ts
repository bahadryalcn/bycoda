import { describe, expect, it } from "vitest";
import { visibleProjectFiles } from "./useComposerMentionSources";
import { mcpCatalogScope, visibleMcpCatalog } from "./useComposerMcpCatalog";

describe("scoped composer catalogs", () => {
  it("does not show project files read for another directory", () => {
    const files = [{ path: "a.ts" }] as never[];
    expect(visibleProjectFiles({ cwd: "/a", files }, "/a")).toBe(files);
    expect(visibleProjectFiles({ cwd: "/a", files }, "/b")).toEqual([]);
  });

  it("does not show an MCP snapshot from another directory or health mode", () => {
    const scope = mcpCatalogScope("/a", true);
    const state = {
      scope,
      connections: [],
      status: new Map([["server", "Connected"]]),
      loading: false,
      error: "",
    };
    expect(visibleMcpCatalog(state, scope, true)).toBe(state);
    expect(visibleMcpCatalog(state, mcpCatalogScope("/b", true), true).loading).toBe(true);
    expect(visibleMcpCatalog(state, mcpCatalogScope("/a", false), false).loading).toBe(false);
    expect(visibleMcpCatalog(null, scope, true).status.size).toBe(0);
  });
});
