import { describe, expect, it } from "vitest";
import { classifyRemoteError, isConnectionFailure, unreachablePollDelay } from "./remoteFailure";

describe("classifyRemoteError", () => {
  it.each([
    "Machine is unreachable. Check the host and SSH tunnel, then reconnect.",
    "SSH connection failed: Permission denied. Open Settings → Connections and reconnect to check access.",
    "SSH timed out. Open Settings → Connections and reconnect to authenticate.",
    "Could not start OpenSSH: not found",
    "The host request did not complete [RPC_HOST_UNAVAILABLE] (workspace.run:read_text_file).",
    "The host request did not complete [RPC_CONNECTION_INTERRUPTED] (workspace.run).",
    "Machine is no longer connected",
    "This project’s machine isn’t connected on this computer.",
    "Connect this project’s machine to open its files.",
  ])("treats %j as unreachable", (text) => {
    expect(classifyRemoteError(text).kind).toBe("unreachable");
    expect(classifyRemoteError(new Error(text)).kind).toBe("unreachable");
  });

  it("recognises a host that does not know the command", () => {
    for (const text of [
      "Host rejected request: Unsupported workspace command",
      "Host rejected request: Unsupported host method",
      "Unsupported remote operation",
      "Update Bycoda Host in Connections settings to use this project’s files.",
      "Update bycoda Host in Connections settings to use this project’s files.",
    ])
      expect(classifyRemoteError(text).kind).toBe("outdated");
  });

  it("strips the host's own prefix from the message", () => {
    expect(
      classifyRemoteError("Host rejected request: Update bycoda Host in Connections settings."),
    ).toEqual({
      kind: "outdated",
      message: "Update bycoda Host in Connections settings.",
    });
  });

  it("recognises a command this app does not offer remotely", () => {
    expect(
      classifyRemoteError(new Error("This isn’t available for projects on another machine yet."))
        .kind,
    ).toBe("unsupported");
  });

  it("leaves the host's own errors alone, without its prefix", () => {
    expect(classifyRemoteError("Host rejected request: Branch x does not exist")).toEqual({
      kind: "other",
      message: "Branch x does not exist",
    });
    expect(
      classifyRemoteError("The host request did not complete. Retry to confirm its result.").kind,
    ).toBe("other");
    expect(classifyRemoteError({ code: 1 }).kind).toBe("other");
  });

  it("only machine-level kinds count as connection failures", () => {
    expect(isConnectionFailure({ kind: "unreachable", message: "" })).toBe(true);
    expect(isConnectionFailure({ kind: "outdated", message: "" })).toBe(true);
    expect(isConnectionFailure({ kind: "unsupported", message: "" })).toBe(false);
    expect(isConnectionFailure({ kind: "other", message: "" })).toBe(false);
  });

  it("slows polling to 15 then 30 seconds", () => {
    expect([1, 2, 5].map(unreachablePollDelay)).toEqual([15_000, 30_000, 30_000]);
  });
});
