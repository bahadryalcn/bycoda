// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadCrewTheme, saveCrewSceneEnabled, saveCrewTheme } from "../../../model/settings";
import { saveDecorativeMotionEnabled } from "../../../model/decorativeMotion";
import { CrewStageCard } from "./CrewStageCard";

vi.mock("../../../../sessions/ui/crewCodeArt", () => ({
  CODE_WIDTH: 1040,
  CODE_HEIGHT: 300,
  SIGN_TOP: 14,
  SIGN_HEIGHT: 58,
  CREW_TOP: 0,
  loadCrewSignLogo: () => Promise.resolve(),
  createCodeArtPainter: () => Object.assign(vi.fn(), { dispose: vi.fn() }),
}));
vi.mock("../../../../sessions/ui/crewThemes", () => ({ riggedCrewTheme: () => null }));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(240);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 800,
    height: 240,
    top: 0,
    bottom: 240,
    left: 0,
    right: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  localStorage.clear();
  saveCrewSceneEnabled(true);
  saveCrewTheme("classic");
  saveDecorativeMotionEnabled(true);
});
afterEach(() => {
  saveCrewTheme("classic");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("stops a running preview when decorative animations are disabled", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(CrewStageCard)));
    expect(host.querySelector(".crew-scene")?.getAttribute("data-motion")).toBe("running");
    const toggle = host.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Decorative animations"]',
    );
    expect(toggle).not.toBeNull();
    await act(async () => toggle!.click());
    expect(host.querySelector(".crew-scene")?.getAttribute("data-motion")).toBe("still");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    saveDecorativeMotionEnabled(true);
  }
});

it("saves the selected theme and keeps the real scene still under reduced motion", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(CrewStageCard)));
    const theme = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((button) =>
      button.textContent?.includes("Star Wars"),
    );
    expect(theme).toBeDefined();
    await act(async () => theme!.click());
    expect(loadCrewTheme()).toBe("star-wars");
    expect(host.querySelector(".crew-scene")?.getAttribute("data-theme")).toBe("star-wars");
    expect(host.querySelector(".crew-scene")?.getAttribute("data-motion")).toBe("still");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("offers The Matrix and explains its cast once selected", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(CrewStageCard)));
    const options = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].map((button) =>
      button.textContent?.trim(),
    );
    expect(options).toEqual(["Classic crew", "Star Wars", "The Lord of the Rings", "The Matrix"]);
    const matrix = host.querySelector<HTMLButtonElement>('[role="radio"][data-value="matrix"]');
    expect(matrix).not.toBeNull();
    await act(async () => matrix!.click());
    expect(loadCrewTheme()).toBe("matrix");
    expect(host.querySelector(".crew-stage-hint")?.textContent).toBe(
      "Neo leads, Morpheus advises, and every subagent is another Agent Smith.",
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("keeps the stage reachable but dimmed while the crew is off", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(CrewStageCard)));
    const toggle = host.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Agent crew"]',
    );
    expect(toggle).not.toBeNull();
    await act(async () => toggle!.click());
    const row = host.querySelector("#setting-crew-theme");
    expect(row?.getAttribute("data-disabled")).toBe("true");
    expect(row?.querySelector(".crew-scene")).not.toBeNull();
    expect(
      [...row!.querySelectorAll<HTMLButtonElement>('[role="radio"]')].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    saveCrewSceneEnabled(true);
  }
});
