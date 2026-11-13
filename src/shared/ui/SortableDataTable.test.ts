// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DataTable, DataTableRow, SortableDataTable } from "./SortableDataTable";
it("uses native column and group headers, hidden action label, and spanning detail cells", () => {
  const html = renderToStaticMarkup(
    createElement(DataTable, {
      caption: "CLI",
      headers: [{ label: "Provider" }, { label: "Actions", hidden: true }],
      children: [
        createElement(DataTableRow, { key: "group", heading: "Not installed", columnCount: 2 }),
        createElement(DataTableRow, {
          key: "row",
          cells: ["Codex", "Set up"],
          detail: "Check failed",
        }),
      ],
    }),
  );
  expect(html).toContain('scope="col"');
  expect(html).toContain('scope="rowgroup" colSpan="2"');
  expect(html).toContain(' sr-only">Actions');
  expect(html).toContain('<td colSpan="2">Check failed</td>');
  expect(html).not.toContain("role=");
});

it("keeps intrinsic sizing opt-in and preserves responsive categories, numeric sorting and explicit widths", () => {
  const columns = [
    { key: "name", label: "Name", sizing: "flex" as const },
    { key: "state", label: "State", sizing: "content" as const },
    { key: "count", label: "Count", numeric: true, hideBelow: "sm" as const, width: 80 },
  ];
  const rows = [{ id: "one", name: "Long identity", state: "New", count: 12 }];
  const html = renderToStaticMarkup(
    createElement(SortableDataTable, { rows, columns, rowKey: "id" }),
  );
  const host = document.createElement("div");
  host.innerHTML = html;
  expect(host.querySelector("table")?.hasAttribute("data-intrinsic")).toBe(true);
  expect(host.querySelector("tbody [data-primary]")?.getAttribute("data-sizing")).toBe("flex");
  expect(host.querySelector('tbody [data-label="State"]')?.getAttribute("data-sizing")).toBe(
    "content",
  );
  expect(host.querySelector('tbody [data-label="Count"]')?.getAttribute("data-hide")).toBe("sm");
  expect(host.querySelector('tbody [data-label="Count"]')?.hasAttribute("data-numeric")).toBe(true);
  expect(host.querySelectorAll("col")[2]?.style.width).toBe("80px");
  const ordinary = renderToStaticMarkup(
    createElement(SortableDataTable, {
      rows,
      columns: [{ key: "name", label: "Name" }],
      rowKey: "id",
    }),
  );
  expect(ordinary).not.toContain("data-intrinsic");
});
