import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Check, UsageIcon } from "./icons";
import { textAttributes, type TextTone } from "./Text";

describe("icon tone", () => {
  const tones: TextTone[] = [
    "secondary",
    "muted",
    "primary",
    "disabled",
    "neutral",
    "accent",
    "info",
    "success",
    "warning",
    "danger",
    "added",
    "removed",
    "inherit",
  ];

  it.each([Check, UsageIcon])("applies Text roles to both icon families", (Icon) => {
    for (const tone of tones) {
      const markup = renderToStaticMarkup(createElement(Icon, { tone, className: "icon-sm" }));
      expect(markup).toContain(`data-tone="${tone}"`);
      expect(markup).toContain(textAttributes({ tone }, "icon-sm").className);
      expect(markup).not.toContain(` tone=`);
    }
  });

  it.each([Check, UsageIcon])("leaves untinted output unchanged", (Icon) => {
    const markup = renderToStaticMarkup(createElement(Icon, { className: "icon-sm" }));
    expect(markup).not.toContain("data-tone");
    expect(markup).not.toContain("data-size");
    expect(markup).toContain("icon-sm");
  });
});
