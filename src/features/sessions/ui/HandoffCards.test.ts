// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SecondOpinionMeta } from "../model/session";

// Regression for #1015: the composer handoff card and the transcript
// second-opinion card must draw the same route, icon sizes and file count.
const buttonCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../../../shared/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/i18n")>()),
  useT: () => (key: string, values?: Record<string, string | number>) =>
    key.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? name)),
}));

vi.mock("./HarnessIcon", async () => {
  const { createElement } = await import("react");
  return {
    HarnessIcon: (props: { harness: string; className?: string }) =>
      createElement("i", { "data-harness-icon": props.harness, className: props.className }),
  };
});

vi.mock("../../../shared/ui/icons", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<typeof import("../../../shared/ui/icons")>()),
    ChevronRight: (props: { className?: string }) =>
      createElement("i", { "data-chevron": "", className: props.className }),
  };
});

vi.mock("../../../shared/ui/Button", async () => {
  const { createElement } = await import("react");
  return {
    Button: (props: Record<string, unknown> & { children?: unknown }) => {
      buttonCalls.push(props);
      return createElement(
        "button",
        { type: "button", "aria-label": props["aria-label"] as string },
        props.children as never,
      );
    },
  };
});

import { HandoffMiniCard } from "./HandoffMiniCard";
import { SecondOpinionCard } from "./SecondOpinionCard";

const handoff: SecondOpinionMeta = { from: "claude", to: "grok", kind: "handoff", files: 2 };

function parse(markup: string) {
  const node = document.createElement("div");
  node.innerHTML = markup;
  return node;
}

function iconClasses(markup: string) {
  const node = parse(markup);
  return {
    harness: [...node.querySelectorAll("[data-harness-icon]")].map((el) =>
      el.getAttribute("class"),
    ),
    chevron: [...node.querySelectorAll("[data-chevron]")].map((el) => el.getAttribute("class")),
  };
}

beforeEach(() => {
  buttonCalls.length = 0;
});

describe("handoff card parity (#1015)", () => {
  it("draws the same harness and chevron icon classes in both cards", () => {
    const mini = iconClasses(
      renderToStaticMarkup(createElement(HandoffMiniCard, { card: handoff })),
    );
    const second = iconClasses(
      renderToStaticMarkup(createElement(SecondOpinionCard, { card: handoff })),
    );

    expect(mini.harness).toHaveLength(2);
    expect(second.harness).toHaveLength(2);
    expect(mini.harness).toEqual(second.harness);
    expect(mini.chevron).toHaveLength(1);
    expect(second.chevron).toEqual(mini.chevron);
  });

  it.each([
    [1, "1 file"],
    [2, "2 files"],
  ])("shows %i changed file(s) as %s in both cards", (files, label) => {
    const card = { ...handoff, files };
    const mini = parse(renderToStaticMarkup(createElement(HandoffMiniCard, { card })));
    const second = parse(renderToStaticMarkup(createElement(SecondOpinionCard, { card })));

    expect(mini.textContent).toContain(label);
    expect(second.textContent).toContain(label);
  });

  it.each([undefined, 0])("omits the file count in both cards when files is %s", (files) => {
    const card = { ...handoff, files };
    const mini = parse(renderToStaticMarkup(createElement(HandoffMiniCard, { card })));
    const second = parse(renderToStaticMarkup(createElement(SecondOpinionCard, { card })));

    expect(mini.textContent).not.toMatch(/\bfiles?\b/);
    expect(second.textContent).not.toMatch(/\bfiles?\b/);
  });
});

describe("handoff mini card dismiss control", () => {
  it("keeps the dismiss action and its accessible name", () => {
    const onDismiss = vi.fn();
    renderToStaticMarkup(createElement(HandoffMiniCard, { card: handoff, onDismiss }));

    const dismiss = buttonCalls[buttonCalls.length - 1];
    expect(dismiss["aria-label"]).toBe("Remove handoff");
    (dismiss.onClick as () => void)();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not repeat the visible name as a tooltip on the dismiss control", () => {
    renderToStaticMarkup(
      createElement(HandoffMiniCard, { card: handoff, onDismiss: () => undefined }),
    );

    const dismiss = buttonCalls[buttonCalls.length - 1];
    expect(dismiss.tooltip ?? "").toBe("");
  });

  it("renders no dismiss control when the card cannot be removed", () => {
    renderToStaticMarkup(createElement(HandoffMiniCard, { card: handoff }));

    expect(buttonCalls).toHaveLength(0);
  });
});
