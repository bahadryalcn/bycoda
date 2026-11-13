// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContinuousList, CollectionFooter } from "./ContinuousList";
import { resetRetainedState } from "../hooks/useRetainedState";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetRetainedState();
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-index") ? 64 : 480;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const items = Array.from({ length: 1000 }, (_, index) => String(index));
const props = {
  items,
  itemKey: (item: string) => item,
  renderItem: (item: string) => createElement("button", null, `Row ${item}`),
  stateKey: "test:scope",
};

it("keeps settings row dividers attached to current logical order after filtering", async () => {
  const options = { ...props, items: ["one", "two", "three"], rowAppearance: "settings" as const };
  await act(async () => root.render(createElement(ContinuousList<string>, options)));
  expect(
    container.querySelector('[data-collection-key="one"]')?.getAttribute("data-row-appearance"),
  ).toBe("settings");
  expect(
    container.querySelector('[data-collection-key="one"]')?.hasAttribute("data-row-divider"),
  ).toBe(false);
  expect(
    container.querySelector('[data-collection-key="two"]')?.hasAttribute("data-row-divider"),
  ).toBe(true);
  await act(async () =>
    root.render(createElement(ContinuousList<string>, { ...options, items: ["two", "three"] })),
  );
  expect(
    container.querySelector('[data-collection-key="two"]')?.hasAttribute("data-row-divider"),
  ).toBe(false);
  expect(
    container.querySelector('[data-collection-key="three"]')?.hasAttribute("data-row-divider"),
  ).toBe(true);
  await act(async () =>
    root.render(createElement(ContinuousList<string>, { ...options, rowAppearance: undefined })),
  );
  expect(container.querySelector("[data-row-appearance]")).toBeNull();
  expect(container.querySelector("[data-row-divider]")).toBeNull();
});

it("requests the next page only near the end and pauses automatic retries on error", async () => {
  const onLoadMore = vi.fn();
  const options = { ...props, items: ["one"], hasMore: true, loadOnScroll: true, onLoadMore };
  await act(async () => root.render(createElement(ContinuousList<string>, options)));
  const scroller = container.querySelector<HTMLElement>("[data-continuous-list]")!;
  Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
  scroller.scrollTop = 0;
  await act(async () => scroller.dispatchEvent(new Event("scroll")));
  expect(onLoadMore).not.toHaveBeenCalled();
  scroller.scrollTop = 500;
  await act(async () => scroller.dispatchEvent(new Event("scroll")));
  expect(onLoadMore).toHaveBeenCalledOnce();
  await act(async () =>
    root.render(
      createElement(ContinuousList<string>, { ...options, error: "Offline", onRetry: onLoadMore }),
    ),
  );
  await act(async () => scroller.dispatchEvent(new Event("scroll")));
  expect(onLoadMore).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Offline");
});

it("bounds mounted rows and retains a selected offscreen record", async () => {
  await act(async () =>
    root.render(createElement(ContinuousList<string>, { ...props, requiredKey: "999" })),
  );
  expect(container.querySelectorAll("[data-collection-key]").length).toBeGreaterThan(1);
  expect(container.querySelectorAll("[data-collection-key]").length).toBeLessThan(64);
  expect(container.querySelector('[data-collection-key="999"]')).not.toBeNull();
  expect(container.querySelector('[data-collection-key="500"]')).toBeNull();
});

it("keeps focused record mounted when selection changes", async () => {
  await act(async () =>
    root.render(createElement(ContinuousList<string>, { ...props, requiredKey: "999" })),
  );
  const focused = container.querySelector<HTMLButtonElement>('[data-collection-key="999"] button')!;
  await act(async () => focused.focus());
  await act(async () =>
    root.render(createElement(ContinuousList<string>, { ...props, requiredKey: "998" })),
  );
  expect(document.activeElement).toBe(focused);
  expect(container.querySelector('[data-collection-key="999"]')).not.toBeNull();
});

it("moves the finite window through the full loaded collection on scroll", async () => {
  await act(async () => root.render(createElement(ContinuousList<string>, props)));
  const scroller = container.querySelector<HTMLElement>("[data-continuous-list]")!;
  await act(async () => {
    scroller.scrollTop = 32000;
    scroller.dispatchEvent(new Event("scroll"));
  });
  expect(container.querySelector('[data-collection-key="500"]')).not.toBeNull();
  expect(container.querySelector('[data-collection-key="0"]')).toBeNull();
  expect(container.querySelectorAll("[data-collection-key]").length).toBeLessThan(64);
});

it("preserves scroll across appends and restores each query scope", async () => {
  const render = (stateKey: string, count: number) =>
    act(async () =>
      root.render(
        createElement(ContinuousList<string>, { ...props, stateKey, items: items.slice(0, count) }),
      ),
    );
  await render("query:a", 30);
  const scroller = container.querySelector<HTMLElement>("[data-continuous-list]")!;
  scroller.scrollTop = 240;
  scroller.dispatchEvent(new Event("scroll"));
  await render("query:a", 40);
  expect(scroller.scrollTop).toBe(240);
  await render("query:b", 30);
  expect(container.querySelector<HTMLElement>("[data-continuous-list]")!.scrollTop).toBe(0);
  await render("query:a", 40);
  expect(container.querySelector<HTMLElement>("[data-continuous-list]")!.scrollTop).toBe(240);
});

it("shows continuation failures and partial coverage after retained records; loads only on click", async () => {
  const load = vi.fn();
  await act(async () =>
    root.render(
      createElement(ContinuousList<string>, {
        ...props,
        items: ["one"],
        hasMore: true,
        onLoadMore: load,
        error: "Continuation failed",
        partial: "Some records unavailable",
      }),
    ),
  );
  expect(container.textContent).toContain("Row one");
  expect(container.textContent).toContain("Continuation failed");
  expect(container.textContent).toContain("Some records unavailable");
  expect(load).not.toHaveBeenCalled();
  const button = [...container.querySelectorAll("button")].find((entry) =>
    entry.textContent?.includes("Load more"),
  )!;
  await act(async () => button.click());
  expect(load).toHaveBeenCalledOnce();
  await act(async () =>
    root.render(
      createElement(CollectionFooter, { loading: true, hasMore: true, onLoadMore: load }),
    ),
  );
  expect(container.querySelector("button")!.getAttribute("aria-disabled")).toBe("true");
  await act(async () => container.querySelector("button")!.click());
  expect(load).toHaveBeenCalledOnce();
});

it("keeps a standalone continuation button in its owner's layout", async () => {
  const load = vi.fn();
  await act(async () =>
    root.render(
      createElement(CollectionFooter, {
        standalone: true,
        hasMore: true,
        onLoadMore: load,
        loadMoreLabel: "Load older work",
        loadMoreButtonProps: { disabled: true },
      }),
    ),
  );
  const button = container.querySelector("button")!;
  expect(container.firstElementChild).toBe(button);
  expect(button.textContent).toBe("Load older work");
  await act(async () => button.click());
  expect(load).not.toHaveBeenCalled();
});

it("distinguishes loading, empty and failed initial reads", async () => {
  await act(async () =>
    root.render(createElement(ContinuousList<string>, { ...props, items: [], loading: true })),
  );
  expect(container.textContent).not.toContain("No records");
  expect(container.querySelector('[aria-label="Loading…"]')).not.toBeNull();
  await act(async () =>
    root.render(
      createElement(ContinuousList<string>, { ...props, items: [], error: "Read failed" }),
    ),
  );
  expect(container.textContent).toContain("Read failed");
  expect(container.textContent).not.toContain("No records");
  await act(async () =>
    root.render(createElement(ContinuousList<string>, { ...props, items: [] })),
  );
  expect(container.textContent).toContain("No records");
});
