// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { InboxConnectMenu } from "./InboxConnectMenu";

vi.mock("../../../shared/i18n", () => ({
  useLocale: () => "de",
  t: (key: string, values?: { p0?: string }) =>
    key === "Connect {p0}" ? `${values?.p0} verbinden` : key,
}));
vi.mock("../../../shared/ui/DropdownMenu", () => ({
  DropdownMenu: ({ items }: { items: { label: string }[] }) =>
    createElement("div", null, items.map((item) => item.label).join(", ")),
}));

it("lets translations place the provider before the connect action", () => {
  const markup = renderToStaticMarkup(
    createElement(InboxConnectMenu, {
      anchor: { x: 0, y: 0 },
      sources: ["github"],
      onConnect: () => {},
      onClose: () => {},
    }),
  );
  expect(markup).toContain("GitHub verbinden");
});
