// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

async function load() {
  vi.resetModules();
  return import("./tabGroups");
}

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => vi.unstubAllGlobals());

it("follows the shipped logo and each mascot writer, and keeps identity while nothing changed", async () => {
  invoke.mockResolvedValue("/data/auto-p.svg");
  const groups = await load();
  const project = "c:/work/p";
  const logos: Record<string, string> = {};
  const root = createRoot(document.createElement("div"));
  const logoSeen: (string | null)[] = [];
  const mascotSeen: Record<string, string>[] = [];
  function Probe() {
    logoSeen.push(groups.useResolvedTabGroupLogo(project, logos));
    mascotSeen.push(groups.useTabGroupMascots());
    return null;
  }
  await act(async () => root.render(createElement(Probe)));
  await vi.waitFor(() => expect(logoSeen[logoSeen.length - 1]).toBe("/data/auto-p.svg"));
  const settled = mascotSeen[mascotSeen.length - 1];
  await act(async () => root.render(createElement(Probe)));
  expect(mascotSeen[mascotSeen.length - 1]).toBe(settled);

  act(() => groups.saveTabGroupMascot(project, "fox"));
  expect(logoSeen[logoSeen.length - 1]).toBeNull();
  expect(mascotSeen[mascotSeen.length - 1]).toEqual({ [project]: "fox" });

  act(() => groups.clearTabGroupSettings(project));
  expect(logoSeen[logoSeen.length - 1]).toBe("/data/auto-p.svg");
  expect(mascotSeen[mascotSeen.length - 1]).toEqual({});

  act(() => groups.saveTabGroupMascot(project, "owl"));
  expect(logoSeen[logoSeen.length - 1]).toBeNull();
  act(() => groups.rebaseProjectTabGroupSettings(project, "c:/work/q"));
  expect(mascotSeen[mascotSeen.length - 1]).toEqual({ "c:/work/q": "owl" });
  expect(logoSeen[logoSeen.length - 1]).toBe("/data/auto-p.svg");
  act(() => root.unmount());
});

it("the resolver with arguments returns what resolveTabGroupLogo returns", async () => {
  const groups = await load();
  const key = "c:/work/p";
  expect(groups.resolveTabGroupLogoWith(key, { [key]: "/mine.png" }, "/auto.svg", {})).toBe(
    "/mine.png",
  );
  expect(groups.resolveTabGroupLogoWith(key, {}, "/auto.svg", { [key]: "fox" })).toBeNull();
  expect(groups.resolveTabGroupLogoWith(key, {}, "/auto.svg", {})).toBe("/auto.svg");
  expect(groups.resolveTabGroupLogoWith(key, {}, null, {})).toBeNull();
});
