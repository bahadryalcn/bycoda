// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  available: vi.fn(() => true),
  popup: vi.fn(async () => {}),
  items: [] as { options: any; close: ReturnType<typeof vi.fn> }[],
  menus: [] as { options: any; close: ReturnType<typeof vi.fn> }[],
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: native.available }));
vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
}));
vi.mock("@tauri-apps/api/menu", () => ({
  MenuItem: {
    new: async (options: any) => {
      const item = { options, close: vi.fn(async () => {}) };
      native.items.push(item);
      return item;
    },
  },
  CheckMenuItem: {
    new: async (options: any) => {
      const item = { options, close: vi.fn(async () => {}) };
      native.items.push(item);
      return item;
    },
  },
  Menu: {
    new: async (options: any) => {
      const menu = { options, close: vi.fn(async () => {}), popup: native.popup };
      native.menus.push(menu);
      return menu;
    },
  },
}));
import { popupNativeActionMenu } from "./nativeActionMenu";
import { popupNativeDropdownMenu } from "./DropdownMenu";
let anchor: HTMLButtonElement;
const choices = [
  { id: "manual", label: "Wait until I finish", checked: false },
  { id: "automatic", label: "Automatic replies", checked: true },
];
it("renders flat dropdown descriptions and disabled checked choices through the native owner", async () => {
  const pick = vi.fn();
  await popupNativeDropdownMenu(
    anchor,
    [
      { id: "manual", label: "Manual", description: "Finish explicitly", checked: true },
      { id: "automatic", label: "Automatic", disabled: true },
    ],
    pick,
  );
  expect(
    native.items.map(({ options }) => [options.text, options.enabled, options.checked]),
  ).toEqual([
    ["Manual — Finish explicitly", true, true],
    ["Automatic", false, undefined],
  ]);
  expect(pick).not.toHaveBeenCalled();
  native.items[1].options.action();
  expect(pick).not.toHaveBeenCalled();
  native.items[0].options.action();
  expect(pick).toHaveBeenCalledExactlyOnceWith("manual");
});
beforeEach(() => {
  native.available.mockReturnValue(true);
  native.popup.mockResolvedValue(undefined);
  anchor = document.createElement("button");
  document.body.append(anchor);
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({ left: 120, bottom: 50 } as DOMRect);
});
afterEach(async () => {
  window.dispatchEvent(new Event("pagehide"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  anchor.remove();
  native.items = [];
  native.menus = [];
  vi.clearAllMocks();
});
it("keeps the menu alive after nonblocking popup acceptance and selects only an actual enabled item", async () => {
  const pick = vi.fn();
  await popupNativeActionMenu(anchor, choices, pick);
  expect(native.popup).toHaveBeenCalledWith(expect.objectContaining({ x: 120, y: 50 }));
  expect(native.items.map((item) => item.options.checked)).toEqual([false, true]);
  expect(pick).not.toHaveBeenCalled();
  expect(native.menus[0].close).not.toHaveBeenCalled();
  expect(native.items.every((item) => item.close.mock.calls.length === 0)).toBe(true);
  native.items[0].options.action();
  native.items[0].options.action();
  expect(pick).toHaveBeenCalledExactlyOnceWith("manual");
  expect(native.menus[0].close).not.toHaveBeenCalled();
});
it("retains current checks and retires the prior invocation without rerouting late native selection", async () => {
  const first = vi.fn(),
    second = vi.fn();
  await popupNativeActionMenu(anchor, choices, first);
  const previous = native.items[0],
    previousMenu = native.menus[0];
  await popupNativeActionMenu(
    anchor,
    [
      { ...choices[0], checked: true },
      { ...choices[1], checked: false },
    ],
    second,
  );
  expect(previousMenu.close).toHaveBeenCalledOnce();
  expect(previous.close).toHaveBeenCalledOnce();
  previous.options.action();
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  expect(native.items.slice(2).map((item) => item.options.checked)).toEqual([true, false]);
  native.items[3].options.action();
  expect(second).toHaveBeenCalledExactlyOnceWith("automatic");
});
it("does not execute a disabled choice or a selection after its owning control unmounts", async () => {
  const pick = vi.fn();
  await popupNativeActionMenu(
    anchor,
    [
      { id: "disabled", label: "Unavailable", disabled: true },
      { id: "enabled", label: "Available" },
    ],
    pick,
  );
  native.items[0].options.action();
  expect(pick).not.toHaveBeenCalled();
  anchor.remove();
  native.items[1].options.action();
  expect(pick).not.toHaveBeenCalled();
});
it("rejects unavailable/duplicate targets without effects", async () => {
  native.available.mockReturnValue(false);
  await expect(popupNativeActionMenu(anchor, choices, vi.fn())).rejects.toThrow("native window");
  native.available.mockReturnValue(true);
  await expect(popupNativeActionMenu(anchor, [choices[0], choices[0]], vi.fn())).rejects.toThrow(
    "target",
  );
  expect(native.menus).toEqual([]);
  expect(native.items).toEqual([]);
});
it("cleans up a failed popup and allows an explicit retry without an implicit choice", async () => {
  const pick = vi.fn();
  native.popup.mockRejectedValueOnce(new Error("Synthetic native popup denial"));
  await expect(popupNativeActionMenu(anchor, choices, pick)).rejects.toThrow(
    "Synthetic native popup denial",
  );
  expect(native.menus[0].close).toHaveBeenCalledOnce();
  expect(native.items.every((item) => item.close.mock.calls.length === 1)).toBe(true);
  await popupNativeActionMenu(anchor, choices, pick);
  expect(pick).not.toHaveBeenCalled();
  native.items[2].options.action();
  expect(pick).toHaveBeenCalledExactlyOnceWith("manual");
});
it("uses the latest queued request and releases retained resources on page teardown", async () => {
  const first = vi.fn(),
    second = vi.fn();
  await Promise.all([
    popupNativeActionMenu(anchor, choices, first),
    popupNativeActionMenu(anchor, choices, second),
  ]);
  expect(native.menus).toHaveLength(1);
  native.items[0].options.action();
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith("manual");
  window.dispatchEvent(new Event("pagehide"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(native.menus[0].close).toHaveBeenCalledOnce();
});
