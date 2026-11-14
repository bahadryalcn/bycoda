// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
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

it("falls back to the source text when a face token wraps across lines", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const rects = vi
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([new DOMRect(), new DOMRect()] as unknown as DOMRectList);
  const node = createElement(
    DraftToken,
    { prefix: "/", icon: createElement(Sparkles), label: "frontend-design" },
    "frontend-design",
  );
  await act(async () => root.render(node));
  const token = host.querySelector("[data-draft-token-face]")!;
  expect(token.hasAttribute("data-draft-token-wrapped")).toBe(true);
  rects.mockReturnValue([new DOMRect()] as unknown as DOMRectList);
  await act(async () => root.render(createElement("div", null, node)));
  expect(host.querySelector("[data-draft-token-wrapped]")).toBeNull();
  await act(async () => root.unmount());
  rects.mockRestore();
  host.remove();
  vi.unstubAllGlobals();
});
