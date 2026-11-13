// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toolPreferences } from "../../host-tools/public/toolPreferences";
import { TOOL_SETTINGS_INDEX, toolSettingsTabForAnchor } from "../model/toolSettingsSections";
import { SettingsPageResetRegistry, type SettingsPageResetRegistration } from "./settingsPageReset";
import {
  ToolSettingsPage,
  BrowserSettingsPage,
  DevicesSettingsPage,
  LogsSettingsPage,
  DevServersSettingsPage,
} from "./ToolSettings";
import { RevealedSetting } from "./settingsControls";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  ["browser", BrowserSettingsPage],
  ["devices", DevicesSettingsPage],
  ["logs", LogsSettingsPage],
  ["devServers", DevServersSettingsPage],
] as const)("renders every searchable %s control", async (section, Page) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Page)));
    for (const entry of TOOL_SETTINGS_INDEX.filter(
      (item) => toolSettingsTabForAnchor(item.id) === section,
    )) {
      expect(container.querySelector(`[data-setting-id="${entry.id}"]`), entry.id).not.toBeNull();
    }
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("persists changes, follows external writers and resets a changed row", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(BrowserSettingsPage)));
    const toggle = () =>
      container.querySelector<HTMLButtonElement>(
        '[role="switch"][aria-label="Live view by default"]',
      )!;
    await act(async () => toggle().click());
    expect(toolPreferences.browserLiveView.load()).toBe(false);
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    const row = container.querySelector('[data-setting-id="browser-live-view"]')!;
    await act(async () =>
      row.querySelector<HTMLButtonElement>('[aria-label="Restore default"]')!.click(),
    );
    expect(toolPreferences.browserLiveView.load()).toBe(true);
    await act(async () => toolPreferences.browserLiveView.save(false));
    expect(toggle().getAttribute("aria-checked")).toBe("false");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("keeps durable value and exposes local feedback when saving fails", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(BrowserSettingsPage)));
    vi.spyOn(toolPreferences.browserLiveView, "save").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    const toggle = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Live view by default"]',
    )!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('[data-setting-id="browser-live-view"]')?.textContent).toContain(
      "Could not save tool preferences.",
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("restores only the current page defaults", async () => {
  toolPreferences.logsFollow.save(false);
  toolPreferences.logsGrouped.save(false);
  toolPreferences.logsRefreshInterval.save(5000);
  toolPreferences.browserLiveView.save(false);
  let registration: SettingsPageResetRegistration | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(
          SettingsPageResetRegistry.Provider,
          {
            value: (next) => {
              registration = typeof next === "function" ? next(registration) : next;
            },
          },
          createElement(LogsSettingsPage),
        ),
      ),
    );
    expect(registration).not.toBeNull();
    await act(async () => registration?.run());
    expect(toolPreferences.logsFollow.load()).toBe(true);
    expect(toolPreferences.logsGrouped.load()).toBe(true);
    expect(toolPreferences.logsRefreshInterval.load()).toBe(1500);
    expect(toolPreferences.browserLiveView.load()).toBe(false);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("saves numeric choices without converting persisted values to strings", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(LogsSettingsPage)));
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click(),
    );
    const choice = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (option) => option.textContent?.includes("3 seconds"),
    )!;
    await act(async () => choice.click());
    expect(toolPreferences.logsRefreshInterval.load()).toBe(3000);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("selects revealed topics before rendering and keeps keyboard tabs linked to panels", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (anchor: string | null, request: number) =>
    act(async () =>
      root.render(
        createElement(
          RevealedSetting.Provider,
          { value: anchor },
          createElement(ToolSettingsPage, { revealRequest: request }),
        ),
      ),
    );
  const tab = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (node) => node.textContent === label,
    )!;
  try {
    await render("servers-refresh-interval", 1);
    expect(tab("Development Servers").getAttribute("aria-selected")).toBe("true");
    await render("browser-viewport-width", 2);
    expect(tab("Browser").getAttribute("aria-selected")).toBe("true");
    expect(
      container.querySelector('[data-setting-id="browser-viewport-width"]')?.closest("[hidden]"),
    ).toBeNull();
    expect(toolPreferences.browserViewport.load()).toBe("desktop");
    await act(async () =>
      tab("Browser").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    expect(tab("Devices").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Devices"));
    expect(
      container
        .querySelector(`#${tab("Devices").getAttribute("aria-controls")}`)
        ?.hasAttribute("hidden"),
    ).toBe(false);
    await render("browser-search-template", 3);
    expect(
      container.querySelector('[data-setting-id="browser-search-template"]')?.closest("[hidden]"),
    ).toBeNull();
    expect(toolPreferences.browserSearchEngine.load()).toBe("disabled");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("preserves invalid drafts across tabs and external saves, then clears only the reset topic", async () => {
  let registration: SettingsPageResetRegistration | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const tab = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (node) => node.textContent === label,
    )!;
  const input = () =>
    container.querySelector<HTMLInputElement>('[data-setting-id="browser-home-url"] input')!;
  const editInvalid = () =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input(),
        "invalid draft",
      );
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  try {
    await act(async () =>
      root.render(
        createElement(
          SettingsPageResetRegistry.Provider,
          {
            value: (next) => {
              registration = typeof next === "function" ? next(registration) : next;
            },
          },
          createElement(ToolSettingsPage),
        ),
      ),
    );
    await editInvalid();
    await act(async () =>
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(toolPreferences.browserHomeUrl.load()).toBe("http://localhost:3000");
    expect(container.textContent).toContain("Enter an HTTP or HTTPS address without credentials.");
    await act(async () => tab("Logs").click());
    await act(async () => toolPreferences.browserHomeUrl.save("https://example.com"));
    toolPreferences.logsFollow.save(false);
    await act(async () => registration?.run());
    expect(toolPreferences.logsFollow.load()).toBe(true);
    expect(toolPreferences.browserHomeUrl.load()).toBe("https://example.com");
    await act(async () => tab("Browser").click());
    expect(input().value).toBe("invalid draft");
    await act(async () => registration?.run());
    expect(input().value).toBe("http://localhost:3000");
    await editInvalid();
    await act(async () => registration?.run());
    expect(input().value).toBe("http://localhost:3000");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
