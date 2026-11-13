// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InboxScopeCollection } from "./InboxScopeCollection";

it("names filtered bulk scope and preserves hidden selections", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let selected: string[] = [];
  function Fixture() {
    const [ids, setIds] = useState(["a", "b"]);
    selected = ids;
    return createElement(InboxScopeCollection, {
      label: "Projects",
      searchLabel: "Search projects",
      items: [
        { id: "a", title: "Alpha" },
        { id: "b", title: "Beta" },
      ],
      selectedIds: ids,
      onChange: setIds,
      summary: (count, total) => `${count} of ${total} selected`,
      emptyLabel: "None",
      noMatchLabel: "No match",
    });
  }
  try {
    await act(async () => root.render(createElement(Fixture)));
    const search = container.querySelector<HTMLInputElement>("input")!;
    const fill = (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          search,
          value,
        );
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await fill("Alpha");
    expect(container.textContent).toContain("Select all shown");
    const clear = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "Clear shown selection",
    )!;
    expect(clear).toBeDefined();
    await act(async () => clear.click());
    expect(selected).toEqual(["b"]);
    await fill("");
    expect(container.textContent).toContain("1 of 2 selected");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
