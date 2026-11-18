import { describe, expect, it } from "vitest";
import { TimeoutError } from "../../../shared/lib/withTimeout";
import {
  classifyRemoteError,
  isConnectionFailure,
  isHostAuthorizationRefusal,
  isTimeoutFailure,
  isTransientTransportError,
  presentRemoteError,
  unreachablePollDelay,
} from "./remoteFailure";
import { delegatedDiscoveryFailure } from "./useDelegatedRunDiscovery";

describe("classifyRemoteError", () => {
  it.each([
    ["RPC_WS_BLOCKED", "unreachable"],
    ["RPC_WS_SCHEMA", "unreachable"],
    ["RPC_WS_TLS", "unreachable"],
    ["RPC_WS_UNAVAILABLE", "unreachable"],
    ["RPC_WS_INTERRUPTED", "unreachable"],
    ["RPC_WS_IDENTITY", "identity"],
    ["RPC_WS_UNSUPPORTED", "outdated"],
  ])("classifies native %s as a connection failure", (code, kind) => {
    const error = Object.assign(new Error("Host admission failed"), { code });
    expect(classifyRemoteError(error).kind).toBe(kind);
    expect(classifyRemoteError(`${code}: Host admission failed`).kind).toBe(kind);
    expect(isConnectionFailure(classifyRemoteError(error))).toBe(true);
  });

  // CANCELLED once surfaced as a lasting "Retry workspace" error on a background read.
  it.each(["RPC_WS_DEADLINE", "RPC_WS_OVERLOAD", "RPC_WS_DETACHED", "RPC_WS_CANCELLED"])(
    "classifies native %s as temporary, not a lost connection",
    (code) => {
      const error = Object.assign(new Error("Host request was not sent"), { code });
      expect(classifyRemoteError(error)).toEqual({
        kind: "temporary",
        message: "Host request was not sent",
      });
      expect(classifyRemoteError(`${code}: Host request was not sent`).kind).toBe("temporary");
      expect(isConnectionFailure(classifyRemoteError(error))).toBe(false);
    },
  );

  it("keeps workspace containment and request-specific Native failures local to the operation", () => {
    for (const message of [
      "Host rejected request: Path is outside this machine’s projects",
      "RPC_WS_VALIDATION: Invalid workspace path",
      "RPC_WS_RESOURCE_RETIRED: Session was removed",
    ])
      expect(isConnectionFailure(classifyRemoteError(message))).toBe(false);
  });
  it.each([
    "Machine is unreachable. Check the host and SSH tunnel, then reconnect.",
    "SSH connection failed: Permission denied. Open Settings → Machines and reconnect to check access.",
    "SSH timed out. Open Settings → Machines and reconnect to authenticate.",
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

  it.each([
    "The host request did not complete [RPC_TIMEOUT] (workspace.run). The host exceeded the request deadline.",
    "The host request did not complete [RPC_PROTOCOL] (git.index). The endpoint did not return a valid host response.",
    "Invalid host response",
    // A Host refusing a read for capacity, as older desktops reported it.
    "Host rejected request: Host read capacity is busy; retry later.",
    "RPC_WS_OVERLOAD: Host read capacity is busy; retry later.",
    "Host pending read request limit reached",
    // The session's owner moved while the list was read; the next read answers.
    "Host rejected request: Session read owner changed; retry",
    "Session read owner changed; retry",
  ])("classifies %j as temporary, not a lost connection", (text) => {
    expect(classifyRemoteError(text).kind).toBe("temporary");
    expect(classifyRemoteError(new Error(text)).kind).toBe("temporary");
    expect(isConnectionFailure(classifyRemoteError(text))).toBe(false);
  });

  it("classifies a bounded wait that elapsed (Host discovery) as temporary", () => {
    const error = new TimeoutError("Host discovery", 20_000);
    expect(classifyRemoteError(error)).toEqual({
      kind: "temporary",
      message: "Host discovery timed out after 20000ms",
    });
    expect(delegatedDiscoveryFailure(error)).toBeUndefined();
  });

  it("recognises a host that does not know the command", () => {
    for (const text of [
      "Host rejected request: Unsupported workspace command",
      "Host rejected request: Unsupported host method",
      "Unsupported remote operation",
      "Update Bycoda Host in Machines settings to use this project’s files.",
      "Update bycoda Host in Machines settings to use this project’s files.",
    ])
      expect(classifyRemoteError(text).kind).toBe("outdated");
  });

  it("strips the host's own prefix from the message", () => {
    expect(
      classifyRemoteError("Host rejected request: Update bycoda Host in Machines settings."),
    ).toEqual({
      kind: "outdated",
      message: "Update bycoda Host in Machines settings.",
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

it("classifies serialized RPC transport errors without losing their message", () => {
  expect(
    classifyRemoteError({
      message: "The host request did not complete [RPC_HOST_UNAVAILABLE] (workspace.run).",
    }).kind,
  ).toBe("unreachable");
});
it("does not mistake a Host operation error for a transport outage", () => {
  expect(
    classifyRemoteError("Host rejected request: SSH connection failed in deployment script").kind,
  ).toBe("other");
});

describe("presentRemoteError", () => {
  it("never returns an empty message for an error without text", () => {
    expect(presentRemoteError(new Error(""), { explicit: true })).toBe(
      "Something went wrong. Try again.",
    );
    expect(presentRemoteError(new Error(""))).toBe("Something went wrong. Try again.");
  });

  it.each([
    "RPC_WS_INTERRUPTED: Host connection was interrupted",
    "Connection changed while the request was running. Its outcome is unknown; refresh before retrying an action.",
    "ConnectionReset: os error 10054",
    "ConnectionAborted",
    "TimedOut",
    "RPC_WS_DEADLINE: late",
    "RPC_WS_OVERLOAD: busy",
  ])("hides transient transport error %s on background reads", (text) => {
    expect(isTransientTransportError(text)).toBe(true);
    expect(presentRemoteError(text)).toBeUndefined();
    expect(presentRemoteError(text, { explicit: true })).toBeTruthy();
  });

  it("asks the user to repeat an action once the link is back instead of showing transport text", () => {
    expect(presentRemoteError("ConnectionReset: os error 10054", { explicit: true })).toBe(
      "Waiting for the connection to this computer. Try again once it is back.",
    );
    expect(presentRemoteError("RPC_WS_OVERLOAD: busy", { explicit: true })).toBe(
      "This computer is busy right now. Try again in a moment.",
    );
    expect(presentRemoteError("Permission denied", { explicit: true })).toBe("Permission denied");
  });

  it.each([
    "Not a Git repository",
    "RPC_WS_BLOCKED: Owner sign-in is required",
    "RPC_WS_TLS: refused",
    "RPC_WS_IDENTITY: changed",
    "Unsupported host method",
  ])("keeps real failure %s visible", (text) => {
    expect(isTransientTransportError(text)).toBe(false);
    expect(presentRemoteError(text)).toBe(text);
  });

  it("strips the host prefix", () => {
    expect(presentRemoteError("Host rejected request: bad path")).toBe("bad path");
  });
});

describe("superseded and timed-out requests", () => {
  const superseded =
    "Connection changed while the request was running. Its outcome is unknown; refresh before retrying an action.";
  it("never treats a request replaced mid-flight as an outage", () => {
    expect(classifyRemoteError(superseded).kind).toBe("temporary");
    expect(isConnectionFailure(classifyRemoteError(superseded))).toBe(false);
    expect(presentRemoteError(superseded, { explicit: true })).toContain("outcome is unknown");
  });
  it("classifies a stringified TimeoutError as temporary", () => {
    expect(classifyRemoteError("TimeoutError: Host discovery timed out after 5000ms").kind).toBe(
      "temporary",
    );
  });
});

describe("isTimeoutFailure", () => {
  it.each([
    new Error("RPC_WS_DEADLINE: late"),
    Object.assign(new Error("late"), { code: "RPC_WS_DEADLINE" }),
    "Host rejected request: [RPC_TIMEOUT] slow",
    new TimeoutError("Host discovery", 5000),
  ])("is true for a deadline failure %#", (error) => {
    expect(isTimeoutFailure(error)).toBe(true);
  });

  it.each([
    "RPC_WS_OVERLOAD: busy",
    "RPC_WS_CANCELLED: replaced",
    "Connection changed while the request was running",
    "Machine is unreachable",
    "Not a working copy",
  ])("is false for %j", (error) => {
    expect(isTimeoutFailure(error)).toBe(false);
  });
});

describe("isHostAuthorizationRefusal", () => {
  it("is true only for the Host's authorization refusal", () => {
    expect(
      isHostAuthorizationRefusal(
        new Error("Host rejected request [RPC_AUTHORIZATION] (environment.describe)."),
      ),
    ).toBe(true);
    expect(isHostAuthorizationRefusal("Host rejected request [RPC_AUTHORIZATION]")).toBe(true);
    expect(
      isHostAuthorizationRefusal(new Error("The host request did not complete [RPC_TIMEOUT]")),
    ).toBe(false);
    expect(isHostAuthorizationRefusal(undefined)).toBe(false);
  });
});
