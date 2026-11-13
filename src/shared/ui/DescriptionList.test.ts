// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DescriptionItem, DescriptionList } from "./DescriptionList";
import { surfaceAttributes } from "./Surface";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (props: Parameters<typeof DescriptionList>[0]) =>
  act(async () => root.render(createElement(DescriptionList, props)));

it("renders dl with grouped dt/dd pairs", async () => {
  await render({
    children: [
      createElement(DescriptionItem, { key: "a", term: "Source" }, "main"),
      createElement(DescriptionItem, { key: "b", term: "Target", monospace: true }, "abc123"),
    ],
  });
  const dl = host.querySelector("dl");
  expect(dl).not.toBeNull();
  expect(dl!.querySelectorAll(":scope > div")).toHaveLength(2);
  const first = dl!.querySelector("div")!;
  expect(first.querySelector("dt")?.textContent).toBe("Source");
  expect(first.querySelector("dd")?.textContent).toBe("main");
  expect(dl!.querySelectorAll("dd")[1].className).toContain("mono");
});

it("forwards semantic and shared surface attributes to its list", async () => {
  await render({
    ...surfaceAttributes({ frame: "stroke" }),
    "aria-label": "Usage",
    children: null,
  });
  const list = host.querySelector("dl")!;
  expect(list.getAttribute("aria-label")).toBe("Usage");
  expect(list.getAttribute("data-surface-frame")).toBe("stroke");
});

it("exposes the column mode and size", async () => {
  await render({ columns: 2, size: "sm", children: null });
  const dl = host.querySelector("dl")!;
  expect(dl.getAttribute("data-columns")).toBe("2");
  expect(dl.className).toContain("cols2");
  expect(dl.className).toContain("sm");
  await render({ columns: "auto", children: null });
  expect(host.querySelector("dl")!.getAttribute("data-columns")).toBe("auto");
  expect(host.querySelector("dl")!.className).toContain("auto");
});

it("truncates the value on a single line", async () => {
  await render({
    children: createElement(DescriptionItem, { term: "Path", truncate: true }, "/a/very/long/path"),
  });
  const dd = host.querySelector("dd")!;
  expect(dd.className).toContain("truncate");
  expect(dd.textContent).toBe("/a/very/long/path");
});

it("offers the overflow tooltip only for string values or an explicit tooltip", async () => {
  await render({
    children: [
      createElement(DescriptionItem, { key: "a", term: "A", truncate: true }, "long text"),
      createElement(
        DescriptionItem,
        { key: "b", term: "B", truncate: true },
        createElement("code", null, "rich"),
      ),
      createElement(
        DescriptionItem,
        { key: "c", term: "C", truncate: true, tooltip: "Full value" },
        createElement("code", null, "rich"),
      ),
    ],
  });
  const owners = [...host.querySelectorAll("dd")].map((dd) =>
    dd.hasAttribute("data-tooltip-owner"),
  );
  expect(owners).toEqual([true, false, true]);
  expect(host.querySelectorAll("dd")[1].className).toContain("truncate");
});

it("separates two-column pairs without an invalid column-gap", () => {
  const css = readFileSync(join(__dirname, "DescriptionList.module.css"), "utf8");
  expect(css).not.toMatch(/column-gap:\s*calc\([^)]*\)\s+var/);
  expect(css).toContain(".cols2 .item:nth-child(even) > .term");
});

it("hides terms visually and leads a pair with an icon", async () => {
  await render({
    hideTerms: true,
    children: createElement(
      DescriptionItem,
      { term: "Model", icon: createElement("svg", { "data-icon": "" }) },
      createElement("span", null, "gpt"),
    ),
  });
  const dl = host.querySelector("dl")!;
  expect(dl.getAttribute("data-hide-terms")).toBe("true");
  expect(dl.querySelector("dt")?.textContent).toBe("Model");
  const dd = dl.querySelector("dd")!;
  expect(dd.className).toContain("withIcon");
  expect(dd.firstElementChild?.hasAttribute("data-icon")).toBe(true);
  expect(dd.textContent).toBe("gpt");
});
