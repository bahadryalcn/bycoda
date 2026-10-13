// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../../source-control/hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => ({
    branches: { current: "main", detached: false, branches: [] },
    settled: true,
  }),
}));

import { Composer, ComposerAction } from "./Composer";
import { setHarnessModeLimits, type ComposerTurnOptions } from "../model/session";
import { submitAfterProjectSync } from "../../../app/model/submissionAcceptance";
import { savePromptTemplates, type PromptTemplate } from "../model/promptTemplates";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setHarnessModeLimits("antigravity", undefined);
  vi.unstubAllGlobals();
});

async function renderComposer(
  props: Partial<ComponentProps<typeof Composer>>,
  onSubmit: (...args: unknown[]) => boolean | void,
) {
  await act(async () =>
    root.render(
      createElement(Composer, {
        focused: true,
        harness: props.harness ?? "claude",
        model: "m",
        runtimeMode: "supervised",
        executionCwd: "/repo",
        sessionId: "s1",
        busy: props.busy,
        backgroundOnly: props.backgroundOnly,
        hideProjectPicker: true,
        hideBranchPicker: true,
        onFocus: () => {},
        onCwdChange: () => {},
        onModelChange: () => {},
        onRuntimeModeChange: () => {},
        onSubmit: onSubmit as never,
        ...props,
      }),
    ),
  );
  return container.querySelector("textarea")!;
}

describe("retained queue-row actions", () => {
  it.each([
    { harness: "antigravity" as const, intent: "default" as const },
    { harness: "claude" as const, intent: "plan" as const },
  ])(
    "disables unsupported or plan steering while busy ($harness/$intent)",
    async ({ harness, intent }) => {
      const onSteerQueuedMessage = vi.fn();
      await renderComposer(
        {
          harness,
          busy: true,
          onSteerQueuedMessage,
          queuedMessages: [{ id: "held", text: "review this", attachments: [], intent }],
          queueStatus: "active",
        },
        vi.fn(),
      );
      const steer = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === "Steer",
      )!;
      expect(steer.disabled).toBe(true);
      await act(async () => {
        steer.click();
        steer.click();
      });
      expect(onSteerQueuedMessage).not.toHaveBeenCalled();
    },
  );
});

describe("local asynchronous submission recovery", () => {
  it("restores the prompt, pasted attachment and plan selection after failed project preparation", async () => {
    let failSync!: (error: Error) => void;
    const sync = new Promise<never>((_resolve, reject) => {
      failSync = reject;
    });
    const onSubmit = vi.fn((_text: string, _files: unknown[], options?: ComposerTurnOptions) => {
      void submitAfterProjectSync({
        cwd: "/repo",
        sync,
        applyLocationChange: vi.fn(),
        submit: () => true,
        onError: vi.fn(),
        onRejected: () => {
          options?.onSendRejected?.();
        },
      });
      return true;
    });
    const textarea = await renderComposer({}, onSubmit as never);
    await type(textarea, "/plan inspect this image");
    const file = new File(["image"], "review.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: () => "",
        files: [file],
        items: [{ kind: "file", type: file.type, getAsFile: () => file }],
      },
    });
    await act(async () => {
      textarea.dispatchEvent(paste);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click();
    });
    expect(textarea.value).toBe("");
    expect(container.querySelector('[aria-label="Remove review.png"]')).toBeNull();
    await act(async () => {
      failSync(new Error("project unavailable"));
    });
    expect(textarea.value).toContain("inspect this image");
    expect(container.querySelector('[aria-label="Remove review.png"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Turn off Plan mode"]')).not.toBeNull();
  });

  it("lets the app retain the failed submission when the composer contains newer text", async () => {
    let rejectSend: ComposerTurnOptions["onSendRejected"];
    const textarea = await renderComposer({}, ((
      _text: string,
      _files: unknown[],
      options?: ComposerTurnOptions,
    ) => {
      rejectSend = options?.onSendRejected;
      return true;
    }) as never);
    await type(textarea, "original prompt");
    press(textarea, { key: "Enter", code: "Enter" });
    await act(async () => {});
    await type(textarea, "newer prompt");
    let restored: boolean | undefined;
    await act(async () => {
      restored = rejectSend?.();
    });
    expect(restored).toBe(false);
    expect(textarea.value).toBe("newer prompt");
  });
});

async function type(textarea: HTMLTextAreaElement, text: string) {
  await act(async () => {
    textarea.value = text;
    textarea.setSelectionRange(text.length, text.length);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(textarea: HTMLTextAreaElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    textarea.dispatchEvent(event);
  });
  return event;
}

describe("Shift+Tab queues while a turn runs", () => {
  const shiftTab = { key: "Tab", code: "Tab", shiftKey: true };

  it("queues the typed message regardless of the follow-up setting", async () => {
    localStorage.setItem("bycoda.followUpBehavior", "steer");
    const onSubmit = vi.fn(() => true);
    const textarea = await renderComposer({ busy: true }, onSubmit);
    await type(textarea, "then add tests");

    const event = press(textarea, shiftTab);
    await act(async () => {});

    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      "then add tests",
      [],
      expect.objectContaining({ followUpBehavior: "queue" }),
    );
  });

  it("keeps Shift+Tab in the composer without sending when idle, empty, or background-only", async () => {
    const onSubmit = vi.fn(() => true);
    const idle = await renderComposer({ busy: false }, onSubmit);
    await type(idle, "hello");
    expect(press(idle, shiftTab).defaultPrevented).toBe(true);

    const empty = await renderComposer({ busy: true }, onSubmit);
    await type(empty, "");
    expect(press(empty, shiftTab).defaultPrevented).toBe(true);

    const bg = await renderComposer({ busy: true, backgroundOnly: true }, onSubmit);
    await type(bg, "hello");
    expect(press(bg, shiftTab).defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("leaves Enter to the follow-up setting", async () => {
    const onSubmit = vi.fn(() => true);
    const textarea = await renderComposer({ busy: true }, onSubmit);
    await type(textarea, "go on");
    press(textarea, { key: "Enter", code: "Enter" });
    await act(async () => {});
    expect(onSubmit).toHaveBeenCalledWith(
      "go on",
      [],
      expect.not.objectContaining({ followUpBehavior: "queue" }),
    );
  });
});

describe("ComposerAction queue entry", () => {
  const render = (onQueue?: () => void) =>
    renderToStaticMarkup(
      createElement(ComposerAction, {
        busy: true,
        hasValue: true,
        onSend: vi.fn(),
        onQueue,
        queueShortcut: "Shift+Tab",
        onStop: vi.fn(),
      }),
    );

  it("offers Queue with its shortcut next to Send while busy", () => {
    const html = render(vi.fn());
    expect(html).toContain('aria-label="Queue message"');
    expect(html).toContain("(Shift+Tab)");
    expect(html).toContain('aria-label="Send"');
  });

  it("omits Queue when queueing does not apply", () => {
    expect(render(undefined)).not.toContain("Queue message");
  });
});

describe("typed /plan on a transport that cannot plan", () => {
  it("shows the Plan button's reason and starts no turn", async () => {
    setHarnessModeLimits("antigravity", { plan: "stream-json cannot plan" });
    const onSubmit = vi.fn(() => true);
    const textarea = await renderComposer({ harness: "antigravity" }, onSubmit);
    await type(textarea, "/plan refactor the parser");
    press(textarea, { key: "Enter", code: "Enter" });
    await act(async () => {});

    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "stream-json cannot plan",
    );
    expect(textarea.value).toBe("/plan refactor the parser");
  });

  it("still plans where the transport can", async () => {
    const onSubmit = vi.fn(() => true);
    const textarea = await renderComposer({}, onSubmit);
    await type(textarea, "/plan refactor the parser");
    press(textarea, { key: "Enter", code: "Enter" });
    await act(async () => {});
    expect(onSubmit).toHaveBeenCalledWith(
      "refactor the parser",
      [],
      expect.objectContaining({ intent: "plan" }),
    );
  });
});

describe("prompt templates in the composer", () => {
  const template: PromptTemplate = {
    id: "t1",
    name: "Review",
    body: "Review {{cursor}} for bugs",
    trigger: "rev",
  };

  it("expands ;trigger on space and parks the caret on {{cursor}}", async () => {
    savePromptTemplates([template]);
    const textarea = await renderComposer({}, vi.fn());
    await type(textarea, "please ;rev");
    const event = press(textarea, { key: " ", code: "Space" });

    expect(event.defaultPrevented).toBe(true);
    expect(textarea.value).toBe("please Review  for bugs");
    expect(textarea.selectionStart).toBe("please Review ".length);
  });

  it("leaves a space alone when the word is not a trigger", async () => {
    savePromptTemplates([template]);
    const textarea = await renderComposer({}, vi.fn());
    await type(textarea, "please ;nope");
    expect(press(textarea, { key: " ", code: "Space" }).defaultPrevented).toBe(false);
  });
});

describe("a queue restored after a restart", () => {
  async function renderQueue(
    queuedMessages: { id: string; text: string; attachments: unknown[] }[],
    onSteer = vi.fn(),
  ) {
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "m",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          sessionId: "s1",
          hideProjectPicker: true,
          hideBranchPicker: true,
          queuedMessages: queuedMessages as never,
          queueStatus: "restored",
          onSteerQueuedMessage: onSteer,
          onFocus: () => {},
          onCwdChange: () => {},
          onModelChange: () => {},
          onRuntimeModeChange: () => {},
          onSubmit: () => true,
        }),
      ),
    );
    return onSteer;
  }

  it("says how many came back and sends the next one on request", async () => {
    const onSteer = await renderQueue([
      { id: "q1", text: "first", attachments: [] },
      { id: "q2", text: "second", attachments: [] },
    ]);
    const card = container.querySelector("[data-message-queue-card]")!;
    expect(card.textContent).toContain("2 queued messages restored");
    const send = [...card.querySelectorAll("button")].find((b) => b.textContent === "Send next")!;
    act(() => send.click());
    expect(onSteer).toHaveBeenCalledWith("q1");
  });

  it("holds a message whose attachment is gone", async () => {
    const onSteer = await renderQueue([
      {
        id: "q1",
        text: "see [file1]",
        attachments: [
          { id: "f", name: "a", mimeType: "text/plain", kind: "file", size: 1, missing: true },
        ],
      },
    ]);
    const card = container.querySelector("[data-message-queue-card]")!;
    expect(card.textContent).toContain("Attachment missing");
    const send = [...card.querySelectorAll("button")].find((b) => b.textContent === "Send next")!;
    expect(send.disabled).toBe(true);
    act(() => send.click());
    expect(onSteer).not.toHaveBeenCalled();
  });
});

describe("reordering queued messages", () => {
  async function renderReorder(onReorder = vi.fn(), count = 3) {
    const queuedMessages = ["q1", "q2", "q3"]
      .slice(0, count)
      .map((id) => ({ id, text: id, attachments: [] }));
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "m",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          sessionId: "s1",
          hideProjectPicker: true,
          hideBranchPicker: true,
          queuedMessages: queuedMessages as never,
          queueStatus: "restored",
          onReorderQueuedMessages: onReorder,
          onFocus: () => {},
          onCwdChange: () => {},
          onModelChange: () => {},
          onRuntimeModeChange: () => {},
          onSubmit: () => true,
        }),
      ),
    );
    return onReorder;
  }
  const handle = (id: string) =>
    container.querySelector<HTMLElement>(`[data-queue-handle="${id}"]`)!;
  const key = (id: string, init: KeyboardEventInit) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    act(() => {
      handle(id).dispatchEvent(event);
    });
    return event;
  };

  it("labels the handle and moves a row with Alt+Arrow", async () => {
    const onReorder = await renderReorder();
    expect(handle("q2").getAttribute("aria-label")).toBe("Reorder queued message");
    expect(handle("q2").title).toBe("Drag to reorder");

    expect(key("q2", { key: "ArrowUp", altKey: true }).defaultPrevented).toBe(true);
    expect(onReorder).toHaveBeenLastCalledWith(["q2", "q1", "q3"]);
    key("q2", { key: "ArrowDown", altKey: true });
    expect(onReorder).toHaveBeenLastCalledWith(["q1", "q3", "q2"]);
  });

  it("stops at the ends and ignores plain arrows", async () => {
    const onReorder = await renderReorder();
    key("q1", { key: "ArrowUp", altKey: true });
    key("q3", { key: "ArrowDown", altKey: true });
    key("q2", { key: "ArrowUp" });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("offers no handle for a single message", async () => {
    await renderReorder(vi.fn(), 1);
    expect(container.querySelector("[data-queue-handle]")).toBeNull();
  });
});
