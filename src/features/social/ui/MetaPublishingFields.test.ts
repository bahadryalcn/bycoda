// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialMedia } from "../model/social";
import { MetaPublishingFields } from "./MetaPublishingFields";

let element: HTMLDivElement;
let root: Root;
let latest: SocialMedia[];
const changed = vi.fn();
function Editor({
  platform = "instagram",
  initial = [],
  disabled = false,
}: {
  platform?: "instagram" | "facebook";
  initial?: SocialMedia[];
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  latest = value;
  return createElement(MetaPublishingFields, {
    platform,
    value,
    disabled,
    onChange: (media) => {
      changed(media);
      setValue(media);
    },
  });
}
const button = (name: string) =>
  [...element.querySelectorAll("button")].find((item) => item.textContent === name)!;
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  changed.mockClear();
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

it("preserves image order and untouched alternative text while adding, editing and removing a carousel item", async () => {
  await act(async () =>
    root.render(
      createElement(Editor, {
        initial: [
          { kind: "image", url: "https://cdn.test/first.jpg", alt: "First description" },
          { kind: "image", url: "https://cdn.test/second.jpg", alt: "Second description" },
        ],
      }),
    ),
  );
  await fill(
    element.querySelectorAll<HTMLInputElement>('input[type="url"]')[1],
    "https://cdn.test/changed.jpg",
  );
  expect(latest).toEqual([
    { kind: "image", url: "https://cdn.test/first.jpg", alt: "First description" },
    { kind: "image", url: "https://cdn.test/changed.jpg", alt: "Second description" },
  ]);
  await act(async () => button("Add video URL").click());
  await fill(
    element.querySelectorAll<HTMLInputElement>('input[type="url"]')[2],
    "https://cdn.test/clip.mp4",
  );
  expect(latest[2]).toEqual({ kind: "video", url: "https://cdn.test/clip.mp4" });
  await act(async () => button("Remove media 2").click());
  expect(latest).toEqual([
    { kind: "image", url: "https://cdn.test/first.jpg", alt: "First description" },
    { kind: "video", url: "https://cdn.test/clip.mp4" },
  ]);
  expect(element.querySelectorAll('input[type="file"]')).toHaveLength(0);
});

it("announces the single Reel Feed placement, then removes that announcement for mixed carousel content", async () => {
  await act(async () =>
    root.render(
      createElement(Editor, { initial: [{ kind: "video", url: "https://cdn.test/reel.mp4" }] }),
    ),
  );
  expect(element.querySelector('[role="status"]')?.textContent).toBe(
    "This video will publish as a Reel and appear in the feed.",
  );
  expect(element.querySelectorAll('input:not([type="url"])')).toHaveLength(0);
  await act(async () => button("Add image URL").click());
  expect(element.querySelector('[role="status"]')).toBeNull();
  const alt = element.querySelector<HTMLInputElement>('input:not([type="url"])')!;
  expect(alt.maxLength).toBe(1000);
  await fill(alt, "Carousel image description");
  expect(latest[1].alt).toBe("Carousel image description");
  await fill(alt, "");
  expect(latest[1].alt).toBeUndefined();
});

it("keeps Facebook image-only and enforces the four-item composer bound without changing existing media", async () => {
  const initial = Array.from({ length: 4 }, (_, index): SocialMedia => ({
    kind: "image",
    url: `https://cdn.test/${index}.jpg`,
  }));
  await act(async () => root.render(createElement(Editor, { platform: "facebook", initial })));
  expect(button("Add image URL").disabled).toBe(true);
  expect(button("Add video URL")).toBeUndefined();
  expect(latest).toEqual(initial);
  await act(async () => button("Remove media 1").click());
  expect(button("Add image URL").disabled).toBe(false);
  expect(latest.map((item) => item.url)).toEqual(initial.slice(1).map((item) => item.url));
});

it("retains all fields under the disabled form boundary", async () => {
  const initial: SocialMedia[] = [
    { kind: "image", url: "https://cdn.test/keep.jpg", alt: "Keep this" },
  ];
  await act(async () => root.render(createElement(Editor, { initial, disabled: true })));
  expect(element.querySelector("fieldset")?.disabled).toBe(true);
  expect(element.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe(initial[0].url);
  expect(changed).not.toHaveBeenCalled();
});
