// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toolPreferences } from "../../host-tools/public/toolPreferences";
import { TOOL_SETTINGS_INDEX, toolSettingsTabForAnchor } from "../model/toolSettingsSections";
import {
  SettingsPageResetRegistry,
  type SettingsPageResetRegistration,
} from "../../../shared/ui/settings";
import {
  ToolSettingsPage,
  BrowserSettingsPage,
  DevicesSettingsPage,
  LogsSettingsPage,
  DevServersSettingsPage,
  BykitSettingsPage,
} from "./ToolSettings";
import { RevealedSetting } from "../../../shared/ui/settings";

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
  ["bykit", BykitSettingsPage],
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

it("shows no boilerplate copy under topics or rows and one title per topic", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    for (const Page of [
      BrowserSettingsPage,
      DevicesSettingsPage,
      LogsSettingsPage,
      DevServersSettingsPage,
    ]) {
      await act(async () => root.render(createElement(Page)));
      expect(container.textContent).not.toContain("Defaults apply when opening a new tool view");
      expect(container.textContent).not.toContain("Applies when opening a new browser session.");
      expect(container.textContent).not.toContain("Prefills a new browser view");
    }
    await act(async () => root.render(createElement(DevServersSettingsPage)));
    expect(container.textContent).toContain("Development servers");
    expect(container.textContent).not.toContain("Development Servers");
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
    expect(tab("Development servers").getAttribute("aria-selected")).toBe("true");
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

async function renderWithReset(Page: typeof LogsSettingsPage) {
  const state: { registration: SettingsPageResetRegistration | null } = { registration: null };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(
        SettingsPageResetRegistry.Provider,
        {
          value: (next) => {
            state.registration = typeof next === "function" ? next(state.registration) : next;
          },
        },
        createElement(Page),
      ),
    ),
  );
  return {
    state,
    container,
    dispose: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function blockWrites(blocked: (key: string, value: string) => boolean) {
  const write = localStorage.setItem.bind(localStorage);
  return vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (blocked(key, value)) throw new Error("quota");
    write(key, value);
  });
}

it("reports a failed reset as unchanged and keeps every earlier value", async () => {
  toolPreferences.logsFollow.save(false);
  toolPreferences.logsGrouped.save(false);
  const { state, container, dispose } = await renderWithReset(LogsSettingsPage);
  const blocked = blockWrites(
    (key, value) => key === toolPreferences.logsGrouped.key && value === "true",
  );
  try {
    await act(async () => state.registration?.run());
    expect(toolPreferences.logsFollow.load()).toBe(false);
    expect(toolPreferences.logsGrouped.load()).toBe(false);
    expect(container.textContent).toContain("Could not save tool preferences.");
    expect(container.textContent).not.toContain("Some settings could not be reset");
    blocked.mockRestore();
    await act(async () => state.registration?.run());
    expect(toolPreferences.logsFollow.load()).toBe(true);
    expect(toolPreferences.logsGrouped.load()).toBe(true);
    expect(container.textContent).not.toContain("Could not save tool preferences.");
  } finally {
    blocked.mockRestore();
    dispose();
  }
});

it("reports a partially restored reset and offers a retry", async () => {
  toolPreferences.logsFollow.save(false);
  toolPreferences.logsGrouped.save(false);
  const { state, container, dispose } = await renderWithReset(LogsSettingsPage);
  const blocked = blockWrites(
    (key, value) =>
      (key === toolPreferences.logsGrouped.key && value === "true") ||
      (key === toolPreferences.logsFollow.key && value === "false"),
  );
  try {
    await act(async () => state.registration?.run());
    expect(container.textContent).toContain(
      "Some settings could not be reset. Retry to finish restoring defaults.",
    );
    blocked.mockRestore();
    await act(async () => state.registration?.run());
    expect(toolPreferences.logsFollow.load()).toBe(true);
    expect(toolPreferences.logsGrouped.load()).toBe(true);
    expect(container.textContent).not.toContain("Some settings could not be reset");
  } finally {
    blocked.mockRestore();
    dispose();
  }
});

it("keeps an unsaved draft when the reset fails", async () => {
  toolPreferences.browserLiveView.save(false);
  const { state, container, dispose } = await renderWithReset(BrowserSettingsPage);
  const input = () =>
    container.querySelector<HTMLInputElement>('[data-setting-id="browser-home-url"] input')!;
  const blocked = blockWrites(
    (key, value) => key === toolPreferences.browserLiveView.key && value === "true",
  );
  try {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input(),
        "http://draft.example",
      );
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => state.registration?.run());
    expect(input().value).toBe("http://draft.example");
    expect(toolPreferences.browserLiveView.load()).toBe(false);
    expect(toolPreferences.browserHomeUrl.load()).toBe("http://localhost:3000");
  } finally {
    blocked.mockRestore();
    dispose();
  }
});
