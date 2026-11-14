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

it("draws a labelled face over a hidden source reference", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(
      DraftToken,
      { prefix: "[", icon: createElement(Sparkles), label: "Image 12 · 1 B" },
      "Image 12 · 1 B]",
    ),
  );
  const token = host.querySelector("[data-draft-token-face]")!;
  const [source, face] = [...token.children];
  expect(source.textContent).toBe("[Image 12 · 1 B]");
  expect(source.hasAttribute("aria-hidden")).toBe(false);
  expect(face.getAttribute("aria-hidden")).toBe("true");
  expect(face.textContent).toBe("Image 12 · 1 B");
  expect(face.querySelector("svg")).not.toBeNull();
  expect(host.querySelector("[data-draft-token-ordinal]")).toBeNull();
});
