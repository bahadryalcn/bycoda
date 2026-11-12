// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DataTable, DataTableRow } from "./SortableDataTable";
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
