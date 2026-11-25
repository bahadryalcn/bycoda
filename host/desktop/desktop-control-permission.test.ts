import { describe, expect, it } from "vitest";
import {
  desktopGate,
  desktopGatePermits,
  isDesktopAppAllowed,
  isPlainDesktopAppName,
  normalizeDesktopConfiguration,
  sameDesktopApp,
} from "./desktop-control-permission";

describe("desktop permission gate table", () => {
  const cases = [
    // mode, kind, headed, ask, requirePresence
    ["ask", "act", false, true, false],
    ["ask", "act", true, true, true],
    ["ask", "launch", false, true, false],
    ["ask", "clipboard", false, true, true],
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
    // "auto" was a mode until the Assistant access settings became the only permission.
    for (const stored of ["bogus", "auto"])
      expect(
        normalizeDesktopConfiguration({ permissionMode: stored as never }).permissionMode,
      ).toBe("ask");
  });
  it("covers every app in full access and only approved apps otherwise", () => {
    const base = normalizeDesktopConfiguration({ allowedApps: ["Editor"] });
    const asking = normalizeDesktopConfiguration({ permissionMode: "ask", allowAllApps: true });
    expect(asking.allowAllApps).toBe(false);
    expect(isDesktopAppAllowed(asking, "Anything")).toBe(false);
    const full = normalizeDesktopConfiguration({ permissionMode: "full", allowAllApps: false });
    expect(isDesktopAppAllowed(full, "Anything")).toBe(true);
    for (const name of ["", " ", "-option", "a\nb", "x".repeat(201)])
      expect(isPlainDesktopAppName(name)).toBe(false);
    expect(isPlainDesktopAppName("Google Chrome")).toBe(true);
    expect(isDesktopAppAllowed(base, "Anything")).toBe(false);
    expect(isDesktopAppAllowed(base, "Editor")).toBe(true);
  });
});
describe("desktop app names", () => {
  it("matches Windows process names regardless of case and .exe, and exactly elsewhere", () => {
    expect(sameDesktopApp("chrome.exe", "Chrome", "win32")).toBe(true);
    expect(sameDesktopApp("CHROME.EXE", "chrome.exe", "win32")).toBe(true);
    expect(sameDesktopApp("chrome.exe", "Google Chrome", "win32")).toBe(false);
    expect(sameDesktopApp("chrome.exe", "Chrome", "darwin")).toBe(false);
    const approved = normalizeDesktopConfiguration({ allowedApps: ["chrome.exe"] });
    expect(isDesktopAppAllowed(approved, "Chrome", "win32")).toBe(true);
    expect(isDesktopAppAllowed(approved, "Chrome", "darwin")).toBe(false);
  });
});
