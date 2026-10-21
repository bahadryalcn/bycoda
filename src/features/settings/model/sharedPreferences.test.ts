// @vitest-environment happy-dom
import { act, createElement, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSettingsBackedFlags } from "../../../app/workspace/state/useSettingsBackedFlags";
import { useTranscriptLayout } from "../../sessions/hooks/useTranscriptLayout";
import { useTranscriptAnchor } from "../../sessions/hooks/useTranscriptAnchor";
import { loadCrewSceneEnabled, subscribeCrewSceneEnabled, loadCrewGrowthEnabled, subscribeCrewGrowthEnabled } from "./settings";
import { getPickerVisibilitySnapshot, subscribePickerVisibility, isPickerProviderVisible } from "../../sessions/model/models";

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let renders = 0;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); container = document.createElement("div"); root = createRoot(container); renders = 0; });
afterEach(async () => { await act(async () => root.unmount()); localStorage.clear(); vi.unstubAllGlobals(); });

function Consumers() {
  renders++;
  const flags = useSettingsBackedFlags();
  const layout = useTranscriptLayout();
  const anchor = useTranscriptAnchor();
  const crew = useSyncExternalStore(subscribeCrewSceneEnabled, loadCrewSceneEnabled);
  const growth = useSyncExternalStore(subscribeCrewGrowthEnabled, loadCrewGrowthEnabled);
  useSyncExternalStore(subscribePickerVisibility, getPickerVisibilitySnapshot);
  return createElement("output", null, JSON.stringify({ rail: flags.collapsedProjectRailMode, agents: flags.liveAgentsEnabled, layout, anchor, crew, growth, claude: isPickerProviderVisible("claude") }));
}

it("updates mounted workspace/transcript/crew/picker consumers from sibling storage and handles clear", async () => {
  await act(async () => root.render(createElement(Consumers)));
  const before = JSON.parse(container.textContent!);
  await act(async () => {
    for (const [key, value] of Object.entries({
      "bycoda.collapsedProjectRailMode": "hidden", "bycoda.liveAgentsEnabled": "0", "bycoda.transcriptLayout": "full", "bycoda.transcriptAnchor": "0", "bycoda.crewSceneEnabled": "0", "bycoda.crewGrowthEnabled": "0", "bycoda.hiddenPickerProviders": '["claude"]',
    })) { localStorage.setItem(key, value); window.dispatchEvent(new StorageEvent("storage", { key })); }
  });
  expect(JSON.parse(container.textContent!)).toEqual({ rail: "hidden", agents: false, layout: "full", anchor: false, crew: false, growth: false, claude: false });
  await act(async () => { localStorage.clear(); window.dispatchEvent(new StorageEvent("storage", { key: null })); });
  expect(JSON.parse(container.textContent!)).toEqual(before);
});

it("ignores per-window layout keys and another storage area", async () => {
  await act(async () => root.render(createElement(Consumers)));
  const before = container.textContent;
  const rendered = renders;
  await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.sidebarWidth" })); window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.crewSceneEnabled", storageArea: sessionStorage })); });
  expect(container.textContent).toBe(before);
  expect(renders).toBe(rendered);
});

it("notifies multiple picker subscribers once and removes its sibling storage listener", () => {
  const first = vi.fn(); const second = vi.fn();
  const stopFirst = subscribePickerVisibility(first); const stopSecond = subscribePickerVisibility(second);
  const before = getPickerVisibilitySnapshot();
  window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.hiddenPickerProviders" }));
  expect(getPickerVisibilitySnapshot()).toBe(before + 1);
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
  stopFirst(); stopSecond();
  window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.hiddenPickerProviders" }));
  expect(getPickerVisibilitySnapshot()).toBe(before + 1);
});
