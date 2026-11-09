// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { RevealedSetting } from "../../settingsControls";
import { LayerStack, type BackgroundLayer } from "./LayerStack";

let container: HTMLDivElement;
let root: Root;
const layers: BackgroundLayer[] = [
  {
    id: "glass",
    name: "Glass",
    enabled: true,
    settingIds: ["blur"],
    anchorIds: ["blur"],
    content: "Glass editor",
  },
  {
    id: "color",
    name: "Color",
    enabled: true,
    settingIds: ["angle"],
    anchorIds: ["angle"],
    content: "Color editor",
  },
];
function render(revealed: string | null = null) {
  act(() =>
    root.render(
      createElement(
        RevealedSetting.Provider,
        { value: revealed },
        createElement(LayerStack, {
          layers,
          label: "Background layers",
          description: "Layers from back to front",
        }),
      ),
    ),
  );
}
function button(name: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === name,
  )!;
}
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("opens one editor at a time and keeps closed editors mounted", () => {
  render();
  expect(container.querySelector("#setting-blur")).not.toBeNull();
  act(() => button("Glass").click());
  expect(button("Glass").getAttribute("aria-expanded")).toBe("true");
  act(() => button("Color").click());
  expect(button("Glass").getAttribute("aria-expanded")).toBe("false");
  expect(button("Color").getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("Glass editor");
  act(() => button("Color").click());
  expect(button("Color").getAttribute("aria-expanded")).toBe("false");
});

it("opens the layer containing a newly revealed setting", () => {
  render();
  render("angle");
  expect(button("Color").getAttribute("aria-expanded")).toBe("true");
  render("blur");
  expect(button("Glass").getAttribute("aria-expanded")).toBe("true");
  expect(button("Color").getAttribute("aria-expanded")).toBe("false");
});

it("shows thumbnails, summaries and muted off layers in front-to-back order", () => {
  const previews: BackgroundLayer[] = [
    {
      id: "glass",
      name: "Glass",
      enabled: true,
      strength: "75%",
      thumbnail: createElement("span", { "data-preview": "glass" }),
      content: null,
    },
    {
      id: "color",
      name: "Color",
      enabled: false,
      strength: "Off",
      thumbnail: createElement("span", { "data-preview": "color" }),
      content: null,
    },
    {
      id: "image",
      name: "Image",
      enabled: true,
      strength: "60%",
      thumbnail: createElement("img", { src: "image.png", alt: "" }),
      content: null,
    },
    {
      id: "live",
      name: "Live",
      enabled: true,
      strength: "Soft Aurora · 43%",
      thumbnail: createElement("canvas", { "data-preview": "live" }),
      content: null,
    },
  ];
  act(() =>
    root.render(
      createElement(LayerStack, {
        layers: previews,
        label: "Backgrounds",
        description: "Layers from back to front",
      }),
    ),
  );
  const list = container.querySelector("ul")!;
  expect(list.getAttribute("aria-label")).toBe("Backgrounds. Layers from back to front");
  const rows = [...list.querySelectorAll("li")];
  expect(rows.map((row) => row.querySelector("button")?.textContent)).toEqual([
    "LiveSoft Aurora · 43%",
    "Image60%",
    "ColorOff",
    "Glass75%",
  ]);
  expect(rows[0]?.querySelector('[data-preview="live"]')).not.toBeNull();
  expect(rows[1]?.querySelector('img[src="image.png"]')).not.toBeNull();
  expect(rows[2]?.querySelector('[data-preview="color"]')).not.toBeNull();
  expect(rows[2]?.hasAttribute("data-disabled")).toBe(true);
  expect(rows[3]?.querySelector('[data-preview="glass"]')).not.toBeNull();
  expect(rows[3]?.hasAttribute("data-disabled")).toBe(false);
});
