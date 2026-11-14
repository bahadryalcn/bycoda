import { describe, expect, it } from "vitest";
import { withDirectServer, type McpLoadingPolicy } from "./mcp";
import { cacheMcpLoading, getCachedMcpLoading } from "./mcpSettingsCache";

const base: McpLoadingPolicy = { version: 1, mode: "onDemand", direct: ["b"] };

describe("MCP loading model", () => {
  it("adds sorted unique names and removes them", () => {
    const added = withDirectServer(withDirectServer(base, "a", true), "a", true);
    expect(added.direct).toEqual(["a", "b"]);
    expect(withDirectServer(added, "b", false).direct).toEqual(["a"]);
    expect(base.direct).toEqual(["b"]);
  });

  it("caches the last good state per project", () => {
    expect(getCachedMcpLoading("/p")).toBeUndefined();
    const state = { policy: base, corrupt: false, servers: ["a", "b"] };
    cacheMcpLoading("/p", state);
    expect(getCachedMcpLoading("/p")).toBe(state);
    expect(getCachedMcpLoading("/q")).toBeUndefined();
  });
});
