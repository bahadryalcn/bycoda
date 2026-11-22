// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeMode } from "../model/session";
import { setLanguagePreference, t } from "../../../shared/i18n";
import { AccessPicker } from "./AccessPicker";
import { runtimeModeCopy } from "./runtimeModeCopy";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function open(onChange: (mode: RuntimeMode) => void) {
  act(() =>
    root.render(
      createElement(AccessPicker, {
        value: "auto-accept-edits",
        onChange,
        unavailable: {
          supervised: "Headless agy cannot ask before editing files.",
        },
      }),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>("[data-access-picker-trigger]")?.click());
}

const option = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("[role='option']")].find((el) =>
    el.textContent?.includes(label),
  );

const NEXT_TURN = "Access changes apply to the next turn. Stop and resend to apply them now.";
const count = (text: string, part: string) => text.split(part).length - 1;

function render(props: { busy?: boolean; value?: RuntimeMode }) {
  act(() =>
    root.render(
      createElement(AccessPicker, {
        value: props.value ?? "supervised",
        onChange: vi.fn(),
        busy: props.busy,
      }),
    ),
  );
}

const trigger = () => container.querySelector<HTMLButtonElement>("[data-access-picker-trigger]")!;

describe("AccessPicker localization", () => {
  afterEach(async () => {
    await setLanguagePreference("en");
  });

  it("names the trigger and its mode meaning in the app language", async () => {
    await setLanguagePreference("tr");
    render({ value: "auto-accept-edits" });
    expect(trigger().getAttribute("aria-label")).toBe("Düzenlemeleri otomatik kabul et");
    expect(runtimeModeCopy(t, "full-access").hint).toBe(
      "Plan dışı turlarda komutlara, düzenlemelere ve desteklenen MCP onaylarına istem göstermeden izin ver.",
    );
    act(() => trigger().click());
    expect(option("Gözetimli")).toBeDefined();
    expect(option("Otomatik")?.textContent).toContain(
      "Bir yapay zekâ denetçisi eylemleri onaylayabilir veya reddedebilir.",
    );
  });

  it("keeps the English name and meaning in English", () => {
    render({ value: "supervised" });
    expect(trigger().getAttribute("aria-label")).toBe("Supervised");
    expect(runtimeModeCopy(t, "supervised").hint).toBe("Ask before commands and file changes.");
  });
});

describe("AccessPicker next-turn explanation", () => {
  it("shows no explanation while idle", () => {
    render({ busy: false });
    act(() => trigger().click());
    expect(document.querySelector("[data-picker-footer]")).toBeNull();
    expect(count(document.body.textContent ?? "", NEXT_TURN)).toBe(0);
  });

  it("keeps the sentence behind one info button, never inline in the menu or the hint", () => {
    render({ busy: true });
    act(() => trigger().click());
    const footer = document.querySelector<HTMLElement>("[data-picker-footer]")!;
    expect(footer.textContent).not.toContain(NEXT_TURN);
    expect(count(document.body.textContent ?? "", NEXT_TURN)).toBe(0);
    act(() => footer.querySelector<HTMLButtonElement>("button")!.click());
    expect(count(document.body.textContent ?? "", NEXT_TURN)).toBe(1);
    expect(document.querySelector("[data-access-picker]")).not.toBeNull();
  });

  it("still picks a mode after reading the explanation", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(createElement(AccessPicker, { value: "supervised", onChange, busy: true })),
    );
    act(() => trigger().click());
    act(() => document.querySelector<HTMLButtonElement>("[data-picker-footer] button")!.click());
    act(() => option("Full access")?.click());
    expect(onChange).toHaveBeenCalledWith("full-access");
  });
});

describe("AccessPicker unavailable modes", () => {
  it("shows an unavailable mode with its reason and refuses to pick it", () => {
    const onChange = vi.fn();
    open(onChange);
    const supervised = option("Supervised");
    expect(supervised?.getAttribute("aria-disabled")).toBe("true");
    expect(supervised?.textContent).toContain(
      "Unavailable: Headless agy cannot ask before editing files.",
    );
    act(() => supervised?.click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still lets the available modes be picked", () => {
    const onChange = vi.fn();
    open(onChange);
    expect(option("Auto-accept edits")?.getAttribute("aria-disabled")).toBeNull();
    act(() => option("Full access")?.click());
    expect(onChange).toHaveBeenCalledWith("full-access");
  });

  it("keeps the current selection distinct from keyboard navigation", () => {
    const onChange = vi.fn();
    open(onChange);
    const menu = document.querySelector<HTMLElement>("[data-access-picker] [role='listbox']")!;
    act(() =>
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    expect(option("Auto-accept edits")?.getAttribute("aria-selected")).toBe("true");
    expect(menu.getAttribute("aria-activedescendant")).toBe(option("An AI reviewer")?.id);
    expect(option("An AI reviewer")?.hasAttribute("data-highlighted")).toBe(true);
    expect(option("Auto-accept edits")?.hasAttribute("data-highlighted")).toBe(false);
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(menu.getAttribute("aria-activedescendant")).toBe(option("Auto-accept edits")?.id);
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onChange).toHaveBeenCalledWith("auto-accept-edits");
    expect(document.querySelector("[data-access-picker]")).toBeNull();
  });
});

describe("AccessPicker compact trigger", () => {
  function trigger(value: RuntimeMode) {
    act(() =>
      root.render(createElement(AccessPicker, { value, iconOnly: true, onChange: () => {} })),
    );
    return container.querySelector<HTMLButtonElement>("[data-access-picker-trigger]")!;
  }

  it("stays icon-only for the default mode", () => {
    expect(trigger("supervised").hasAttribute("data-access-picker-compact")).toBe(true);
  });

  it("names a changed mode instead of showing a bare icon", () => {
    expect(trigger("full-access").hasAttribute("data-access-picker-compact")).toBe(false);
  });
});
