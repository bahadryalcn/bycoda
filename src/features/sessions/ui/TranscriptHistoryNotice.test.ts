// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TranscriptHistoryNotice } from "./TranscriptHistoryNotice";

let root: ReturnType<typeof createRoot>;
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

const show = (props: Partial<Parameters<typeof TranscriptHistoryNotice>[0]>) =>
  act(async () =>
    root.render(
      createElement(TranscriptHistoryNotice, {
        initial: false,
        loading: false,
        loadFailed: false,
        ...props,
      }),
    ),
  );
const retry = () =>
  [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry");

it("names the first read as the conversation and a later read as earlier messages", async () => {
  await show({ initial: true, loading: true });
  expect(host.textContent).toContain("Loading conversation…");
  await show({ initial: false, loading: true });
  expect(host.textContent).toContain("Loading earlier messages…");
});

it("tells a failed first load from a failed earlier read, and retries only the read", async () => {
  const onRetryLoad = vi.fn();
  await show({ initial: true, loadFailed: true, onRetryLoad });
  expect(host.textContent).toContain("This conversation could not be loaded.");
  act(() => retry()!.click());
  expect(onRetryLoad).toHaveBeenCalledOnce();
  await show({ initial: false, loadFailed: true, onRetryLoad });
  expect(host.textContent).toContain("Earlier messages could not be loaded.");
});

it("shows one state at a time: a failed read beats a page error, and neither sits beside the spinner", async () => {
  const onRetryPage = vi.fn();
  await show({ loading: true, loadFailed: true, pageError: "Page unavailable", onRetryPage });
  expect(host.textContent).toContain("Earlier messages could not be loaded.");
  expect(host.textContent).not.toContain("Page unavailable");
  expect(host.textContent).not.toContain("Loading");
  await show({ loading: true, pageError: "Page unavailable", onRetryPage });
  expect(host.textContent).toContain("Page unavailable");
  expect(host.textContent).not.toContain("Loading");
  act(() => retry()!.click());
  expect(onRetryPage).toHaveBeenCalledOnce();
});

it("offers no Retry when nothing can retry, and renders nothing when all is well", async () => {
  await show({ loadFailed: true });
  expect(retry()).toBeUndefined();
  await show({});
  expect(host.textContent).toBe("");
});
