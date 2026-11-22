import { describe, expect, it } from "vitest";
import { workItemSearchNotice } from "./workItemSearchNotice";

const t = ((key: string, params?: Record<string, string | number>) =>
  key.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name]))) as Parameters<
  typeof workItemSearchNotice
>[2];

describe("workItemSearchNotice", () => {
  it.each([
    [{ failure: "missing-tool" as const }, "Box", "GitHub CLI missing on Box"],
    [{ failure: "missing-tool" as const }, undefined, "GitHub CLI missing on this computer"],
    [{ failure: "unauthenticated" as const }, "Box", "Sign in to GitHub on Box"],
    [{ failure: "not-found" as const }, "Box", "Repository not found"],
    [{ failure: "repository-unresolved" as const }, undefined, "Repository not found"],
    [{ failure: "remote-host-unavailable" as const }, "Box", "Connected machine unavailable"],
    [{ failure: "provider-failed" as const }, undefined, "Search failed"],
    [{ failure: "failed" as const }, undefined, "Search failed"],
  ])("maps %j on %s", (error, machine, text) => {
    expect(workItemSearchNotice(error, machine, t, 0)).toBe(text);
  });

  it("rounds the rate-limit wait up and drops it once it has passed", () => {
    const error = { failure: "rate-limited" as const, retryAt: 10_500 };
    expect(workItemSearchNotice(error, undefined, t, 10_000)).toBe("Rate limited, retry in 1 s");
    expect(workItemSearchNotice(error, undefined, t, 11_000)).toBe("Rate limited");
    expect(workItemSearchNotice({ failure: "rate-limited" }, undefined, t, 0)).toBe("Rate limited");
  });
});
