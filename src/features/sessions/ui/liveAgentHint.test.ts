// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { liveAgentHint } from "./LiveAgentsPreview";

describe("liveAgentHint", () => {
  it("adds nothing for a local row whose title, project and status are already visible", () => {
    expect(liveAgentHint({ waitReason: "", remote: false, remoteLabel: "On another machine" })).toBe(
      "",
    );
  });

  it("uses the translated remote label instead of a hard-coded English marker", () => {
    const hint = liveAgentHint({
      waitReason: "",
      remote: true,
      remoteLabel: "Auf einer anderen Maschine",
    });
    expect(hint).toBe("Auf einer anderen Maschine");
    expect(hint).not.toContain("(remote)");
  });

  it("adds the full wait reason, which the row only shows as a short status", () => {
    expect(
      liveAgentHint({ waitReason: "Waiting for 2 commands", remote: false, remoteLabel: "x" }),
    ).toBe("Waiting for 2 commands");
  });

  it("keeps the wait reason and the remote marker on separate lines when both apply", () => {
    expect(
      liveAgentHint({
        waitReason: "Waiting for 2 commands",
        remote: true,
        remoteLabel: "On another machine",
      }),
    ).toBe("Waiting for 2 commands\nOn another machine");
  });
});
