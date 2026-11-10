// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { pastDragThreshold, startsHeaderDrag } from "./voicePanelDrag";

function header() {
  const root = document.createElement("header");
  root.innerHTML = `<button data-drag-handle><svg id="grip"></svg></button><h2 id="title">Arif</h2>
    <button id="settings"><svg id="icon"></svg></button><a id="link" href="#">x</a>`;
  return root;
}

it("starts a drag from the title, grip and empty header but not from controls", () => {
  const root = header();
  const at = (id: string) => root.querySelector(`#${id}`);
  expect(startsHeaderDrag(root)).toBe(true);
  expect(startsHeaderDrag(at("title"))).toBe(true);
  expect(startsHeaderDrag(at("grip"))).toBe(true);
  expect(startsHeaderDrag(at("settings"))).toBe(false);
  expect(startsHeaderDrag(at("icon"))).toBe(false);
  expect(startsHeaderDrag(at("link"))).toBe(false);
  expect(startsHeaderDrag(null)).toBe(false);
});

it("ignores jitter below the movement threshold", () => {
  expect(pastDragThreshold(1, 2)).toBe(false);
  expect(pastDragThreshold(3, 3)).toBe(true);
});
