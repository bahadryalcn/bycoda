// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../../../shared/i18n", () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
}));
vi.mock("../../../settings/public/settingsControls", async () => {
  const { createElement } = await import("react");
  return {
    Row: ({ label, description, info, children }: any) =>
      createElement(
        "div",
        { role: "group", "aria-label": label },
        createElement("span", null, label),
        description ? createElement("p", null, description) : null,
        info,
        children,
      ),
  };
});
import { ProfileSelect } from "./ProfileControls";
import { ProfileRowsProvider, ProfileSwitch } from "./SettingsProfileRow";

let root: Root | undefined, container: HTMLDivElement;
async function mount(rows: boolean, onSwitch = vi.fn()) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(
        ProfileRowsProvider,
        { value: rows },
        createElement(ProfileSelect, {
          label: "Tone",
          hint: "One short line.",
          value: "friendly",
          options: [["friendly", "Friendly"]],
          onValueChange: () => undefined,
        }),
        createElement(ProfileSwitch, {
          label: "Allow profanity",
          description: "Style only.",
          checked: false,
          onCheckedChange: onSwitch,
        }),
      ),
    ),
  );
  return onSwitch;
}
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  vi.unstubAllGlobals();
});

it("renders profile controls as settings rows when the dialog turns rows on", async () => {
  const onSwitch = await mount(true);
  const groups = [...container.querySelectorAll('[role="group"]')].map((group) =>
    group.getAttribute("aria-label"),
  );
  expect(groups).toEqual(["Tone", "Allow profanity"]);
  expect(container.textContent).not.toContain("One short line.");
  expect(container.textContent).not.toContain("Style only.");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Tone: Help"]')!.click(),
  );
  expect(document.body.textContent).toContain("One short line.");
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  // The row owns the visible label, so the control keeps it only as its accessible name.
  expect(container.querySelector('button[aria-label^="Tone:"]')).toBeTruthy();
  const toggle = container.querySelector<HTMLButtonElement>(
    'button[role="switch"][aria-label="Allow profanity"]',
  )!;
  await act(async () => toggle.click());
  expect(onSwitch).toHaveBeenCalledWith(true);
});

it("keeps the plain setup form layout without the provider", async () => {
  await mount(false);
  expect(container.querySelector('[role="group"]')).toBeNull();
  expect(container.querySelector('button[role="switch"]')).toBeTruthy();
  expect(container.textContent).toContain("One short line.");
  expect(container.textContent).toContain("Style only.");
});
