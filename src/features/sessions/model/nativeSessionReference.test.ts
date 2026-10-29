import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import {
  nativeSessionReference,
  resolveNativeSessionReference,
} from "./nativeSessionReference";

const locator = {
  kind: "native" as const,
  sourceStoreId: "persisted-store",
  sourceProfileId: "persisted-profile",
  sessionId: "conversation",
};

describe("native local session references", () => {
  beforeEach(() => invoke.mockReset());

  it("uses the stored identity rather than inventing a locator for a missing row", async () => {
    invoke.mockResolvedValueOnce(null);
    expect(await nativeSessionReference("missing")).toBeNull();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("session_reference_get", {
      sessionId: "missing",
    });
    invoke.mockResolvedValueOnce({ locator });
    expect(await nativeSessionReference("conversation")).toEqual(locator);
  });

  it("sends all origin coordinates for native validation and never falls back by session id", async () => {
    invoke.mockResolvedValueOnce(null);
    expect(await resolveNativeSessionReference(locator)).toBeNull();
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      "session_reference_resolve",
      {
        sourceStoreId: "persisted-store",
        sourceProfileId: "persisted-profile",
        sessionId: "conversation",
      },
    );
  });

  it("retains verified committed Host mapping and propagates unreadable-store errors", async () => {
    const host = {
      kind: "host",
      environmentId: "local-environment",
      sessionId: "conversation",
    };
    invoke.mockResolvedValueOnce({ locator: host });
    expect(await nativeSessionReference("conversation")).toEqual(host);
    invoke.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(resolveNativeSessionReference(locator)).rejects.toThrow(
      "database unavailable",
    );
  });
});
