// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SkillGroupsList } from "./SkillGroupsList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  document.body.innerHTML = "";
});

it("closes the group menu when an action is picked", () => {
  const onEdit = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const group = { id: "g", name: "Build", skillNames: [], source: "manual" as const, updatedAt: 0 };
  act(() =>
    root.render(
      createElement(SkillGroupsList, {
        groups: [group],
        entries: [],
        shownEntries: [],
        collapsed: [],
        toggle: () => {},
        renderRow: () => null,
        onEdit,
        onError: () => {},
      }),
    ),
  );
  const header = document.querySelector("section > *")!;
  act(() => {
    header.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const rename = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")].find(
    (item) => item.textContent === "Rename group",
  )!;
  act(() => rename.click());
  expect(onEdit).toHaveBeenCalledWith({ kind: "rename", group });
  expect(document.querySelector("[role='menu']")).toBeNull();
  act(() => root.unmount());
});
