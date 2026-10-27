import { describe, expect, it } from "vitest";
import {
  consumeInstalledUpdate,
  dismissInstalledUpdate,
  rememberInstalledUpdate,
  type UpdateNoticeStore,
} from "./updateNotice";

function memoryStore(): UpdateNoticeStore {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe("installed update marker", () => {
  it("remains available across startup reads until explicitly dismissed", () => {
    const store = memoryStore();
    rememberInstalledUpdate("0.1.23", store);
    expect(consumeInstalledUpdate(store)).toEqual({ version: "0.1.23" });
    expect(consumeInstalledUpdate(store)).toEqual({ version: "0.1.23" });
    dismissInstalledUpdate("0.1.23", store);
    expect(consumeInstalledUpdate(store)).toBeNull();
  });

  it("shows the next installed version after the previous notice was dismissed", () => {
    const store = memoryStore();
    rememberInstalledUpdate("0.1.23", store);
    dismissInstalledUpdate("0.1.23", store);
    rememberInstalledUpdate(" 0.1.24 ", store);
    expect(consumeInstalledUpdate(store)).toEqual({ version: "0.1.24" });
  });

  it("preserves a newer notice when an old window dismisses its displayed version", () => {
    const store = memoryStore();
    rememberInstalledUpdate("0.1.23", store);
    const olderNotice = consumeInstalledUpdate(store)!;
    rememberInstalledUpdate("0.1.24", store);
    dismissInstalledUpdate(olderNotice.version, store);
    expect(consumeInstalledUpdate(store)).toEqual({ version: "0.1.24" });
  });

  it.each(["", "   "])("does not store blank version %j", (version) => {
    const store = memoryStore();
    rememberInstalledUpdate(version, store);
    expect(consumeInstalledUpdate(store)).toBeNull();
  });

  it.each(["not json", "{}", '{"version":3}', '{"version":""}'])(
    "removes malformed marker %j",
    (value) => {
      const store = memoryStore();
      store.setItem("bycoda.installedUpdate", value);
      expect(consumeInstalledUpdate(store)).toBeNull();
      expect(store.getItem("bycoda.installedUpdate")).toBeNull();
    },
  );

  it("treats missing storage as no marker", () => {
    expect(consumeInstalledUpdate(memoryStore())).toBeNull();
  });

  it.each(["getItem", "setItem", "removeItem"] as const)("contains %s storage errors", (method) => {
    const store = memoryStore();
    store[method] = () => {
      throw new Error("storage unavailable");
    };
    expect(() => rememberInstalledUpdate("0.1.23", store)).not.toThrow();
    expect(() => consumeInstalledUpdate(store)).not.toThrow();
    expect(() => dismissInstalledUpdate("0.1.23", store)).not.toThrow();
  });
});
