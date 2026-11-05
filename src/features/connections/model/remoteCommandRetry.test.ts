import { describe, expect, it } from "vitest";
import {
  classifyCommandFailure,
  COMMAND_RETRY_AUTOMATIC_LIMIT,
  commandRetryDelay,
  createCommandRetryBackoff,
} from "./remoteCommandRetry";

const native = (code: string, message = "Host request failed", uncertain = false) =>
  Object.assign(new Error(`${code}: ${message}`), { code, uncertain });

describe("classifyCommandFailure", () => {
  it("treats a Host refusal as definitive", () => {
    expect(classifyCommandFailure("Host rejected request: Branch x does not exist")).toBe(
      "definitive",
    );
    expect(classifyCommandFailure(native("RPC_WS_VALIDATION", "Invalid command"))).toBe(
      "definitive",
    );
    expect(
      classifyCommandFailure(
        "This request is older than 30 days and was not run. Check whether it already happened and send it again.",
      ),
    ).toBe("definitive");
    expect(classifyCommandFailure(native("RPC_WS_IDENTITY"))).toBe("definitive");
  });

  it.each(["RPC_WS_DEADLINE", "RPC_WS_OVERLOAD", "RPC_WS_DETACHED", "RPC_WS_UNAVAILABLE"])(
    "treats %s as a request that was not sent",
    (code) => {
      expect(classifyCommandFailure(native(code))).toBe("not-sent");
      expect(classifyCommandFailure(`${code}: Host admission failed`)).toBe("not-sent");
    },
  );

  it("treats a blocked lane as not sent", () => {
    expect(
      classifyCommandFailure(native("RPC_WS_BLOCKED", "Host authentication was refused")),
    ).toBe("not-sent");
  });

  it("treats an offline machine as not sent", () => {
    for (const text of [
      "Machine is unreachable. Check the host and SSH tunnel, then reconnect.",
      "Machine is no longer connected",
      "This project’s machine isn’t connected on this computer.",
      "The machine is still not answering.",
      "SSH timed out connecting to the machine.",
    ])
      expect(classifyCommandFailure(text)).toBe("not-sent");
  });

  it("treats an interrupted or deadline-exceeded response as uncertain", () => {
    expect(classifyCommandFailure(native("RPC_WS_INTERRUPTED"))).toBe("uncertain");
    expect(
      classifyCommandFailure(
        native(
          "RPC_WS_DEADLINE",
          "Host result arrived after the request deadline. The operation outcome is unknown; reconcile its command receipt before retrying.",
          true,
        ),
      ),
    ).toBe("uncertain");
    expect(
      classifyCommandFailure(
        "The host request did not complete [RPC_CONNECTION_INTERRUPTED] (commands.dispatch).",
      ),
    ).toBe("uncertain");
  });

  it("keeps a native uncertainty flag over a not-sent code", () => {
    expect(classifyCommandFailure(native("RPC_WS_UNAVAILABLE", "lost", true))).toBe("uncertain");
  });

  it("treats anything unrecognised as uncertain, so its receipt is checked", () => {
    expect(classifyCommandFailure(new Error("The host did not confirm the request."))).toBe(
      "uncertain",
    );
    expect(classifyCommandFailure("Pending requests changed; try again.")).toBe("uncertain");
  });
});

describe("commandRetryDelay", () => {
  it("retries at once first, then doubles from 2 s and stops at 30 s", () => {
    expect([0, 1, 2, 3, 4, 5, 9, 100].map(commandRetryDelay)).toEqual([
      0, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });
});

describe("automatic limit", () => {
  it("leaves a pending command to the Retry button after the limit", () => {
    expect(COMMAND_RETRY_AUTOMATIC_LIMIT).toBe(20);
    const longest = Array.from({ length: COMMAND_RETRY_AUTOMATIC_LIMIT }, (_, index) =>
      commandRetryDelay(index + 1),
    ).reduce((total, delay) => total + delay, 0);
    expect(longest).toBeLessThan(11 * 60_000);
  });
});

describe("createCommandRetryBackoff", () => {
  it("is due at once, then waits on the injected clock", () => {
    let now = 1_000;
    const backoff = createCommandRetryBackoff(() => now);
    expect(backoff.remainingMs()).toBe(0);
    backoff.failed();
    expect(backoff.failures).toBe(1);
    expect(backoff.remainingMs()).toBe(2_000);
    now += 1_500;
    expect(backoff.remainingMs()).toBe(500);
    now += 500;
    expect(backoff.remainingMs()).toBe(0);
    backoff.failed();
    expect(backoff.remainingMs()).toBe(4_000);
  });

  it("resets once the command is confirmed", () => {
    let now = 0;
    const backoff = createCommandRetryBackoff(() => now);
    backoff.failed();
    backoff.failed();
    backoff.reset();
    expect(backoff.failures).toBe(0);
    expect(backoff.remainingMs()).toBe(0);
  });
});
