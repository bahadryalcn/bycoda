import { describe, expect, it } from "vitest";
import {
  desktopGate,
  desktopGatePermits,
  isDesktopAppAllowed,
  normalizeDesktopConfiguration,
} from "./desktop-control-permission";

describe("desktop permission gate table", () => {
  const cases = [
    // mode, kind, headed, ask, requirePresence
    ["ask", "act", false, true, false],
    ["ask", "act", true, true, true],
    ["ask", "launch", false, true, false],
    ["ask", "clipboard", false, true, true],
    ["auto", "act", false, false, false],
    ["auto", "act", true, true, true],
    ["auto", "launch", false, true, false],
    ["auto", "clipboard", false, true, true],
    ["full", "act", false, false, false],
    ["full", "act", true, false, false],
    ["full", "launch", false, false, false],
    ["full", "clipboard", false, false, false],
  ] as const;
  it.each(cases)("%s %s headed=%s", (mode, kind, headed, ask, requirePresence) => {
    expect(desktopGate({ mode, kind, headed })).toEqual({ ask, requirePresence });
  });
  it("permits only with approval when asked and presence when required", () => {
    const gate = { ask: true, requirePresence: true };
    expect(desktopGatePermits(gate, { approved: true, ownerPresent: true })).toBe(true);
    expect(desktopGatePermits(gate, { approved: false, ownerPresent: true })).toBe(false);
    expect(desktopGatePermits(gate, { approved: true, ownerPresent: undefined })).toBe(false);
    const open = { ask: false, requirePresence: false };
    expect(desktopGatePermits(open, { approved: false, ownerPresent: false })).toBe(true);
  });
});

describe("desktop configuration normalization", () => {
  it("reads old stored configs as ask without all-apps", () => {
    const old = {
      enabled: true,
      binaryPath: "x",
      binarySha256: "",
      allowedApps: ["Editor"],
      allowPhysicalInput: true,
      version: 3,
    };
    expect(normalizeDesktopConfiguration(old)).toMatchObject({
      permissionMode: "ask",
      allowAllApps: false,
      version: 3,
    });
    const bogus = normalizeDesktopConfiguration({ permissionMode: "bogus" as never });
    expect(bogus.permissionMode).toBe("ask");
  });
  it("honors allow-all-apps only in full access", () => {
    const base = normalizeDesktopConfiguration({ allowedApps: ["Editor"] });
    const auto = normalizeDesktopConfiguration({ permissionMode: "auto", allowAllApps: true });
    expect(auto.allowAllApps).toBe(false);
    const full = normalizeDesktopConfiguration({ permissionMode: "full", allowAllApps: true });
    expect(isDesktopAppAllowed(full, "Anything")).toBe(true);
    expect(isDesktopAppAllowed(base, "Anything")).toBe(false);
    expect(isDesktopAppAllowed(base, "Editor")).toBe(true);
  });
});
