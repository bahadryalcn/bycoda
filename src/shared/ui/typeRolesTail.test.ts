// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FieldLabel } from "./Field";
import { Heading } from "./Heading";
import { OutputBlock } from "./OutputBlock";
import { SearchInput } from "./SearchInput";
import { SectionLabel } from "./SectionLabel";
import { Text, textAttributes } from "./Text";
import { TextareaField } from "./TextareaField";
import { TextField } from "./TextField";

async function render(node: ReturnType<typeof createElement>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    container,
    done: () => {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

it("Text renders b and mark, sets tracking, and takes a ref to a div", async () => {
  const ref = createRef<HTMLDivElement>();
  const view = await render(
    createElement(
      "div",
      null,
      createElement(Text, { as: "b", tracking: "wide" }, "7"),
      createElement(Text, { as: "mark" }, "hit"),
      createElement(Text, { as: "div", ref }, "block"),
      createElement(Text, null, "plain"),
    ),
  );
  const [b, mark, block, plain] = Array.from(view.container.firstElementChild!.children);
  expect(b!.tagName).toBe("B");
  expect((b as HTMLElement).dataset.tracking).toBe("wide");
  expect(mark!.tagName).toBe("MARK");
  expect(ref.current).toBe(block);
  expect((plain as HTMLElement).dataset.tracking).toBeUndefined();
  expect(textAttributes({})["data-tracking"]).toBeUndefined();
  view.done();
});

it("Heading clamps lines and takes a tone, and renders as before without them", async () => {
  const view = await render(
    createElement(
      "div",
      null,
      createElement(Heading, { lines: 2, tone: "danger" }, "A"),
      createElement(Heading, null, "B"),
    ),
  );
  const [clamped, plain] = Array.from(view.container.firstElementChild!.children) as HTMLElement[];
  expect(clamped!.dataset.lines).toBe("2");
  expect(clamped!.style.getPropertyValue("--clamp-lines")).toBe("2");
  expect(clamped!.dataset.tone).toBe("danger");
  expect(plain!.dataset).toMatchObject({ size: "section" });
  expect(plain!.dataset.lines).toBeUndefined();
  expect(plain!.dataset.tone).toBeUndefined();
  expect(plain!.getAttribute("style")).toBeNull();
  expect(plain!.className.split(" ")).toHaveLength(1);
  view.done();
});

it("OutputBlock takes wrap false and the body and inherit sizes", async () => {
  const view = await render(
    createElement(
      "div",
      null,
      createElement(OutputBlock, { wrap: false, size: "body" }, "a"),
      createElement(OutputBlock, { size: "inherit" }, "b"),
      createElement(OutputBlock, null, "c"),
    ),
  );
  const [nowrap, inherit, plain] = Array.from(
    view.container.firstElementChild!.children,
  ) as HTMLElement[];
  expect(nowrap!.dataset).toMatchObject({ wrap: "false", size: "body" });
  expect(inherit!.dataset).toMatchObject({ size: "inherit", leading: "inherit" });
  expect(plain!.dataset.wrap).toBeUndefined();
  expect(plain!.dataset.size).toBe("caption");
  view.done();
});

it("TextField, TextareaField and SearchInput take textSize and leading on the typed text", async () => {
  const view = await render(
    createElement(
      "div",
      null,
      createElement(TextField, { label: "A", textSize: "secondary", leading: "tight" }),
      createElement(TextareaField, { label: "B", textSize: "body" }),
      createElement(SearchInput, { "aria-label": "C", textSize: "micro" }),
      createElement(TextField, { label: "D" }),
    ),
  );
  const field = view.container.querySelectorAll("input")[0]!;
  expect(field.dataset).toMatchObject({ size: "secondary", leading: "tight" });
  expect(view.container.querySelector("textarea")!.dataset.size).toBe("body");
  expect(view.container.querySelectorAll("input")[1]!.dataset.size).toBe("micro");
  const plain = view.container.querySelectorAll("input")[2]!;
  expect(plain.dataset.size).toBeUndefined();
  expect(plain.dataset.leading).toBeUndefined();
  view.done();
});

it("FieldLabel sets size and tone only when asked", async () => {
  const view = await render(
    createElement(
      "div",
      null,
      createElement(FieldLabel, { htmlFor: "x", size: "secondary", tone: "muted" }, "A"),
      createElement(FieldLabel, { htmlFor: "y", className: "mine" }, "B"),
    ),
  );
  const [styled, plain] = Array.from(view.container.firstElementChild!.children) as HTMLElement[];
  expect(styled!.dataset).toMatchObject({ size: "secondary", tone: "muted" });
  expect(plain!.className).toBe("mine");
  expect(plain!.dataset.size).toBeUndefined();
  view.done();
});

it("SectionLabel truncates the inline and menu variants on request", async () => {
  const view = await render(
    createElement(
      "div",
      null,
      createElement(SectionLabel, { variant: "inline", truncate: true, children: "A" }),
      createElement(SectionLabel, { variant: "inline", children: "B" }),
      createElement(SectionLabel, { variant: "menu", truncate: true, children: "C" }),
    ),
  );
  const [inline, plain, menu] = Array.from(
    view.container.firstElementChild!.children,
  ) as HTMLElement[];
  expect(inline!.dataset.truncate).toBe("true");
  expect(plain!.dataset.truncate).toBeUndefined();
  expect(menu!.dataset.truncate).toBe("true");
  view.done();
});
