import { describe, expect, it, vi } from "vitest";
vi.mock("../../../shared/i18n", () => ({
  t: (s: string, values?: Record<string, string>) =>
    s.replace(/\{(\w+)\}/g, (_, key: string) => values?.[key] ?? key),
}));
import {
  PERMISSION_IDS,
  permissionBadge,
  permissionInfo,
  permissionInstructions,
  permissionReady,
  unknownPermission,
} from "./permissions";

describe("OS permission semantics", () => {
  it("maps every permission to its consumers and never equates unknown with ready", () => {
    expect(PERMISSION_IDS).toHaveLength(6);
    for (const id of PERMISSION_IDS) {
      expect(permissionInfo(id).usedBy).toBeTruthy();
      expect(unknownPermission(id)).toMatchObject({ state: "unknown", canRequest: false });
    }
    for (const state of ["unknown", "denied", "not-determined", "restricted"] as const) {
      expect(permissionReady(state)).toBe(false);
      expect(permissionBadge(state).tone).not.toBe("success");
    }
    expect(permissionReady("not-required")).toBe(true);
    expect(permissionBadge("not-required").label).not.toBe("Allowed");
    expect(permissionInfo("camera").usedBy).toContain("terminals");
    expect(permissionInfo("microphone").usedBy).toContain("wake word");
  });
  it("names the actual OS toggles and Linux portal", () => {
    expect(permissionInstructions("microphone", "windows")).toContain(
      "Let desktop apps access your microphone",
    );
    expect(permissionInstructions("screen-recording", "macos")).toContain(
      "Screen & System Audio Recording",
    );
    expect(permissionInstructions("notifications", "macos")).toContain("Notifications > bycoda");
    expect(permissionInstructions("camera", "linux")).toContain("portal");
  });
});
