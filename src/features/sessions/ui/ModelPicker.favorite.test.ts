// @vitest-environment happy-dom
import { act, createElement, StrictMode, type CSSProperties, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../integrations/harness/core/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  hasProbedHarnessAvailability: () => true,
  isHarnessAvailable: () => true,
  probeHarnessAvailability: () => Promise.resolve(),
  subscribeHarnessAvailability: () => () => undefined,
}));

vi.mock("../../../integrations/harness/core/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

vi.mock("../../../shared/ui/Popover", () => ({
  Popover: ({
    children,
    role,
    className,
    tabIndex,
    onKeyDown,
    ...props
  }: {
    children: ReactNode;
    role?: string;
    className?: string;
    tabIndex?: number;
    onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
    style?: CSSProperties;
    "aria-label"?: string;
  }) =>
    createElement(
      "div",
      {
        role,
        className,
        tabIndex,
        onKeyDown,
        style: props.style,
        "aria-label": props["aria-label"],
      },
      children,
    ),
}));

vi.mock("../model/models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../model/models")>();
  return {
    ...actual,
    saveFavoriteModels: vi.fn(actual.saveFavoriteModels),
  };
});

import { ModelPicker, preloadModelPicker } from "./ModelPicker";
import {
  loadFavoriteModels,
  resetDisabledModels,
  resetHarnessModelOverlays,
  saveFavoriteModels,
  setHarnessModels,
} from "../model/models";

let container: HTMLDivElement;
let root: Root;
let setItemCalls: Array<[string, string]>;

function countingStore(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => {
      setItemCalls.push([key, value]);
      data.set(key, value);
    },
  };
}

beforeEach(async () => {
  await preloadModelPicker();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setItemCalls = [];
  vi.stubGlobal("localStorage", countingStore());
  vi.mocked(saveFavoriteModels).mockClear();
  resetDisabledModels();
  resetHarnessModelOverlays();
  setHarnessModels("cursor", [
    { id: "cursor:first", harness: "cursor", name: "First", nativeId: "first" },
    { id: "cursor:second", harness: "cursor", name: "Second", nativeId: "second" },
  ]);
  setItemCalls.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  resetHarnessModelOverlays();
  container.remove();
  vi.unstubAllGlobals();
});

async function openPicker() {
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(ModelPicker, {
          harness: "cursor",
          model: "cursor:first",
          values: {},
          hideSettings: true,
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
  await act(async () => trigger.click());
}

function starFor(name: string): HTMLButtonElement {
  const option = [...container.querySelectorAll('[role="option"]')].find((el) =>
    (el.getAttribute("aria-label") ?? el.textContent ?? "").startsWith(name),
  )!;
  expect(option).toBeDefined();
  return option.parentElement!.querySelector<HTMLButtonElement>('button[aria-label$="favorites"]')!;
}

function favoriteWrites() {
  return setItemCalls.filter(([key]) => key === "bycoda.favoriteModels");
}

describe("model picker favorites under StrictMode", () => {
  it("persists exactly once with the new list for one toggle", async () => {
    await openPicker();
    await act(async () => starFor("First").click());

    expect(saveFavoriteModels).toHaveBeenCalledTimes(1);
    expect(saveFavoriteModels).toHaveBeenCalledWith(["cursor:first"]);
    expect(favoriteWrites()).toHaveLength(1);
    expect(loadFavoriteModels()).toEqual(["cursor:first"]);
    expect(starFor("First").getAttribute("aria-label")).toBe("Remove from favorites");
  });

  it("removing a favorite writes once without the removed id", async () => {
    localStorage.setItem(
      "bycoda.favoriteModels",
      JSON.stringify(["cursor:first", "cursor:second"]),
    );
    setItemCalls.length = 0;
    await openPicker();
    await act(async () => starFor("First").click());

    expect(saveFavoriteModels).toHaveBeenCalledTimes(1);
    expect(saveFavoriteModels).toHaveBeenCalledWith(["cursor:second"]);
    expect(favoriteWrites()).toHaveLength(1);
    expect(loadFavoriteModels()).toEqual(["cursor:second"]);
  });

  it("keeps both updates when two toggles land in the same act", async () => {
    await openPicker();
    const first = starFor("First");
    const second = starFor("Second");
    await act(async () => {
      first.click();
      second.click();
    });

    expect(saveFavoriteModels).toHaveBeenCalledTimes(2);
    expect(saveFavoriteModels).toHaveBeenNthCalledWith(1, ["cursor:first"]);
    expect(saveFavoriteModels).toHaveBeenNthCalledWith(2, ["cursor:first", "cursor:second"]);
    expect(favoriteWrites()).toHaveLength(2);
    expect(loadFavoriteModels()).toEqual(["cursor:first", "cursor:second"]);
    expect(starFor("First").getAttribute("aria-label")).toBe("Remove from favorites");
    expect(starFor("Second").getAttribute("aria-label")).toBe("Remove from favorites");
  });
});
