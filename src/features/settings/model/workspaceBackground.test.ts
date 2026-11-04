// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAppearanceSaveIssues, retryAppearanceSave } from "./appearancePersistence";
import {
  initWorkspaceBackground,
  loadWorkspaceBackground,
  readWorkspaceBackgroundIssue,
  normalizeWorkspaceBackground,
  saveWorkspaceBackground,
  subscribeWorkspaceBackground,
  WORKSPACE_BACKGROUND_DEFAULT,
} from "./workspaceBackground";

const key = "bycoda.workspaceBackground.v1";
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key }));
  initWorkspaceBackground();
});

describe("workspace background", () => {
  it("migrates missing or malformed data to a disabled default and rejects CSS injection", () => {
    localStorage.setItem(key, "not json");
    expect(loadWorkspaceBackground().enabled).toBe(false);
    const value = normalizeWorkspaceBackground({
      enabled: true,
      colors: ["#ffffff);url(evil)", "#ffffff", "#000000"],
      angle: Infinity,
      strength: 500,
    });
    expect(value.colors).toEqual(WORKSPACE_BACKGROUND_DEFAULT.colors);
    expect(value.angle).toBe(WORKSPACE_BACKGROUND_DEFAULT.angle);
    expect(value.strength).toBe(100);
  });

  it("applies and removes CSS without changing glass preferences", () => {
    localStorage.setItem("bycoda.bodyGlass", "0");
    expect(
      saveWorkspaceBackground({ ...WORKSPACE_BACKGROUND_DEFAULT, enabled: true, strength: 36 }),
    ).toBe(true);
    expect(document.documentElement.classList.contains("has-workspace-background")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--workspace-background-strength")).toBe(
      "0.36",
    );
    expect(localStorage.getItem("bycoda.bodyGlass")).toBe("0");
    saveWorkspaceBackground(WORKSPACE_BACKGROUND_DEFAULT);
    expect(document.documentElement.classList.contains("has-workspace-background")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--workspace-background-image")).toBe(
      "",
    );
  });

  it("keeps failed draft visible, retries it, and reports durable failure", () => {
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("disk full");
    });
    expect(saveWorkspaceBackground({ ...WORKSPACE_BACKGROUND_DEFAULT, enabled: true })).toBe(false);
    expect(loadWorkspaceBackground().enabled).toBe(true);
    expect(
      readAppearanceSaveIssues().some((issue) => issue.settingId === "workspace-background"),
    ).toBe(true);
    write.mockRestore();
    expect(retryAppearanceSave(key)).toBe(true);
    expect(JSON.parse(localStorage.getItem(key)!).enabled).toBe(true);
  });

  it("does not replay a failed draft over a sibling write", () => {
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("disk full");
    });
    saveWorkspaceBackground({ ...WORKSPACE_BACKGROUND_DEFAULT, enabled: true, style: "mesh" });
    write.mockRestore();
    const sibling = JSON.stringify({
      ...WORKSPACE_BACKGROUND_DEFAULT,
      enabled: false,
      style: "radial",
    });
    localStorage.setItem(key, sibling);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: sibling }));
    expect(loadWorkspaceBackground().enabled).toBe(true);
    expect(retryAppearanceSave(key)).toBe(false);
    expect(readWorkspaceBackgroundIssue()).toBe("conflict");
    expect(localStorage.getItem(key)).toBe(sibling);
    saveWorkspaceBackground(WORKSPACE_BACKGROUND_DEFAULT, { replace: true });
  });

  it("notifies subscribers on sibling updates with a stable snapshot", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceBackground(listener);
    localStorage.setItem(key, JSON.stringify({ ...WORKSPACE_BACKGROUND_DEFAULT, enabled: true }));
    window.dispatchEvent(new StorageEvent("storage", { key }));
    expect(listener).toHaveBeenCalled();
    expect(loadWorkspaceBackground()).toBe(loadWorkspaceBackground());
    expect(document.documentElement.classList.contains("has-workspace-background")).toBe(true);
    unsubscribe();
  });

  it("merges a local edit with unrelated changes made by a sibling", () => {
    const original = loadWorkspaceBackground();
    localStorage.setItem(key, JSON.stringify({ ...original, angle: 70 }));
    saveWorkspaceBackground({ ...original, enabled: true }, { base: original });
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ enabled: true, angle: 70 });
  });

  it("holds a same-field conflict until explicit replacement", () => {
    const original = loadWorkspaceBackground();
    localStorage.setItem(key, JSON.stringify({ ...original, style: "radial" }));
    expect(saveWorkspaceBackground({ ...original, style: "mesh" }, { base: original })).toBe(false);
    expect(readWorkspaceBackgroundIssue()).toBe("conflict");
    expect(JSON.parse(localStorage.getItem(key)!).style).toBe("radial");
    expect(saveWorkspaceBackground({ ...original, style: "mesh" }, { replace: true })).toBe(true);
    expect(JSON.parse(localStorage.getItem(key)!).style).toBe("mesh");
  });

  it("retains earlier failed edits when a later local edit merges a sibling change", () => {
    const original = loadWorkspaceBackground();
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("disk full");
    });
    saveWorkspaceBackground({ ...original, enabled: true }, { base: original });
    const draft = loadWorkspaceBackground();
    write.mockRestore();
    localStorage.setItem(key, JSON.stringify({ ...original, angle: 70 }));
    window.dispatchEvent(new StorageEvent("storage", { key }));
    expect(loadWorkspaceBackground()).toBe(draft);
    saveWorkspaceBackground({ ...draft, strength: 80 }, { base: draft });
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
      enabled: true,
      angle: 70,
      strength: 80,
    });
  });

  it("keeps a last known snapshot when storage becomes unreadable or malformed", () => {
    saveWorkspaceBackground({ ...WORKSPACE_BACKGROUND_DEFAULT, enabled: true });
    const known = loadWorkspaceBackground();
    localStorage.setItem(key, "broken json");
    expect(loadWorkspaceBackground()).toBe(known);
    expect(readWorkspaceBackgroundIssue()).toBe("unavailable");
    expect(loadWorkspaceBackground()).toBe(known);
    expect(readWorkspaceBackgroundIssue()).toBe("unavailable");
    const read = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(loadWorkspaceBackground()).toBe(known);
    expect(saveWorkspaceBackground({ ...known, strength: 70 }, { base: known })).toBe(false);
    read.mockRestore();
    saveWorkspaceBackground(WORKSPACE_BACKGROUND_DEFAULT, { replace: true });
    expect(readWorkspaceBackgroundIssue()).toBeNull();
  });
});
