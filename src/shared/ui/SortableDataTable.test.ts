// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SortableDataTable } from "./SortableDataTable";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = { id: string; name: string };
const rows: Row[] = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Grace" },
];

let element: HTMLDivElement;
let root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

function render(props: Record<string, unknown> = {}) {
  act(() =>
    root.render(
      createElement(SortableDataTable<Row>, {
        rows,
        columns: [
          { key: "name", label: "Name" },
          { key: "note", label: "Note", hideBelow: "md" },
        ],
        rowKey: "id",
        ...props,
      }),
    ),
  );
}

const bodyRows = () => Array.from(element.querySelectorAll<HTMLElement>("tbody tr[data-row-key]"));

describe("SortableDataTable", () => {
  it("activates a row on click and on Enter instead of selecting it", () => {
    const onRowActivate = vi.fn();
    const onSelectionChange = vi.fn();
    render({ onRowActivate, selectable: true, onSelectionChange });
    act(() => bodyRows()[1]!.click());
    expect(onRowActivate).toHaveBeenCalledWith("b", rows[1]);
    expect(onSelectionChange).not.toHaveBeenCalled();
    act(() => {
      bodyRows()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onRowActivate).toHaveBeenLastCalledWith("a", rows[0]);
  });

  it("does not activate when a control inside the row is clicked", () => {
    const onRowActivate = vi.fn();
    render({
      onRowActivate,
      columns: [
        { key: "name", label: "Name", render: () => createElement("button", null, "Open") },
      ],
    });
    act(() => element.querySelector<HTMLElement>("tbody button")!.click());
    expect(onRowActivate).not.toHaveBeenCalled();
  });

  it("marks the active row", () => {
    render({ activeKey: "b", onRowActivate: vi.fn() });
    expect(bodyRows().map((row) => row.getAttribute("aria-current"))).toEqual([null, "true"]);
    expect(bodyRows()[1]!.hasAttribute("data-active")).toBe(true);
  });

  it("honours caller-controlled selection and custom labels", () => {
    const onSelectionChange = vi.fn();
    render({
      selectable: true,
      selectedKeys: ["a"],
      onSelectionChange,
      selectAllLabel: "Pick everyone",
      rowLabel: (row: Row) => `Pick ${row.name}`,
    });
    const box = (label: string) =>
      element.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    expect(box("Pick Ada").checked).toBe(true);
    expect(box("Pick everyone").indeterminate).toBe(true);
    act(() => box("Pick Grace").click());
    expect(onSelectionChange).toHaveBeenCalledWith(["a", "b"]);
  });

  it("tags responsive columns and renders the footer slot", () => {
    render({ footer: createElement("span", null, "More") });
    expect(element.querySelectorAll('[data-hide="md"]').length).toBeGreaterThan(0);
    expect(element.textContent).toContain("More");
  });
});
