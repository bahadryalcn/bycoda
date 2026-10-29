// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCitedTurnHistory } from "./useCitedTurnHistory";
import type { Block } from "../model/session";

let root: Root;
let container: HTMLDivElement;
let mounted: boolean;
let props: Parameters<typeof useCitedTurnHistory>[0];
const block = (id: string) => ({ id, role: "user", text: id }) as Block;

function Harness() {
  useCitedTurnHistory(props);
  return null;
}
async function render(update: Partial<typeof props> = {}) {
  props = { ...props, ...update };
  await act(async () => {
    root.render(createElement(Harness));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  props = {
    visible: true,
    jump: { blockId: "older-turn", token: 1 },
    blocks: [block("tail")],
    hasMore: true,
    loading: false,
    load: vi.fn(async () => 0),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mounted = true;
});
afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("demands bounded older pages for an explicit citation until its anchor arrives", async () => {
  await render();
  expect(props.load).toHaveBeenCalledTimes(1);
  await render({ blocks: [block("middle"), block("tail")] });
  expect(props.load).toHaveBeenCalledTimes(2);
  await render({
    blocks: [block("older-turn"), block("middle"), block("tail")],
  });
  expect(props.load).toHaveBeenCalledTimes(2);
});

it("does not request history for ordinary hidden, complete, loading or failed views", async () => {
  for (const update of [
    { jump: null },
    { visible: false },
    { hasMore: false },
    { loading: true },
    { error: "Read failed" },
  ]) {
    await render({
      visible: true,
      jump: { blockId: "older-turn", token: 1 },
      hasMore: true,
      loading: false,
      error: undefined,
      ...update,
    });
  }
  expect(props.load).not.toHaveBeenCalled();
});

it("does not loop after failure or a page with no progress; a new citation can retry", async () => {
  props.load = vi.fn(async () => {
    throw new Error("disconnected");
  });
  await render();
  await render({ blocks: [...props.blocks], load: props.load });
  await render({ loading: true });
  await render({ loading: false });
  expect(props.load).toHaveBeenCalledTimes(1);
  await render({ jump: { blockId: "older-turn", token: 2 } });
  expect(props.load).toHaveBeenCalledTimes(2);
});

it("cancels a scheduled demand when its transcript unmounts before the request starts", async () => {
  act(() => root.render(createElement(Harness)));
  act(() => root.unmount());
  mounted = false;
  await act(async () => {
    await Promise.resolve();
  });
  expect(props.load).not.toHaveBeenCalled();
});

it("retains one valid demand after development StrictMode effect replacement", async () => {
  await act(async () => { root.render(createElement(StrictMode, null, createElement(Harness))); });
  expect(props.load).toHaveBeenCalledTimes(1);
});
