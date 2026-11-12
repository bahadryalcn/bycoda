// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Disclosure, type DisclosureProps } from "./Disclosure";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = "";
});

async function mount(props: Partial<DisclosureProps> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (next: Partial<DisclosureProps>) =>
    act(async () =>
      root.render(createElement(Disclosure, { summary: "More", children: "Body", ...next })),
    );
  await render(props);
  cleanup = () => act(async () => root.unmount());
  const details = () => host.querySelector("details") as HTMLDetailsElement;
  return { host, render, details };
}

const toggle = (el: HTMLDetailsElement, open: boolean) =>
  act(async () => {
    el.open = open;
    el.dispatchEvent(new Event("toggle"));
  });

it("hides the browser marker through the module class and keeps the body mounted", async () => {
  const { details } = await mount();
  expect(details().querySelector("summary")?.className).toContain("summary");
  expect(details().textContent).toContain("Body");
  const css = readFileSync(join(__dirname, "Disclosure.module.css"), "utf8");
  expect(css).toContain("list-style: none");
  expect(css).toContain("::-webkit-details-marker");
});

it("starts open from defaultOpen when uncontrolled", async () => {
  const { details } = await mount({ defaultOpen: true });
  expect(details().open).toBe(true);
  expect(details().dataset.variant).toBe("plain");
  expect(details().dataset.size).toBe("md");
});

it("follows a controlled open prop and reports native toggles", async () => {
  const onOpenChange = vi.fn();
  const { details, render } = await mount({ open: false, onOpenChange });
  expect(details().open).toBe(false);
  await render({ open: true, onOpenChange });
  expect(details().open).toBe(true);
  await toggle(details(), false);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("keeps native activation for buttons and links in the actions slot and cancels the rest", async () => {
  const onAction = vi.fn();
  const { host, details } = await mount({
    summaryActions: createElement(
      "span",
      { "data-testid": "slot" },
      createElement("button", { type: "button", onClick: onAction }, "Add"),
      createElement("a", { href: "#x" }, "Docs"),
      createElement("em", null, "text"),
    ),
  });
  const click = async (selector: string) => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      host.querySelector(selector)!.dispatchEvent(event);
    });
    return event;
  };
  expect((await click("button")).defaultPrevented).toBe(false);
  expect(onAction).toHaveBeenCalledTimes(1);
  expect((await click("a")).defaultPrevented).toBe(false);
  expect((await click("em")).defaultPrevented).toBe(true);
  expect(details().open).toBe(false);
});

it("stops action clicks from reaching ancestors", async () => {
  const onParent = vi.fn();
  const { host } = await mount({
    summaryActions: createElement("button", { type: "button" }, "Add"),
  });
  document.body.addEventListener("click", onParent);
  await act(async () => {
    host.querySelector("button")!.click();
  });
  expect(onParent).not.toHaveBeenCalled();
});

it("snaps back when a controlled parent ignores the toggle and opens when it accepts", async () => {
  const onOpenChange = vi.fn();
  const { details, render } = await mount({ open: false, onOpenChange });
  await toggle(details(), true);
  expect(onOpenChange).toHaveBeenCalledWith(true);
  expect(details().open).toBe(false);
  await render({ open: true, onOpenChange });
  expect(details().open).toBe(true);
  await toggle(details(), false);
  expect(details().open).toBe(true);
  await render({ open: false, onOpenChange });
  expect(details().open).toBe(false);
});

it("does not mirror the chevron the wrong way when open in RTL", () => {
  const css = readFileSync(join(__dirname, "Disclosure.module.css"), "utf8");
  expect(css).not.toContain("rotate(-90deg)");
});

it("renders the count with an accessible label", async () => {
  const { details } = await mount({ count: 3, countLabel: "3 items" });
  expect(details().textContent).toContain("3");
  expect(details().querySelector('[data-variant="count"]')?.getAttribute("aria-label")).toBe(
    "3 items",
  );
});
