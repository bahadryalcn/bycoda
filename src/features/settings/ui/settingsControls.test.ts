// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Group,
  Row,
  Segmented,
  Select,
  Slider,
  Toggle,
  SettingsFeedback,
  PageAutomaticSaveHint,
  AdvancedSettings,
  RevealedSetting,
} from "./settingsControls";
import { playCue } from "../model/sounds";

vi.mock("../model/sounds", () => ({ playCue: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
const options = [
  { value: "first", label: "First" },
  { value: "second", label: "Second" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function key(target: Element, key: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("retained advanced settings", () => {
  it("keeps hidden controls inert and retains their DOM identity and draft across disclosure changes", async () => {
    const mounted = vi.fn(),
      unmounted = vi.fn();
    function Draft() {
      useEffect(() => {
        mounted();
        return () => {
          unmounted();
        };
      }, []);
      return createElement("input", { "aria-label": "Retained draft", defaultValue: "original" });
    }
    await act(() =>
      root.render(
        createElement(AdvancedSettings, {
          defaultOpen: false,
          keepMounted: true,
          children: createElement(Draft),
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    const input = container.querySelector<HTMLInputElement>("input")!;
    const body = input.parentElement!;
    expect(body.hidden).toBe(true);
    expect(body.hasAttribute("inert")).toBe(true);
    expect(body.getAttribute("aria-hidden")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(body.id);
    expect(mounted).toHaveBeenCalledTimes(1);
    await act(() => trigger.click());
    input.value = "unsaved draft";
    await act(() => trigger.click());
    expect(body.hidden).toBe(true);
    expect(input.isConnected).toBe(true);
    expect(unmounted).not.toHaveBeenCalled();
    await act(() => trigger.click());
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("unsaved draft");
    expect(body.hidden).toBe(false);
    expect(body.hasAttribute("inert")).toBe(false);
    expect(body.getAttribute("aria-hidden")).toBeNull();
  });

  it("preserves existing unmount behavior unless opted in", async () => {
    await act(() =>
      root.render(
        createElement(AdvancedSettings, { defaultOpen: false, children: createElement("input") }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    expect(container.querySelector("input")).toBeNull();
    await act(() => trigger.click());
    expect(container.querySelector("input")).not.toBeNull();
    await act(() => trigger.click());
    expect(container.querySelector("input")).toBeNull();
  });

  it("opens a retained body when settings search reveals one of its controls", async () => {
    const render = (target: string | null) =>
      root.render(
        createElement(
          RevealedSetting.Provider,
          { value: target },
          createElement(AdvancedSettings, {
            defaultOpen: false,
            keepMounted: true,
            settingIds: ["voice-device"],
            children: createElement("input"),
          }),
        ),
      );
    await act(() => render(null));
    const input = container.querySelector("input")!;
    expect(input.parentElement!.hidden).toBe(true);
    await act(() => render("voice-device"));
    expect(container.querySelector("input")).toBe(input);
    expect(input.parentElement!.hidden).toBe(false);
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("settings keyboard controls", () => {
  it("keeps save errors and explicit-save guidance when the page explains automatic saving", async () => {
    await act(async () =>
      root.render(
        createElement(
          PageAutomaticSaveHint.Provider,
          { value: true },
          createElement(Group, {
            title: "Automatic",
            persistence: { mode: "automatic" },
            children: "Setting",
          }),
          createElement(Group, {
            title: "Failed",
            persistence: { mode: "automatic", state: "error", error: "Retry saving" },
            children: "Setting",
          }),
          createElement(Group, {
            title: "Explicit",
            persistence: { mode: "explicit" },
            children: "Setting",
          }),
        ),
      ),
    );
    expect(container.textContent).not.toContain("Changes save automatically");
    expect(container.textContent).toContain("Changes require saving");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Retry saving");
  });
  it("keeps operation feedback below controls and announces errors separately from progress", async () => {
    const render = (state: "loading" | "error") =>
      root.render(
        createElement(Row, {
          label: "Shell",
          children: createElement("input", { "aria-label": "Shell path" }),
          feedback: createElement(SettingsFeedback, {
            state,
            children: state === "error" ? "Try again" : "Loading",
          }),
        }),
      );
    await act(async () => render("loading"));
    expect(container.querySelector('.settings-row-control [role="status"]')).toBeNull();
    expect(
      container.querySelector('.settings-row-feedback [role="status"]')?.textContent,
    ).toContain("Loading");
    await act(async () => render("error"));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('.settings-row-feedback [role="alert"]')?.textContent).toContain(
      "Try again",
    );
    expect(container.querySelector("input")?.getAttribute("aria-label")).toBe("Shell path");
  });
  it("associates native form labels and inherited scope without replacing caller descriptions", async () => {
    await act(async () =>
      root.render(
        createElement(Group, {
          title: "Project settings",
          scope: "Applies to this project",
          persistence: { mode: "automatic" },
          children: createElement(Row, {
            label: "Shell path",
            controlId: "shell-path",
            description: "Choose an executable",
            dependency: "Enable terminal first",
            children: createElement("input", {
              id: "shell-path",
              "aria-describedby": "caller-description",
            }),
          }),
        }),
      ),
    );
    const input = container.querySelector<HTMLInputElement>("input")!;
    expect(container.querySelector<HTMLLabelElement>('label[for="shell-path"]')?.textContent).toBe(
      "Shell path",
    );
    const ids = input.getAttribute("aria-describedby")!.split(/\s+/);
    expect(ids).toContain("caller-description");
    const descriptions = ids.map((id) => document.getElementById(id)?.textContent).join(" ");
    expect(descriptions).toContain("Choose an executable");
    expect(descriptions).toContain("Enable terminal first");
    expect(descriptions).toContain("Applies to this project");
    expect(descriptions).toContain("Changes save automatically");
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("keeps controlled switch state, one sound cue and disabled behavior", async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(createElement(Toggle, { label: "Enable sounds", on: false, onChange })),
    );
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(playCue).toHaveBeenCalledExactlyOnceWith("switch");
    await act(async () =>
      root.render(
        createElement(Toggle, { label: "Enable sounds", on: true, onChange, disabled: true }),
      ),
    );
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(playCue).toHaveBeenCalledTimes(1);
  });

  it("keeps slider step, limits and the settings display value", async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(Slider, {
          label: "Opacity",
          value: 5,
          display: "50%",
          min: 0,
          max: 10,
          step: 1,
          onChange,
        }),
      ),
    );
    const thumb = container.querySelector<HTMLElement>('[role="slider"]')!;
    expect(thumb.getAttribute("aria-valuenow")).toBe("5");
    expect(thumb.getAttribute("aria-valuetext")).toBe("50%");
    await key(thumb, "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith(6);
    await key(thumb, "End");
    expect(onChange).toHaveBeenLastCalledWith(10);
    await key(thumb, "Home");
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("retains settings search ids and radio semantics for segmented values", async () => {
    await act(async () =>
      root.render(
        createElement(Segmented, {
          label: "Layout",
          value: "first",
          options,
          onChange: vi.fn(),
          optionIdPrefix: "setting-layout",
        }),
      ),
    );
    expect(container.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe(
      "Layout",
    );
    expect(container.querySelector("#setting-layout-first")?.getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(container.querySelector('[role="radio"][aria-pressed]')).toBeNull();
  });

  it("refreshes on mouse or keyboard opening, without refreshing on close", async () => {
    const onOpen = vi.fn();
    await act(async () =>
      root.render(
        createElement(Select, {
          label: "Model",
          value: "first",
          options,
          onChange: vi.fn(),
          onOpen,
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
    await act(async () => trigger.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    await act(async () => trigger.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    await key(trigger, "ArrowDown");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
  it("moves segmented selection and focus with arrow keys", async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(Segmented, {
          label: "Layout",
          value: "first",
          options,
          onChange,
        }),
      ),
    );
    const radios = container.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    expect(radios[0].tabIndex).toBe(0);
    expect(radios[1].tabIndex).toBe(-1);
    await key(radios[0], "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith("second");
    expect(document.activeElement).toBe(radios[1]);
    await key(radios[1], "Home");
    expect(onChange).toHaveBeenLastCalledWith("first");
    expect(document.activeElement).toBe(radios[0]);
  });

  it("closes a select on Tab without saving the highlighted option", async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(Select, {
          label: "Layout",
          value: "first",
          options,
          onChange,
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
    await key(trigger, "ArrowDown");
    const menu = document.querySelector('[role="listbox"]')!;
    expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
    await key(menu, "ArrowDown");
    await key(menu, "Tab");
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it("saves the highlighted option with Space and restores trigger focus", async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(Select, {
          label: "Layout",
          value: "first",
          options,
          onChange,
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
    await act(async () => trigger.click());
    const menu = document.querySelector('[role="listbox"]')!;
    await key(menu, "End");
    await key(menu, " ");
    expect(onChange).toHaveBeenLastCalledWith("second");
    expect(document.activeElement).toBe(trigger);
  });
});

it("keeps recovery actions independent of feedback dismissal", async () => {
  const dismiss = vi.fn();
  const retry = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        SettingsFeedback,
        {
          state: "error",
          onDismiss: dismiss,
          action: createElement("button", { onClick: retry }, "Retry"),
        },
        "Connection failed",
      ),
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')!.click(),
  );
  expect(dismiss).toHaveBeenCalledOnce();
  expect(retry).not.toHaveBeenCalled();
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Retry")!
      .click(),
  );
  expect(retry).toHaveBeenCalledOnce();
});
