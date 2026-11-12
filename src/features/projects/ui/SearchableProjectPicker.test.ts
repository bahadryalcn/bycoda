// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SearchableProjectPicker } from "./SearchableProjectPicker";

vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => {
  act(() => root.render(null));
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("opens the active project's context menu and restores search focus after nested interaction", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onProjectContextMenu = vi.fn();
  const render = (projectMenuActive: boolean) =>
    act(async () =>
      root.render(
        createElement(SearchableProjectPicker, {
          cwd: "/repo",
          recents: [{ path: "/repo", openedAt: 1 }],
          onSelectProject: vi.fn(),
          onProjectContextMenu,
          projectMenuActive,
        }),
      ),
    );
  await render(false);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click(),
  );
  const search = document.querySelector<HTMLInputElement>('input[aria-label="Search projects"]')!;
  await act(async () =>
    search.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(onProjectContextMenu).toHaveBeenCalledWith(
    "/repo",
    expect.any(Number),
    expect.any(Number),
    search,
  );
  await render(true);
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(document.querySelector('[role="dialog"][aria-label="Project picker"]')).not.toBeNull();
  const elsewhere = document.createElement("button");
  document.body.append(elsewhere);
  elsewhere.focus();
  await render(false);
  expect(document.activeElement).toBe(search);
  elsewhere.remove();
});
