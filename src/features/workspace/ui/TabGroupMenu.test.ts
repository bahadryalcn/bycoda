// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { notificationMuteActions } from "../../notifications/ui/notificationMuteActions";
import { TabGroupMenu } from "./TabGroupMenu";
import { BellOff } from "../../../shared/ui/icons";
import { clearProjectLogo, pickAndSetProjectLogo } from "../../projects/model/projectLogos";

vi.mock("../../projects/model/projectLogos", () => ({ clearProjectLogo: vi.fn(), pickAndSetProjectLogo: vi.fn(), projectLogoSrc: (path: string) => path }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll("button")].find(
    (item) =>
      item.textContent === label ||
      item.getAttribute("aria-label") === label ||
      item.textContent?.startsWith(label),
  );
  expect(result, `Button ${label}`).toBeDefined();
  return result as HTMLButtonElement;
}

function hover(label: string) {
  act(() => button(label).dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
}

function renderMenu(onExtraPick = vi.fn(), overrides: Partial<ComponentProps<typeof TabGroupMenu>> = {}) {
  act(() =>
    root.render(
      createElement(TabGroupMenu, {
        x: 20,
        y: 20,
        groupId: "private",
        label: "Private",
        colorIndex: null,
        customColor: null,
        currentColor: "#7c3aed",
        logoPath: null,
        mascotName: null,
        mascotProject: "private",
        onRename: vi.fn(),
        onColorChange: vi.fn(),
        onCustomColorChange: vi.fn(),
        onMascotChange: vi.fn(),
        onLogoChange: vi.fn(),
        onPick: vi.fn(),
        onClose: vi.fn(),
        leadingAction: {
          id: "notifications-resume",
          label: "Resume notifications",
          icon: BellOff,
        },
        extraItems: [
          {
            id: "notifications-mute",
            label: "Mute notifications",
            icon: BellOff,
            submenu: notificationMuteActions(),
          },
        ],
        onExtraPick,
        ...overrides,
      }),
    ),
  );
  return onExtraPick;
}

it.each(["save", "remove"])("keeps project logo %s errors visible and retryable", async (action) => {
  const operation = action === "save" ? vi.mocked(pickAndSetProjectLogo) : vi.mocked(clearProjectLogo);
  operation.mockRejectedValueOnce(new Error("Logo is too large (maximum 2 MB)."));
  const onClose = vi.fn(); const onLogoChange = vi.fn();
  renderMenu(vi.fn(), { logoProject: "/repo", logoPath: "/existing.png", onClose, onLogoChange });
  const label = action === "save" ? "Change project logo" : "Remove project logo";
  await act(async () => button(label).click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("maximum 2 MB");
  expect(onClose).not.toHaveBeenCalled(); expect(onLogoChange).not.toHaveBeenCalled();
  if (action === "save") vi.mocked(pickAndSetProjectLogo).mockResolvedValueOnce("/new.png");
  else vi.mocked(clearProjectLogo).mockResolvedValueOnce(undefined);
  await act(async () => button(label).click());
  expect(onLogoChange).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it("keeps the context menu scrollable within the viewport", () => {
  renderMenu();

  const menu = document.querySelector<HTMLElement>(
    '[role="menu"][aria-label="Tab group actions"]',
  )!;
  expect(menu.classList).toContain("overflow-y-auto");
  expect(menu.dataset.popoverSide).toBe("right");
});

it("closes the mute submenu when the pointer enters the leading action", () => {
  renderMenu();

  hover("Mute notifications");
  expect(document.querySelector('[role="menu"][aria-label="Mute notifications"]')).not.toBeNull();

  hover("Resume notifications");
  expect(document.querySelector('[role="menu"][aria-label="Mute notifications"]')).toBeNull();
});

it("closes the mute submenu on a standard action and allows reopening it", () => {
  const onExtraPick = renderMenu();

  hover("Mute notifications");
  hover("New tab in group");
  expect(document.querySelector('[role="menu"][aria-label="Mute notifications"]')).toBeNull();

  hover("Mute notifications");
  expect(document.querySelector('[role="menu"][aria-label="Mute notifications"]')).not.toBeNull();
  act(() => button("8 hours").click());
  expect(onExtraPick).toHaveBeenCalledWith("mute:8");
});

it("warns about a rejected name, does not save it and stays open", () => {
  const onRename = vi.fn();
  const onClose = vi.fn();
  act(() =>
    root.render(
      createElement(TabGroupMenu, {
        x: 20,
        y: 20,
        groupId: "private",
        label: "Private",
        colorIndex: null,
        customColor: null,
        currentColor: "#7c3aed",
        logoPath: null,
        mascotName: null,
        mascotProject: "private",
        onRename,
        validateName: (name) => (name === "Taken" ? "Already exists." : null),
        onColorChange: vi.fn(),
        onCustomColorChange: vi.fn(),
        onMascotChange: vi.fn(),
        onLogoChange: vi.fn(),
        onPick: vi.fn(),
        onClose,
      }),
    ),
  );
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Group name"]')!;
  const type = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const enter = () =>
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

  expect(document.querySelector('[role="alert"]')).toBeNull();
  type("Taken");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Already exists.");
  enter();
  act(() => input.blur());
  expect(onRename).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();

  act(() => input.focus());
  type("Free");
  expect(document.querySelector('[role="alert"]')).toBeNull();
  enter();
  expect(onRename).toHaveBeenCalledWith("private", "Free");
  expect(onClose).toHaveBeenCalledTimes(1);
});

it.each(["Tab group actions", "Mute notifications"])(
  "closes only the submenu after the pointer leaves %s and stays outside both panels",
  (panelLabel) => {
    vi.useFakeTimers();
    renderMenu();
    hover("Mute notifications");

    const main = document.querySelector('[role="menu"][aria-label="Tab group actions"]')!;
    const submenu = document.querySelector('[role="menu"][aria-label="Mute notifications"]')!;
    const leave = (panel: Element) =>
      act(() => {
        panel.dispatchEvent(
          new MouseEvent("mouseout", {
            bubbles: true,
            relatedTarget: document.body,
          }),
        );
      });
    const enter = (panel: Element) =>
      act(() => {
        panel.dispatchEvent(
          new MouseEvent("mouseover", {
            bubbles: true,
            relatedTarget: document.body,
          }),
        );
      });

    leave(main);
    act(() => vi.advanceTimersByTime(100));
    enter(submenu);
    act(() => vi.advanceTimersByTime(200));
    expect(submenu.isConnected).toBe(true);

    leave(submenu);
    act(() => vi.advanceTimersByTime(100));
    enter(main);
    act(() => vi.advanceTimersByTime(200));
    expect(submenu.isConnected).toBe(true);

    const panel = panelLabel === "Tab group actions" ? main : submenu;
    enter(panel);
    leave(panel);
    act(() => vi.advanceTimersByTime(179));
    expect(submenu.isConnected).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(submenu.isConnected).toBe(false);
    expect(main.isConnected).toBe(true);
    expect(button("Mute notifications").getAttribute("aria-expanded")).toBe("false");
  },
);
