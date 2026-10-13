import { afterEach, describe, expect, it } from "vitest";
import { STREAM_MODE_LIMITS } from "../../../integrations/harness/providers/antigravity/antigravityStreamProtocol";
import { runtimeModeUnavailableReason, setHarnessModeLimits } from "../../sessions/model/session";
import {
  applyQuickCatalog,
  liveQuickCatalog,
  quickLaunchRefusal,
  quickRuntimeMode,
} from "./quickComposer";

afterEach(() => setHarnessModeLimits("antigravity", undefined));

describe("quick composer access-mode limits", () => {
  it("defaults a new quick session to supervised when nothing is limited", () => {
    expect(quickRuntimeMode("antigravity", null)).toBe("supervised");
    expect(quickRuntimeMode("claude", null)).toBe("supervised");
  });

  it("defaults to the transport's allowed mode when supervised is unavailable", () => {
    setHarnessModeLimits("antigravity", STREAM_MODE_LIMITS);
    expect(quickRuntimeMode("antigravity", null)).toBe("auto-accept-edits");
    expect(quickRuntimeMode("claude", null)).toBe("supervised");
  });

  it("never rewrites a picked mode, and refuses the launch instead", () => {
    setHarnessModeLimits("antigravity", STREAM_MODE_LIMITS);
    expect(quickRuntimeMode("antigravity", "supervised")).toBe("supervised");
    expect(quickLaunchRefusal("antigravity", "supervised")).toMatch(
      /Supervised access is unavailable: Headless agy cannot ask before editing/,
    );
    expect(quickLaunchRefusal("antigravity", "auto-accept-edits")).toBe(undefined);
    expect(quickLaunchRefusal("claude", "supervised")).toBe(undefined);
  });

  it("refuses plan launches where plan turns cannot run", () => {
    setHarnessModeLimits("antigravity", STREAM_MODE_LIMITS);
    expect(quickLaunchRefusal("antigravity", "auto", "plan")).toBe(STREAM_MODE_LIMITS.plan);
    expect(quickLaunchRefusal("antigravity", "auto")).toBe(undefined);
  });

  it("carries the limits to the panel's own webview with the catalog", () => {
    setHarnessModeLimits("antigravity", STREAM_MODE_LIMITS);
    const payload = JSON.parse(JSON.stringify(liveQuickCatalog()));
    // The panel starts with nothing known.
    setHarnessModeLimits("antigravity", undefined);
    expect(runtimeModeUnavailableReason("antigravity", "supervised")).toBe(undefined);
    applyQuickCatalog(payload);
    expect(runtimeModeUnavailableReason("antigravity", "supervised")).toMatch(/ask before editing/);
    expect(quickRuntimeMode("antigravity", null)).toBe("auto-accept-edits");
    // A later catalog without limits clears them.
    applyQuickCatalog({ ...payload, modeLimits: {} });
    expect(runtimeModeUnavailableReason("antigravity", "supervised")).toBe(undefined);
  });

  it("ignores malformed limits", () => {
    applyQuickCatalog({
      models: {},
      availableHarnesses: [],
      modeLimits: { antigravity: { runtimeModes: { supervised: 7 }, plan: 3 } },
    });
    expect(runtimeModeUnavailableReason("antigravity", "supervised")).toBe(undefined);
  });
});
