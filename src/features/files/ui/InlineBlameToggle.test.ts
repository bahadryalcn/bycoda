import { describe, expect, it } from "vitest";
import { inlineBlameUnavailableReason } from "./InlineBlameToggle";

describe("inlineBlameUnavailableReason", () => {
  it("allows a file inside a local project", () => {
    expect(inlineBlameUnavailableReason("/repo", "/repo/a.ts")).toBeNull();
    expect(inlineBlameUnavailableReason("/repo", "/other/a.ts")).toMatch(/inside a git project/);
  });

  it("allows a remote file only on a host that supports it", () => {
    const cwd = "remote://env/repo";
    const path = "remote://env/repo/a.ts";
    expect(inlineBlameUnavailableReason(cwd, path, true)).toBeNull();
    expect(inlineBlameUnavailableReason(cwd, path, false)).toMatch(/Update bycoda Host/);
    expect(inlineBlameUnavailableReason(cwd, path, undefined)).toMatch(/Checking/);
    expect(inlineBlameUnavailableReason(cwd, "/repo/a.ts", true)).toMatch(/inside a git project/);
  });
});
