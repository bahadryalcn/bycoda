// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { cumulativeCssZoom } from "./cssZoom";

afterEach(() => {
  document.documentElement.style.removeProperty("zoom");
  document.body.style.removeProperty("zoom");
  document.body.replaceChildren();
});

it("includes document, body and intermediate zoom instead of reading only the anchor", () => {
  document.documentElement.style.setProperty("zoom", "1.25");
  document.body.style.setProperty("zoom", "120%");
  const portal = document.createElement("div");
  const child = document.createElement("div");
  portal.style.setProperty("zoom", "0.8");
  portal.append(child);
  document.body.append(portal);
  expect(cumulativeCssZoom(child)).toBeCloseTo(1.2);
});

it("keeps normal coordinate space unchanged and does not treat transforms as CSS zoom", () => {
  const element = document.createElement("div");
  element.style.transform = "scale(0.9)";
  document.body.append(element);
  expect(cumulativeCssZoom(element)).toBe(1);
  expect(cumulativeCssZoom(null)).toBe(1);
});
