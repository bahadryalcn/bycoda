// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { InboxConnectMenu } from "./InboxConnectMenu";

vi.mock("../../../shared/i18n", () => ({
  useLocale: () => "de",
  t: (key: string) => key,
}));
vi.mock("../../../shared/ui/DropdownMenu", () => ({
  DropdownMenu: ({ items }: { items: { label: string; items?: { label: string }[] }[] }) =>
    createElement(
      "div",
      null,
      items.map((item) => [item.label, ...(item.items ?? []).map((row) => row.label)].join(", ")),
    ),
}));

it("titles the menu with the action and labels each row with only the provider", () => {
  const markup = renderToStaticMarkup(
    createElement(InboxConnectMenu, {
      anchor: { x: 0, y: 0 },
      sources: ["github"],
      onConnect: () => {},
      onClose: () => {},
    }),
  );
  expect(markup).toContain("Connect an inbox source, GitHub");
  expect(markup).not.toContain("Connect GitHub");
});
