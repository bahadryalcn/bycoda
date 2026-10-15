import { afterEach, describe, expect, it } from "vitest";
import {
  newSession,
  newSessionLike,
  planUnavailableReason,
  runtimeModeForNewSession,
  runtimeModeUnavailableReason,
  setHarnessModeLimits,
} from "./session";
import { STREAM_MODE_LIMITS } from "../../../integrations/harness/providers/antigravity/antigravityStreamProtocol";

afterEach(() => setHarnessModeLimits("antigravity", undefined));

describe("harness mode limits", () => {
  it("leaves every mode available until a transport reports a limit", () => {
    expect(runtimeModeUnavailableReason("antigravity", "supervised")).toBeUndefined();
    expect(newSession("antigravity", "/p").runtimeMode).toBe("supervised");
  });

  it("starts new sessions in auto-accept-edits when supervised is unavailable", () => {
    setHarnessModeLimits("antigravity", STREAM_MODE_LIMITS);
    expect(runtimeModeUnavailableReason("antigravity", "supervised")).toMatch(/ask before editing/);
    expect(planUnavailableReason("antigravity")).toBeTruthy();
    expect(newSession("antigravity", "/p").runtimeMode).toBe("auto-accept-edits");
    // A mode inherited from the session it was opened from is adjusted too.
    expect(
      newSessionLike({ ...newSession("antigravity", "/p"), runtimeMode: "supervised" }, "/q")
        .runtimeMode,
    ).toBe("auto-accept-edits");
    expect(runtimeModeForNewSession("antigravity", "supervised")).toBe("auto-accept-edits");
  });

  it("never rewrites an explicit mode or touches other harnesses", () => {
    setHarnessModeLimits("antigravity", STREAM_MODE_LIMITS);
    // A restored or forked session keeps what it was saved with.
    expect(newSession("antigravity", "/p", undefined, "supervised").runtimeMode).toBe("supervised");
    expect(runtimeModeForNewSession("antigravity", "auto")).toBe("auto");
    expect(runtimeModeForNewSession("antigravity", "full-access")).toBe("full-access");
    expect(runtimeModeForNewSession("claude", "supervised")).toBe("supervised");
    expect(
      newSessionLike({ ...newSession("claude", "/p"), runtimeMode: "supervised" }, "/q")
        .runtimeMode,
    ).toBe("supervised");
  });

  it("does not pick another mode unless the transport declares one", () => {
    setHarnessModeLimits("antigravity", {
      runtimeModes: { supervised: "no" },
    });
    expect(runtimeModeForNewSession("antigravity", "supervised")).toBe("supervised");
  });
});
