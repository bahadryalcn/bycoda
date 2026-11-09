// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { InterfaceSizeGroup } from "./InterfaceSizeGroup";
import { APPEARANCE_DEFAULTS } from "../../../model/appearancePreferences";
import type { AppearanceSettings } from "../../useAppearanceSettings";

const state = vi.hoisted(() => ({
  update: vi.fn(),
  display: {
    density: "standard",
    showModel: true,
    showBranch: true,
    groupDelayMs: 700,
  },
}));
vi.mock("../../../../sessions/public/sessionListDisplay", () => ({
  DEFAULT_SESSION_LIST_DISPLAY: {
    density: "standard",
    showModel: true,
    showBranch: true,
    groupDelayMs: 700,
  },
  useSessionListDisplay: () => state.display,
  updateSessionListDisplay: state.update,
}));
vi.mock("../../settingsControls", () => ({
  Group: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
  Row: ({
    children,
    feedback,
    label,
    dependsOn,
    disabledReason,
    modified,
  }: {
    children: React.ReactNode;
    feedback?: React.ReactNode;
    label: string;
    dependsOn?: boolean;
    disabledReason?: string;
    modified?: boolean;
  }) =>
    createElement(
      "div",
      {
        "data-row": label,
        "data-disabled": dependsOn === false || undefined,
        "data-reason": disabledReason,
        "data-modified": modified || undefined,
      },
      children,
      feedback,
    ),
  Segmented: ({
    label,
    options,
    onChange,
  }: {
    label: string;
    options: { value: string }[];
    onChange: (value: string) => void;
  }) =>
    createElement(
      "div",
      { "aria-label": label },
      options.map((option) =>
        createElement(
          "button",
          { key: option.value, onClick: () => onChange(option.value) },
          option.value,
        ),
      ),
    ),
  Toggle: ({
    label,
    on,
    onChange,
  }: {
    label: string;
    on: boolean;
    onChange: (on: boolean) => void;
  }) =>
    createElement("button", {
      role: "switch",
      "aria-label": label,
      "aria-checked": on,
      onClick: () => onChange(!on),
    }),
}));
vi.mock("../../../../../shared/ui/Slider", () => ({
  Slider: ({
    label,
    value,
    marks,
    onValueChange,
    onValueCommit,
  }: {
    label: string;
    value: number;
    marks?: { value: number; label?: string }[];
    onValueChange: (value: number) => void;
    onValueCommit?: (value: number) => void;
  }) =>
    createElement(
      "div",
      {
        "aria-label": label,
        "data-value": value,
        "data-marks": marks?.map((mark) => mark.value).join(","),
      },
      createElement("button", { onClick: () => onValueChange(125) }, "drag"),
      createElement("button", { onClick: () => onValueCommit?.(125) }, "release"),
    ),
}));

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => {
  act(() => root.render(null));
  state.display = {
    density: "standard",
    showModel: true,
    showBranch: true,
    groupDelayMs: 700,
  };
  vi.clearAllMocks();
});

const render = (overrides: Partial<AppearanceSettings> = {}) =>
  act(() =>
    root.render(
      createElement(InterfaceSizeGroup, {
        appearance: {
          uiScale: 1,
          preferences: APPEARANCE_DEFAULTS,
          ...overrides,
        } as unknown as AppearanceSettings,
      }),
    ),
  );

it("previews scale while dragging and saves on release", () => {
  const onUiScale = vi.fn();
  render({ onUiScale });
  const slider = host.querySelector('[aria-label="Interface scale"]')!;
  expect(slider.getAttribute("data-marks")).toBe("80,100,125,150");
  act(() => (slider.querySelectorAll("button")[0] as HTMLButtonElement).click());
  expect(slider.getAttribute("data-value")).toBe("125");
  expect(onUiScale).not.toHaveBeenCalled();
  act(() => (slider.querySelectorAll("button")[1] as HTMLButtonElement).click());
  expect(onUiScale).toHaveBeenCalledWith(125);
});

it("routes both density choices to their owners", () => {
  const onPreferences = vi.fn();
  render({ onPreferences });
  act(() =>
    (
      host.querySelector('[aria-label="Control density"] button:last-child') as HTMLButtonElement
    ).click(),
  );
  expect(onPreferences).toHaveBeenCalledWith(expect.objectContaining({ controlDensity: "touch" }));
  act(() =>
    (
      host.querySelector('[aria-label="Row density"] button:first-child') as HTMLButtonElement
    ).click(),
  );
  expect(state.update).toHaveBeenCalledWith({ density: "compact" });
});

it("keeps one preview row and the model/branch switches under Row density", () => {
  render();
  const densityRow = host.querySelector('[data-row="Row density"]')!;
  const preview = densityRow.querySelector(".sidebar-row-preview")!;
  expect(preview.getAttribute("data-density")).toBe("standard");
  expect(preview.querySelectorAll(".sidebar-row-preview-row")).toHaveLength(1);
  expect(preview.textContent).toContain("main");
  const model = densityRow.querySelector('[role="switch"][aria-checked]') as HTMLButtonElement;
  expect(model.textContent).toContain("Show model");
  act(() => model.click());
  expect(state.update).toHaveBeenCalledWith({ showModel: false });
  const branch = [...densityRow.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((el) =>
    el.textContent?.includes("Show branch"),
  )!;
  act(() => branch.click());
  expect(state.update).toHaveBeenCalledWith({ showBranch: false });
});

it("disables the branch switch while rows are compact, and marks changed rows", () => {
  state.display = { ...state.display, density: "compact", showModel: false };
  render();
  const row = host.querySelector('[data-row="Row density"]')!;
  const branch = [...row.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((el) =>
    el.textContent?.includes("Show branch"),
  )!;
  expect(branch.disabled).toBe(true);
  expect(branch.getAttribute("title")).toBe("Compact rows have no branch line");
  expect(row.getAttribute("data-modified")).toBe("true");
});
