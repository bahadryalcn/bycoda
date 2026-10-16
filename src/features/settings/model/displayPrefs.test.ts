// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Storage } from "happy-dom";
import {
  loadMaskEmails,
  loadShowRemainingUsage,
  saveMaskEmails,
  saveShowRemainingUsage,
  subscribeMaskEmails,
  subscribeShowRemainingUsage,
} from "./displayPrefs";

const prefs = [
  {
    name: "show remaining usage",
    key: "bycoda.showRemainingUsage",
    load: loadShowRemainingUsage,
    save: saveShowRemainingUsage,
    subscribe: subscribeShowRemainingUsage,
  },
  {
    name: "mask emails",
    key: "bycoda.maskEmails",
    load: loadMaskEmails,
    save: saveMaskEmails,
    subscribe: subscribeMaskEmails,
  },
];

beforeEach(() => vi.stubGlobal("localStorage", new Storage()));

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe.each(prefs)("$name preference", (pref) => {
  it("defaults on and notifies this window when saved", () => {
    const listener = vi.fn();
    const unsubscribe = pref.subscribe(listener);
    expect(pref.load()).toBe(true);

    pref.save(false);

    expect(pref.load()).toBe(false);
    expect(localStorage.getItem(pref.key)).toBe("0");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("keeps the saved value in memory when storage rejects the write", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const listener = vi.fn();
    const unsubscribe = pref.subscribe(listener);
    listener.mockImplementation(() => expect(pref.load()).toBe(false));

    pref.save(false);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(pref.load()).toBe(false);
    unsubscribe();
    pref.save(true);
    expect(pref.load()).toBe(true);
  });

  it("follows a change saved in another window", () => {
    const listener = vi.fn();
    const unsubscribe = pref.subscribe(listener);

    localStorage.setItem(pref.key, "0");
    window.dispatchEvent(new StorageEvent("storage", { key: pref.key }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(pref.load()).toBe(false);

    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(listener).toHaveBeenCalledTimes(1);

    localStorage.removeItem(pref.key);
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(pref.load()).toBe(true);
    unsubscribe();
  });
});
