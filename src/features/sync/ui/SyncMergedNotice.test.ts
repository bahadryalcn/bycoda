// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYNC_MERGED_MESSAGE } from "../model/syncClient";
import { SyncMergedNotice } from "./SyncMergedNotice";

let fire: () => void = () => undefined;
vi.mock("../model/syncClient", () => ({
  SYNC_MERGED_MESSAGE: "merged",
  subscribeSyncMerged: (listener: () => void) => {
    fire = listener;
    return () => undefined;
  },
}));

describe("SyncMergedNotice", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows, coalesces repeats, and dismisses", () => {
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(SyncMergedNotice)));
    expect(document.body.textContent).not.toContain(SYNC_MERGED_MESSAGE);
    act(() => fire());
    expect(document.body.textContent).toContain("merged");
    act(() => void vi.advanceTimersByTime(4000));
    act(() => fire());
    act(() => void vi.advanceTimersByTime(4000));
    expect(document.body.textContent).toContain("merged");
    act(() => void vi.advanceTimersByTime(1100));
    expect(document.body.textContent).not.toContain("merged");
    act(() => fire());
    act(() => document.body.querySelector("button")!.click());
    expect(document.body.textContent).not.toContain("merged");
    act(() => root.unmount());
  });
});
