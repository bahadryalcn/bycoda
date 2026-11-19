import { expect, it } from "vitest";
import { isFatalStreamFailure } from "./liveStreamRecovery";

it("ends live view at once for failures a retry cannot fix", () => {
  for (const message of [
    "DEVICE_STREAM_UNSUPPORTED: Live view needs an Android device on a Windows or macOS Host.",
    "DEVICE_AUTHORITY_REVOKED: Device access changed.",
    "DEVICE_NOT_FOUND: Discover devices on the selected machine.",
    "Boot the device before viewing",
    "Device host is disposed",
    "Host rejected request [RPC_AUTHORIZATION]",
    "Host identity changed. Add this machine again before continuing.",
    "Unsupported host method devices.stream",
    "Machine connection is disabled",
  ])
    expect(isFatalStreamFailure(new Error(message)), message).toBe(true);
  expect(isFatalStreamFailure(Object.assign(new Error("closed"), { code: "RPC_WS_IDENTITY" }))).toBe(
    true,
  );
  expect(isFatalStreamFailure("DEVICE_AUTHORITY_REVOKED")).toBe(true);
});

it("retries connection, timeout and decoder failures", () => {
  for (const cause of [
    new Error("RPC_WS_DEADLINE: request timed out"),
    new Error("Machine is unreachable"),
    new Error("Host read capacity is busy"),
    new DOMException("Decoding failed", "EncodingError"),
    Object.assign(new Error("closed"), { code: "RPC_WS_INTERRUPTED" }),
    undefined,
  ])
    expect(isFatalStreamFailure(cause)).toBe(false);
});
