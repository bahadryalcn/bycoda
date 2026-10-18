import { describe, expect, it } from "vitest";
import { readToolWindow, TOOL_IDS } from "./toolWindows";

describe("tool window boot routing", () => {
  it.each(TOOL_IDS)("opens %s without treating it as a conversation transfer", (tool) => {
    const params = new URLSearchParams({ tool, cwd: "G:\\Projects\\İş & plan #1", tools: "all" });
    expect(readToolWindow(`?${params}`)).toEqual({
      active: tool,
      cwd: "G:\\Projects\\İş & plan #1",
      grouped: true,
    });
  });
  it.each(["", "?tool=settings", "?tool=servers", "?tool=__proto__", "?hostTools=x"])(
    "ignores unrelated window URLs: %s",
    (search) => {
      expect(readToolWindow(search)).toBeNull();
    },
  );
  it("defaults a missing project without changing its tool", () => {
    expect(readToolWindow("?tool=notes")).toEqual({ active: "notes", cwd: "~", grouped: false });
  });
});
