// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SocialAudienceContactRow } from "./SocialAudienceContactRow";
import { SocialInboxThreadRow } from "./SocialInboxThreadRow";
import type { SocialContact, SocialSnapshot, SocialThread } from "../model/social";

it("associates each extracted selection label with its native checkbox", () => {
  const snapshot = { accounts: [] } as unknown as SocialSnapshot;
  const common = {
    snapshot,
    selected: false,
    checked: false,
    disabled: false,
    onCheckedChange: () => {},
    onSelect: () => {},
  };
  const rows = [
    createElement(SocialAudienceContactRow, {
      ...common,
      projects: [],
      contact: {
        id: "contact",
        accountId: "account",
        name: "Contact",
        platformId: "contact",
        projectIds: [],
        tags: [],
      } as unknown as SocialContact,
    }),
    createElement(SocialInboxThreadRow, {
      ...common,
      showCheckbox: true,
      item: {
        id: "thread",
        accountId: "account",
        projectId: "project",
        kind: "message",
        events: [],
        lastInboundAt: 1,
      } as unknown as SocialThread,
    }),
  ];
  for (const row of rows) {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(row);
    document.body.append(container);
    const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const label = container.querySelector("label")!;
    expect(input.id).not.toBe("");
    expect(label.htmlFor).toBe(input.id);
    expect(input.getAttribute("aria-label")).not.toBe("");
    label.click();
    expect(input.checked).toBe(true);
    container.remove();
  }
});
