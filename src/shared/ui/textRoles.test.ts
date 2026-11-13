// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Code } from "./Code";
import { DiffStat } from "./DiffStat";
import { LiveText } from "./LiveText";
import { MiddleTruncate } from "./MiddleTruncate";
import { OutputBlock } from "./OutputBlock";
import { Text, optionalTextAttributes, textAttributes } from "./Text";
import { Timestamp } from "./Timestamp";

async function render(node: ReturnType<typeof createElement>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    container,
    element: container.firstElementChild as HTMLElement | null,
    done: () => {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

it("Text keeps the container line height with leading inherit and renders list, label and diff roles", async () => {
  const item = await render(
    createElement(Text, { as: "li", leading: "inherit", tone: "added" }, "A"),
  );
  expect(item.element?.tagName).toBe("LI");
  expect(item.element?.dataset).toMatchObject({ leading: "inherit", tone: "added" });
  item.done();
  const label = await render(createElement(Text, { as: "label", htmlFor: "name" }, "Name"));
  expect(label.element?.tagName).toBe("LABEL");
  expect(label.element?.getAttribute("for")).toBe("name");
  label.done();
});

it("textAttributes inherits every unset role and optionalTextAttributes adds nothing without one", () => {
  expect(textAttributes({})).toMatchObject({
    "data-size": "inherit",
    "data-tone": "inherit",
    "data-leading": "inherit",
  });
  // A set size brings its own line height, so no leading is written.
  expect(textAttributes({ size: "micro" })["data-leading"]).toBeUndefined();
  expect(optionalTextAttributes({}, "placed")).toEqual({ className: "placed" });
  expect(optionalTextAttributes({ tone: "muted" }, "placed")).toMatchObject({
    "data-tone": "muted",
  });
});

it("Code is monospaced code that inherits its type unless a role is set", async () => {
  const plain = await render(createElement(Code, null, "--force"));
  expect(plain.element?.tagName).toBe("CODE");
  expect(plain.element?.dataset).toMatchObject({
    variant: "plain",
    size: "inherit",
    tone: "inherit",
  });
  plain.done();
  const chip = await render(createElement(Code, { variant: "chip", size: "micro" }, "pnpm"));
  expect(chip.element?.dataset).toMatchObject({ variant: "chip", size: "micro" });
  chip.done();
});

it("OutputBlock is a wrapping pre with caption type, mono face and no frame by default", async () => {
  const { element, done } = await render(createElement(OutputBlock, null, "line 1\nline 2"));
  expect(element?.tagName).toBe("PRE");
  expect(element?.dataset).toMatchObject({
    size: "caption",
    tone: "secondary",
    face: "mono",
    density: "compact",
    frame: "none",
  });
  expect(element?.dataset.scroll).toBeUndefined();
  expect(element?.textContent).toBe("line 1\nline 2");
  done();
});

it("DiffStat leaves out a zero side, renders nothing for an empty change and groups digits", async () => {
  const both = await render(createElement(DiffStat, { additions: 1200, deletions: 3 }));
  expect(both.element?.querySelector('[data-side="added"]')?.textContent).toBe("+1,200");
  expect(both.element?.querySelector('[data-side="removed"]')?.textContent).toBe("−3");
  both.done();
  const added = await render(createElement(DiffStat, { additions: 4, deletions: 0 }));
  expect(added.element?.querySelector('[data-side="removed"]')).toBeNull();
  added.done();
  const none = await render(createElement(DiffStat, { additions: 0, deletions: 0 }));
  expect(none.element).toBeNull();
  none.done();
  const zero = await render(
    createElement(DiffStat, { additions: 0, deletions: 0, showZero: true }),
  );
  expect(zero.element?.textContent).toBe("+0−0");
  zero.done();
});

it("components that render their own text take size and tone and are unchanged without them", async () => {
  const bare = await render(createElement(LiveText, { text: "Saved", className: "placed" }));
  expect(bare.element?.className).toBe("placed");
  expect(bare.element?.dataset.tone).toBeUndefined();
  bare.done();
  const live = await render(createElement(LiveText, { text: "Saved", tone: "muted" }));
  expect(live.element?.dataset).toMatchObject({ tone: "muted", size: "inherit" });
  live.done();
  const path = await render(
    createElement(MiddleTruncate, {
      size: "micro",
      tone: "secondary",
      children: "src/app/App.tsx",
    }),
  );
  expect(path.container.querySelector('[data-size="micro"][data-tone="secondary"]')).not.toBeNull();
  path.done();
  const time = await render(createElement(Timestamp, { value: 1_700_000_000_000, tone: "muted" }));
  const stamp = time.container.querySelector("time");
  expect(stamp?.dataset.tone).toBe("muted");
  expect(stamp?.className).toContain("tabular-nums");
  time.done();
});

it("Text renders semantic containers with inherited type roles", async () => {
  for (const as of ["section", "ul", "ol", "header", "footer", "nav", "aside", "main"] as const) {
    const view = await render(createElement(Text, { as, tone: "inherit" }, "Content"));
    expect(view.element?.tagName).toBe(as.toUpperCase());
    expect(view.element?.dataset.tone).toBe("inherit");
    view.done();
  }
});

it("OutputBlock exposes inherited and relaxed leading", async () => {
  for (const leading of ["inherit", "relaxed"] as const) {
    const view = await render(createElement(OutputBlock, { leading }, "output"));
    expect(view.element?.dataset.leading).toBe(leading);
    view.done();
  }
});

it("exposes glyph ink and title-only hover underline roles", () => {
  const attrs = textAttributes({ size: "glyph", tone: "background-base", hoverUnderline: true });
  expect(attrs).toMatchObject({
    "data-size": "glyph",
    "data-tone": "background-base",
    "data-hover-underline": true,
  });
});
