// @vitest-environment happy-dom
import { act, createElement, Fragment, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { InlineVisual } from "../model/inlineVisual";
import { useInlineVisualSource } from "./useInlineVisualSource";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const hexId = (n: number) => n.toString(16).padStart(64, "0");
const reference = (n: number, title = `Visual ${n}`): InlineVisual => ({
  version: 2,
  id: hexId(n),
  title,
  height: 200,
});
const storedText = (title: string) =>
  JSON.stringify({ version: 1, title, html: `<p>${title}</p>`, height: 200 });

function Probe({ value }: { value: InlineVisual }) {
  const state = useInlineVisualSource(value);
  return createElement(
    "button",
    {
      "data-state": state.state,
      onClick: state.state === "error" ? state.retry : undefined,
    },
    state.state,
  );
}

async function mount(element: ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return {
    host,
    root,
    states: () => Array.from(host.querySelectorAll("button")).map((b) => b.dataset.state),
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it("shares one native read between concurrent mounts of the same visual", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolveRead!: (text: string) => void;
  invoke.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        resolveRead = resolve;
      }),
  );
  const value = reference(0xa1, "Chart");
  const view = await mount(
    createElement(
      Fragment,
      null,
      createElement(Probe, { value }),
      createElement(Probe, { value }),
    ),
  );
  try {
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(view.states()).toEqual(["loading", "loading"]);
    await act(async () => resolveRead(storedText("Chart")));
    expect(view.states()).toEqual(["ready", "ready"]);
    expect(invoke).toHaveBeenCalledTimes(1);
  } finally {
    await view.cleanup();
    invoke.mockReset();
    vi.unstubAllGlobals();
  }
});

it("does not cache failed reads: a retry reads again after a rejection and after invalid JSON", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke
    .mockRejectedValueOnce(new Error("Visual is not stored on this machine"))
    .mockResolvedValueOnce("{")
    .mockResolvedValueOnce(storedText("Recovered"));
  const value = reference(0xb2, "Recovered");
  const view = await mount(createElement(Probe, { value }));
  try {
    expect(view.states()).toEqual(["error"]);
    const button = view.host.querySelector("button")!;
    await act(async () => button.click());
    expect(view.states()).toEqual(["error"]);
    await act(async () => view.host.querySelector("button")!.click());
    expect(view.states()).toEqual(["ready"]);
    expect(invoke).toHaveBeenCalledTimes(3);
  } finally {
    await view.cleanup();
    invoke.mockReset();
    vi.unstubAllGlobals();
  }
});

it("refreshes recency on a hit so a frequently shown visual survives newer reads", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke.mockImplementation(async (_command: string, args: { id: string }) =>
    storedText(`Stored ${args.id.slice(-4)}`),
  );
  const hot = reference(0x1000, "Hot");
  const view = await mount(createElement(Probe, { value: hot }));
  const show = async (value: InlineVisual) =>
    act(async () => view.root.render(createElement(Probe, { value })));
  try {
    // 23 more visuals fill the 24-entry cache; the hot visual is the oldest entry.
    for (let n = 1; n <= 23; n++) await show(reference(0x1000 + n));
    expect(invoke).toHaveBeenCalledTimes(24);

    // Showing the hot visual again is a hit: no native read, and it becomes the newest entry.
    await show(hot);
    expect(invoke).toHaveBeenCalledTimes(24);

    // One more new visual evicts the least recently used entry (1), not the hot one.
    await show(reference(0x1000 + 24));
    expect(invoke).toHaveBeenCalledTimes(25);
    await show(hot);
    expect(invoke).toHaveBeenCalledTimes(25);
    expect(view.states()).toEqual(["ready"]);

    // The evicted visual is read again, which proves the cache stayed bounded.
    await show(reference(0x1001));
    expect(invoke).toHaveBeenCalledTimes(26);
    expect(view.states()).toEqual(["ready"]);
  } finally {
    await view.cleanup();
    invoke.mockReset();
    vi.unstubAllGlobals();
  }
});
