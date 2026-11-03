// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SplitButton, type SplitButtonProps } from "./SplitButton";
import { popupNativeActionMenu } from "./nativeActionMenu";

vi.mock("./nativeActionMenu", () => ({ popupNativeActionMenu: vi.fn() }));

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.mocked(popupNativeActionMenu).mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(props: Partial<SplitButtonProps> = {}, submit = vi.fn()) {
  await act(async () =>
    root.render(
      createElement(
        "form",
        {
          id: "form",
          onSubmit: (event) => {
            event.preventDefault();
            submit();
          },
        },
        createElement(SplitButton, {
          label: "Merge",
          menuLabel: "Merge options",
          actions: [],
          ...props,
        }),
      ),
    ),
  );
  return {
    main: container.querySelectorAll("button")[0],
    menu: container.querySelectorAll("button")[1],
    submit,
  };
}
it("keeps native main refs, default non-submit behavior, and explicit form submit", async () => {
  const ref = createRef<HTMLButtonElement>(),
    click = vi.fn((event) => expect(event.currentTarget).toBe(ref.current));
  const first = await render({ ref, onClick: click });
  expect(ref.current).toBe(first.main);
  await act(async () => first.main.click());
  expect(click).toHaveBeenCalledOnce();
  expect(first.submit).not.toHaveBeenCalled();
  const next = await render({ ref, type: "submit", name: "action", value: "merge", form: "form" });
  await act(async () => next.main.click());
  expect(next.submit).toHaveBeenCalledOnce();
  expect(next.main.name).toBe("action");
  expect(next.main.value).toBe("merge");
});
it("selects only an enabled method once and returns focus without invoking the main action", async () => {
  const main = vi.fn(),
    choose = vi.fn();
  const { menu } = await render({
    onClick: main,
    actions: [
      {
        id: "merge",
        label: "Merge commit",
        description: "Retain all commits",
        checked: true,
        selectionRole: "radio",
        onSelect: vi.fn(),
      },
      {
        id: "disabled",
        label: "Unavailable method",
        disabled: true,
        description: "No permission",
        onSelect: vi.fn(),
      },
      { id: "squash", label: "Squash", description: "One commit", onSelect: choose },
    ],
  });
  await act(async () => menu.click());
  const options = Array.from(document.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]'));
  expect(options[0].getAttribute("role")).toBe("menuitemradio");
  expect(options[1].disabled).toBe(true);
  expect(options[1].getAttribute("aria-description")).toBe("No permission");
  await act(async () => {
    options[2].click();
    options[2].click();
  });
  expect(choose).toHaveBeenCalledOnce();
  expect(main).not.toHaveBeenCalled();
  expect(menu.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(menu);
});
it("blocks both halves while pending or aria-disabled", async () => {
  const main = vi.fn(),
    choose = vi.fn();
  const actions = [{ id: "method", label: "Method", onSelect: choose }];
  const { main: button, menu } = await render({ loading: true, onClick: main, actions });
  await act(async () => {
    button.click();
    menu.click();
  });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  button.focus();
  expect(document.activeElement).toBe(button);
  expect(menu.disabled).toBe(true);
  expect(main).not.toHaveBeenCalled();
  const next = await render({ "aria-disabled": true, onClick: main, actions });
  await act(async () => {
    next.main.click();
    next.menu.click();
  });
  expect(next.menu.disabled).toBe(true);
  expect(choose).not.toHaveBeenCalled();
});
it("allows keyboard choices while the primary is disabled, but keeps loading and group aria-disabled authoritative", async () => {
  const commit = vi.fn(),
    amend = vi.fn();
  const choices = [{ id: "amend", label: "Amend last commit", checked: false, onSelect: amend }];
  let controls = await render({
    disabled: true,
    menuDisabled: false,
    onClick: commit,
    actions: choices,
  });
  expect(controls.main.disabled).toBe(true);
  expect(controls.menu.disabled).toBe(false);
  await act(async () => {
    controls.menu.focus();
    controls.menu.click();
  });
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  await act(async () =>
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
  );
  const option = document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!;
  expect(document.activeElement).toBe(option);
  await act(async () => option.click());
  expect(amend).toHaveBeenCalledOnce();
  expect(commit).not.toHaveBeenCalled();
  controls = await render({
    disabled: true,
    menuDisabled: false,
    loading: true,
    onClick: commit,
    actions: choices,
  });
  expect(controls.menu.disabled).toBe(true);
  await act(async () => controls.menu.click());
  expect(document.querySelector('[role="menu"]')).toBeNull();
  controls = await render({
    disabled: true,
    menuDisabled: false,
    "aria-disabled": true,
    onClick: commit,
    actions: choices,
  });
  expect(controls.menu.disabled).toBe(true);
  expect(commit).not.toHaveBeenCalled();
});

it.each([
  ["primary", "gap"],
  ["secondary", "shared"],
  [undefined, "shared"],
  ["danger", "shared"],
  ["ghost", "none"],
] as const)("marks the primary and menu parts and a %s seam for %s", async (variant, seam) => {
  await render({ variant, actions: [{ id: "squash", label: "Squash", onSelect: vi.fn() }] });
  const group = container.querySelector<HTMLElement>('[role="group"]')!;
  expect(group.dataset.splitSeam).toBe(seam);
  expect(group.querySelector('[data-split-part="primary"]')?.textContent).toBe("Merge");
  expect(group.querySelector('[data-split-part="menu"]')?.getAttribute("aria-label")).toBe(
    "Merge options",
  );
});

it("keeps the options trigger the same size family as the primary action", async () => {
  const { main, menu } = await render({
    size: "md",
    actions: [{ id: "squash", label: "Squash", onSelect: vi.fn() }],
  });
  expect(main.dataset.buttonSize).toBe("md");
  expect(menu.dataset.buttonSize).toBe("md");
  expect(menu.getAttribute("aria-haspopup")).toBe("menu");
});

it("requests a native menu without a clipped DOM popup or treating display acceptance as a selection", async () => {
  const choose = vi.fn(), main = vi.fn();
  const actions = [{ id: "manual", label: "Manual", checked: true, selectionRole: "radio" as const, onSelect: choose }];
  const { menu } = await render({ menuSurface: "native", actions, onClick: main });
  await act(async () => menu.click());
  expect(popupNativeActionMenu).toHaveBeenCalledExactlyOnceWith(menu, actions, expect.any(Function));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(menu.hasAttribute("aria-expanded")).toBe(false);
  expect(choose).not.toHaveBeenCalled();
  expect(main).not.toHaveBeenCalled();
  // Tauri may acknowledge popup before its later OS item callback.
  await act(async () => vi.mocked(popupNativeActionMenu).mock.calls[0][2]("manual"));
  expect(choose).toHaveBeenCalledOnce();
  await act(async () => menu.click());
  expect(popupNativeActionMenu).toHaveBeenCalledTimes(2);
});

it("rejects native callbacks after permission changes or removal of their source", async () => {
  const choose = vi.fn();
  const actions = [{ id: "manual", label: "Manual", onSelect: choose }];
  const { menu } = await render({ menuSurface: "native", actions });
  await act(async () => menu.click());
  const pick = vi.mocked(popupNativeActionMenu).mock.calls[0][2];
  await render({ menuSurface: "native", actions, loading: true });
  await act(async () => pick("manual"));
  expect(choose).not.toHaveBeenCalled();
  await render({ menuSurface: "native", actions });
  await act(async () => root.render(null));
  await act(async () => pick("manual"));
  expect(choose).not.toHaveBeenCalled();
});

it("reports a failed native popup and allows retry without picking an action", async () => {
  const error = new Error("popup unavailable"), failed = vi.fn(), choose = vi.fn();
  vi.mocked(popupNativeActionMenu).mockRejectedValueOnce(error);
  const { menu } = await render({ menuSurface: "native", onMenuError: failed, actions: [{ id: "manual", label: "Manual", onSelect: choose }] });
  await act(async () => menu.click());
  expect(failed).toHaveBeenCalledExactlyOnceWith(error);
  expect(choose).not.toHaveBeenCalled();
  await act(async () => menu.click());
  expect(popupNativeActionMenu).toHaveBeenCalledTimes(2);
});
