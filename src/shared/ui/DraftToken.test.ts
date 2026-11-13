// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Sparkles } from "./icons";
import { DraftToken } from "./DraftToken";

it("keeps source characters once and confines decorative icon to the prefix", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(DraftToken, { prefix: "/", icon: createElement(Sparkles) }, "frontend-design"),
  );
  expect(host.textContent).toBe("/frontend-design");
  expect(host.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
  expect(host.querySelector("button, input, textarea")).toBeNull();
});
