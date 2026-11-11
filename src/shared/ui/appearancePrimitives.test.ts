// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Motion } from "./Motion";
import { ScrollArea } from "./ScrollArea";
import { Text } from "./Text";

async function render(node: ReturnType<typeof createElement>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    element: container.firstElementChild as HTMLElement,
    done: () => {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

it("Text defaults to the caption size in the secondary ink and sets no weight or leading", async () => {
  const { element, done } = await render(createElement(Text, null, "Updated"));
  expect(element.tagName).toBe("SPAN");
  expect(element.dataset).toMatchObject({ size: "caption", tone: "secondary" });
  expect(element.dataset.weight).toBeUndefined();
  expect(element.dataset.leading).toBeUndefined();
  expect(element.dataset.truncate).toBeUndefined();
  done();
});

it("Text takes its element, role and placement class from props", async () => {
  const { element, done } = await render(
    createElement(
      Text,
      {
        as: "p",
        size: "body",
        tone: "danger",
        weight: "medium",
        leading: "relaxed",
        className: "mt-2",
        id: "note",
      },
      "Failed",
    ),
  );
  expect(element.tagName).toBe("P");
  expect(element.id).toBe("note");
  expect(element.dataset).toMatchObject({
    size: "body",
    tone: "danger",
    weight: "medium",
    leading: "relaxed",
  });
  expect(element.classList.contains("mt-2")).toBe(true);
  done();
});

it("Text marks a single truncated line only when asked", async () => {
  const { element, done } = await render(createElement(Text, { truncate: true }, "A long title"));
  expect(element.dataset.truncate).toBe("true");
  done();
});

it("ScrollArea scrolls vertically with the shared bar unless told otherwise", async () => {
  const plain = await render(createElement(ScrollArea, null, "rows"));
  expect(plain.element.dataset.axis).toBe("y");
  expect(plain.element.dataset.scrollbar).toBeUndefined();
  expect(plain.element.dataset.gutter).toBeUndefined();
  plain.done();
  const strip = await render(
    createElement(ScrollArea, { axis: "x", scrollbar: "hidden", gutter: "stable" }, "tabs"),
  );
  expect(strip.element.dataset).toMatchObject({ axis: "x", scrollbar: "hidden", gutter: "stable" });
  strip.done();
});

it("Motion eases transform fast by default and marks the mount animation only when asked", async () => {
  const plain = await render(createElement(Motion, null, "x"));
  expect(plain.element.tagName).toBe("DIV");
  expect(plain.element.dataset.transition).toBe("transform");
  expect(plain.element.dataset.duration).toBeUndefined();
  expect(plain.element.dataset.enter).toBeUndefined();
  plain.done();
  const notice = await render(
    createElement(
      Motion,
      { as: "span", transition: "opacity", duration: "standard", enter: "rise" },
      "x",
    ),
  );
  expect(notice.element.tagName).toBe("SPAN");
  expect(notice.element.dataset).toMatchObject({
    transition: "opacity",
    duration: "standard",
    enter: "rise",
  });
  notice.done();
});
