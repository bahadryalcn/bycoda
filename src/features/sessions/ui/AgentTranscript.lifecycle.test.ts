// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("reveals a remote page whose callback resolves before its blocks reach React", async () => {
  const latest: Block[] = [{ id: "latest", role: "user", text: "Latest message" }];
  let resolve!: (count: number) => void;
  const load = vi.fn(
    () =>
      new Promise<number>((done) => {
        resolve = done;
      }),
  );
  await act(async () =>
    root.render(
      createElement(AgentTranscript, {
        blocks: latest,
        remoteHistoryHasMore: true,
        onLoadRemoteHistory: load,
      }),
    ),
  );
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === "Load earlier messages",
  )!;
  act(() => button.click());
  await act(async () => resolve(20));
  const older: Block[] = Array.from({ length: 20 }, (_, index) => ({
    id: `older-${index}`,
    role: "user",
    text: `Older message ${index}`,
  }));
  await act(async () =>
    root.render(
      createElement(AgentTranscript, {
        blocks: [...older, ...latest],
        remoteHistoryHasMore: false,
        onLoadRemoteHistory: load,
      }),
    ),
  );
  expect(host.textContent).toContain("Older message 0");
  expect(load).toHaveBeenCalledOnce();
});

it("clears old owner handles before publishing to a new pooled-transcript owner", async () => {
  const first = vi.fn();
  const next = vi.fn();
  const blocks: Block[] = [{ id: "user", role: "user", text: "Message" }];
  await act(async () =>
    root.render(
      createElement(AgentTranscript, {
        blocks,
        onJumpToBottomReady: first,
        onRevealReady: first,
        onNavigateReady: first,
      }),
    ),
  );
  expect(first.mock.calls.every(([callback]) => typeof callback === "function")).toBe(true);
  await act(async () =>
    root.render(
      createElement(AgentTranscript, {
        blocks,
        onJumpToBottomReady: next,
        onRevealReady: next,
        onNavigateReady: next,
      }),
    ),
  );
  expect(first.mock.calls.slice(-3)).toEqual([[null], [null], [null]]);
  expect(next.mock.calls.every(([callback]) => typeof callback === "function")).toBe(true);
  await act(async () => root.unmount());
  expect(next.mock.calls.slice(-3)).toEqual([[null], [null], [null]]);
});

it("holds pending follow-ups and prevents send or removal while delivery is active", async () => {
  const block: Block = {
    id: "pending",
    role: "user",
    text: "Change direction",
    draft: true,
    followUpDelivery: "pending",
  };
  const onSendDraft = vi.fn();
  const onRemoveDraft = vi.fn();
  await act(async () =>
    root.render(
      createElement(AgentTranscript, {
        blocks: [block],
        busy: false,
        onSendDraft,
        onRemoveDraft,
      }),
    ),
  );
  const send = host.querySelector<HTMLButtonElement>('[aria-label="Send draft"]')!;
  const remove = host.querySelector<HTMLButtonElement>('[aria-label="Remove draft"]')!;
  expect(send.disabled).toBe(true);
  expect(remove.disabled).toBe(true);
  expect(send.title).toContain("still being delivered");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Sending...");
  await act(async () => {
    send.click();
    remove.click();
  });
  expect(onSendDraft).not.toHaveBeenCalled();
  expect(onRemoveDraft).not.toHaveBeenCalled();
});

it.each(["undelivered", "uncertain"] as const)(
  "holds a recovered %s follow-up while busy and permits manual retry when idle",
  async (followUpDelivery) => {
    const block: Block = {
      id: "recoverable",
      role: "user",
      text: "Change direction",
      draft: true,
      followUpDelivery,
    };
    const onSendDraft = vi.fn();
    const onRemoveDraft = vi.fn();
    const render = (busy: boolean) =>
      root.render(
        createElement(AgentTranscript, {
          blocks: [block],
          busy,
          onSendDraft,
          onRemoveDraft,
        }),
      );
    await act(async () => render(true));
    const send = host.querySelector<HTMLButtonElement>('[aria-label="Send draft"]')!;
    const remove = host.querySelector<HTMLButtonElement>('[aria-label="Remove draft"]')!;
    expect(send.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    await act(async () => {
      send.click();
      remove.click();
    });
    expect(onSendDraft).not.toHaveBeenCalled();
    expect(onRemoveDraft).not.toHaveBeenCalled();
    await act(async () => render(false));
    expect(send.disabled).toBe(false);
    expect(remove.disabled).toBe(false);
    if (followUpDelivery === "uncertain") {
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        "may already have been delivered",
      );
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        "Inspect the conversation before retrying",
      );
    } else {
      expect(host.querySelector('[role="status"]')?.textContent).toContain("Not delivered");
    }
    await act(async () => send.click());
    expect(onSendDraft).toHaveBeenCalledExactlyOnceWith(block);
    await act(async () => remove.click());
    expect(onRemoveDraft).toHaveBeenCalledExactlyOnceWith(block);
  },
);

it("keeps ordinary draft controls available during a running turn", async () => {
  const block: Block = { id: "draft", role: "user", text: "An ordinary unsent draft", draft: true };
  const onSendDraft = vi.fn();
  await act(async () =>
    root.render(
      createElement(AgentTranscript, {
        blocks: [block],
        busy: true,
        onSendDraft,
      }),
    ),
  );
  const send = host.querySelector<HTMLButtonElement>('[aria-label="Send draft"]')!;
  expect(send.disabled).toBe(false);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Remove draft"]')!.disabled).toBe(
    false,
  );
  await act(async () => send.click());
  expect(onSendDraft).toHaveBeenCalledExactlyOnceWith(block);
});
