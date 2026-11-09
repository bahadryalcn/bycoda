// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  notifyTabGroupLogosChanged,
  saveRailBackgrounds,
  saveTabGroupColor,
  saveTabGroupLabel,
  saveTabGroupLogo,
  saveTabGroupMascot,
} from "../../features/workspace/model/tabGroups";
import {
  getSessionProjectAppearanceSnapshot,
  getSessionProjectBackground,
  subscribeSessionProjectAppearance,
} from "./sessionProjectAppearanceStore";

afterEach(() => localStorage.clear());

describe("session project appearance store", () => {
  it("shares subscriptions and refreshes all saved appearance in the same window", () => {
    const first = vi.fn();
    const second = vi.fn();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const unsubscribeFirst = subscribeSessionProjectAppearance(first);
    const unsubscribeSecond = subscribeSessionProjectAppearance(second);
    expect(add.mock.calls.filter(([type]) => type === "storage")).toHaveLength(1);
    const initial = getSessionProjectAppearanceSnapshot();
    expect(getSessionProjectAppearanceSnapshot()).toBe(initial);

    saveTabGroupLabel("project", "Custom");
    saveTabGroupColor("project", 1);
    saveTabGroupMascot("project", "fox");
    saveRailBackgrounds("project", { header: { color: "#123456", opacity: 50 } });
    saveTabGroupLogo("project", "/logo.png");
    notifyTabGroupLogosChanged();
    const updated = getSessionProjectAppearanceSnapshot();
    expect(updated.labels.project).toBe("Custom");
    expect(updated.colors.project).toBe(1);
    expect(updated.mascots.project).toBe("fox");
    expect(updated.logos.project).toBe("/logo.png");
    expect(getSessionProjectBackground(updated, "project")).toEqual({
      color: "#123456",
      opacity: 50,
    });
    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();

    unsubscribeFirst();
    expect(remove.mock.calls.filter(([type]) => type === "storage")).toHaveLength(0);
    unsubscribeSecond();
    expect(remove.mock.calls.filter(([type]) => type === "storage")).toHaveLength(1);
    add.mockRestore();
    remove.mockRestore();
  });

  it("refreshes on sibling-window storage events and tolerates unavailable storage", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSessionProjectAppearance(listener);
    const before = getSessionProjectAppearanceSnapshot();
    window.dispatchEvent(new StorageEvent("storage"));
    expect(listener).toHaveBeenCalledOnce();
    expect(getSessionProjectAppearanceSnapshot()).not.toBe(before);
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => window.dispatchEvent(new StorageEvent("storage"))).not.toThrow();
    expect(getSessionProjectAppearanceSnapshot().labels).toEqual({});
    getItem.mockRestore();
    unsubscribe();
  });
});
