// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ProjectBackgroundDialog } from "./ProjectBackgroundDialog";
import {
  loadProjectChatBackgroundSettings,
  saveProjectChatBackgroundSettings,
} from "../model/projectChatBackground";

const pickImage = vi.hoisted(() => vi.fn());
vi.mock("../model/chatBackground", async (original) => ({
  ...(await original<typeof import("../model/chatBackground")>()),
  pickAndSaveProjectChatBackground: pickImage,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));

let root: Root;
let container: HTMLDivElement;

function mockLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockLocalStorage();
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  pickImage.mockReset().mockResolvedValue(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Preview unavailable in test");
    }),
  );
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("project background dialog", () => {
  it("keeps visibility and scope immutable while native image selection owns the submitted settings", async () => {
    let resolve!: (path: string | null) => void;
    const pending = new Promise<string | null>((finish) => {
      resolve = finish;
    });
    pickImage.mockReturnValueOnce(pending);
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        createElement(ProjectBackgroundDialog, {
          project: "/work/pending",
          name: "Pending",
          onClose,
        }),
      ),
    );
    const choose = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === "Choose image",
    )!;
    await act(async () => choose.click());
    try {
      const close = document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!;
      expect(close.disabled).toBe(true);
      await act(async () => close.click());
      expect(onClose).not.toHaveBeenCalled();
      expect(choose.getAttribute("aria-busy")).toBe("true");
      expect(choose.getAttribute("aria-disabled")).toBe("true");
      await act(async () => choose.click());
      expect(pickImage).toHaveBeenCalledTimes(1);
      expect(
        [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].every(
          (node) => node.disabled,
        ),
      ).toBe(true);
      const slider = document.querySelector<HTMLElement>('[role="slider"]')!;
      expect(slider.getAttribute("aria-disabled")).toBe("true");
    } finally {
      await act(async () => {
        resolve(null);
        await pending;
      });
    }
    expect(choose.hasAttribute("aria-busy")).toBe(false);
    expect(choose.hasAttribute("aria-disabled")).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.disabled).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
  it.each(["storage", "native"])(
    "retains recoverable background state after %s removal failure",
    async (failure) => {
      saveProjectChatBackgroundSettings("/work/alpha", {
        path: "/backgrounds/alpha.png",
        emptyOpacity: 0.2,
        sessionOpacity: 0.3,
        scope: "empty",
        effect: "none",
      });
      await act(async () =>
        root.render(
          createElement(ProjectBackgroundDialog, {
            project: "/work/alpha",
            name: "Alpha",
            onClose: vi.fn(),
          }),
        ),
      );
      if (failure === "storage")
        vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
          throw new Error("Quota");
        });
      else
        vi.mocked(invoke).mockImplementation(async (command) => {
          if (command === "remove_project_chat_background") {
            expect(loadProjectChatBackgroundSettings("/work/alpha")).toBeNull();
            throw new Error("Native removal failed");
          }
        });
      const remove = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Remove background image",
      )!;
      await act(async () => remove.click());
      expect(loadProjectChatBackgroundSettings("/work/alpha")?.path).toBe("/backgrounds/alpha.png");
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        failure === "storage"
          ? "Could not save project background settings"
          : "Native removal failed",
      );
      if (failure === "storage")
        expect(
          vi
            .mocked(invoke)
            .mock.calls.some(([command]) => command === "remove_project_chat_background"),
        ).toBe(false);
      vi.mocked(invoke).mockResolvedValue(undefined);
      await act(async () => remove.click());
      expect(loadProjectChatBackgroundSettings("/work/alpha")).toBeNull();
    },
  );
  it("persists bounded visibility keyboard edits and the exclusive background scope for this project", async () => {
    saveProjectChatBackgroundSettings("/work/alpha", {
      path: "/backgrounds/alpha.png",
      emptyOpacity: 0.2,
      sessionOpacity: 0.3,
      scope: "empty",
      effect: "none",
    });
    await act(async () =>
      root.render(
        createElement(ProjectBackgroundDialog, {
          project: "/work/alpha",
          name: "Alpha",
          onClose: vi.fn(),
        }),
      ),
    );
    const slider = document.querySelector<HTMLElement>('[role="slider"]')!;
    expect(slider).not.toBeNull();
    await act(async () =>
      slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(loadProjectChatBackgroundSettings("/work/alpha")?.emptyOpacity).toBe(0.21);
    const all = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((node) =>
      node.textContent?.includes("All sessions"),
    )!;
    await act(async () => all.click());
    expect(all.getAttribute("aria-checked")).toBe("true");
    expect(loadProjectChatBackgroundSettings("/work/alpha")?.scope).toBe("all");
  });
  it("changes the effect only for the selected project", async () => {
    saveProjectChatBackgroundSettings("/work/alpha", {
      path: "/backgrounds/alpha.png",
      emptyOpacity: 0.2,
      sessionOpacity: 0.3,
      scope: "all",
      effect: "none",
    });
    saveProjectChatBackgroundSettings("/work/beta", {
      path: "/backgrounds/beta.png",
      emptyOpacity: 0.2,
      sessionOpacity: 0.3,
      scope: "all",
      effect: "ascii",
    });

    await act(async () =>
      root.render(
        createElement(ProjectBackgroundDialog, {
          project: "/work/alpha",
          name: "Alpha",
          onClose: vi.fn(),
        }),
      ),
    );
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')!;
    expect(dialog.className).toContain("max-h-[calc(100dvh-32px)]");

    const heading = Array.from(dialog.querySelectorAll("span")).find(
      (node) => node.textContent === "Background effect",
    )!;
    expect(heading.nextElementSibling?.textContent).toBe("Shows the original artwork.");
    expect(
      heading.parentElement?.nextElementSibling?.querySelector(
        '[aria-label="Project background effect: None"]',
      ),
    ).not.toBeNull();

    const trigger = document.querySelector<HTMLButtonElement>(
      '[aria-label="Project background effect: None"]',
    )!;
    expect(trigger.className).toContain("bg-transparent");
    expect(trigger.className).not.toContain("bg-background-base");
    await act(async () => trigger.click());
    const dither = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="listbox"][aria-label="Project background effect"] [role="option"]',
      ),
    ).find((option) => option.textContent?.includes("Dither"))!;
    await act(async () => dither.click());

    expect(trigger.getAttribute("aria-label")).toBe("Project background effect: Dither");
    expect(loadProjectChatBackgroundSettings("/work/alpha")?.effect).toBe("dither");
    expect(loadProjectChatBackgroundSettings("/work/beta")?.effect).toBe("ascii");
  });

  it("previews a project Haze background with its own image and visibility", async () => {
    saveProjectChatBackgroundSettings("/work/alpha", {
      path: "/backgrounds/alpha.png",
      emptyOpacity: 0.35,
      sessionOpacity: 0.55,
      scope: "empty",
      effect: "gradient-blur",
    });
    await act(async () =>
      root.render(
        createElement(ProjectBackgroundDialog, {
          project: "/work/alpha",
          name: "Alpha",
          onClose: vi.fn(),
        }),
      ),
    );

    const preview = document.querySelector<HTMLElement>(".gradient-blur-background")!;
    expect(preview.style.opacity).toBe("0.35");
    expect(preview.style.getPropertyValue("--chat-background-image")).toContain("alpha.png");
    expect(loadProjectChatBackgroundSettings("/work/alpha")?.effect).toBe("gradient-blur");
    expect(document.querySelector('[aria-label="Project background effect: Haze"]')).not.toBeNull();
  });
});
