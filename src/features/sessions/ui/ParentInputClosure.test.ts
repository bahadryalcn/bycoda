// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  captureParentInputs as capture,
  beginParentInputClosure,
  type ParentInputCapture,
  type ParentInputClosure,
} from "../data/parentInputClosure";
import {
  associateQuestionDraft,
  discardQuestionDraft,
  writeQuestionDraft,
  readQuestionDraft,
} from "../model/questionDrafts";
import { QuestionForm } from "./QuestionForm";
import { QueuedMessageEditDialog } from "./QueuedMessageEditDialog";
import { Composer } from "./Composer";
import { beginComposerClosure, type MountedComposerClosure } from "../data/composerClosure";
import {
  beginNativeProducerInputClosure,
  type NativeProducerInputClosure,
} from "../data/mountedInputCapture";
import { BtwSheet, useBtwConversation, type BtwConversation } from "./BtwSheet";
import { SessionPane } from "./SessionPane";
import { newSession } from "../model/session";
import { CreateSkillForm } from "../../skills/ui/SkillPicker";
import type { UserQuestionPrompt } from "../model/userQuestion";
import type { Attachment } from "../model/session";
import { clearComposerDraft, setComposerDraftMode } from "../model/draftCache";

const ports = vi.hoisted(() => ({ invoke: vi.fn(), picker: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: ports.invoke,
  isTauri: () => false,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }),
}));
vi.mock("../model/attachments", async (original) => ({
  ...(await original<typeof import("../model/attachments")>()),
  pickAttachments: ports.picker,
}));
vi.mock("./ModelPicker", async () => {
  const { createPortal } = await import("react-dom");
  return {
    ModelPicker: ({ onChange }: { onChange?: (harness: "codex", model: string) => void }) =>
      createPortal(
        createElement(
          "button",
          {
            "data-parent-model-portal": "true",
            onClick: () => onChange?.("codex", "portal-model"),
          },
          "Fixture model choice",
        ),
        document.body,
      ),
  };
});

let root: Root;
let container: HTMLDivElement;
let id: string;
const leases: ParentInputCapture[] = [];
const inputClosures: ParentInputClosure[] = [];
const rawClosures: { close: MountedComposerClosure; owner: object }[] = [];
const producerClosures: NativeProducerInputClosure[] = [];
const settleJobs: (() => void)[] = [];
async function closeInputs() {
  let close!: ParentInputClosure;
  await act(async () => {
    close = beginParentInputClosure(id, { owner: {}, timeoutMs: 5000 });
  });
  inputClosures.push(close);
  return close;
}
async function captureParentInputs(sessionId: string) {
  const lease = await capture(sessionId);
  leases.push(lease);
  return lease;
}
const question: UserQuestionPrompt = {
  requestId: 17,
  providerTurnId: "original-provider-turn",
  callId: "original-provider-call",
  questions: [
    {
      id: "answer",
      prompt: "Question",
      multiSelect: false,
      allowCustom: true,
      preserveCustomWhitespace: true,
      options: [],
    },
  ],
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  ports.invoke.mockReset().mockResolvedValue([]);
  ports.picker.mockReset();
  localStorage.clear();
  id = `parent-${crypto.randomUUID()}`;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    for (const settle of settleJobs.splice(0)) settle();
  });
  await act(async () => root.unmount());
  for (const close of inputClosures.splice(0)) close.release();
  for (const close of producerClosures.splice(0)) close.release();
  for (const { close, owner } of rawClosures.splice(0)) close.reopen(owner);
  for (const lease of leases.splice(0)) lease.release();
  discardQuestionDraft(id, question);
  clearComposerDraft(id);
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.documentElement.style.removeProperty("--motion-reorder-duration");
});

it("closes actual question edits/reply/cache writes and preserves authoritative discard", async () => {
  const reply = vi.fn();
  await act(async () =>
    root.render(
      createElement(QuestionForm, {
        prompt: question,
        draftScope: id,
        parentSessionId: id,
        onReply: reply,
      }),
    ),
  );
  const field = container.querySelector("textarea")!;
  await input(field, "  kept answer  ");
  const close = await closeInputs();
  expect(field.readOnly).toBe(true);
  expect(field.matches(":disabled")).toBe(false);
  field.focus();
  expect(document.activeElement).toBe(field);
  const before = new Event("beforeinput", { bubbles: true, cancelable: true });
  field.dispatchEvent(before);
  expect(before.defaultPrevented).toBe(true);
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  writeQuestionDraft(id, question, { step: 0, answers: {}, custom: { answer: "denied" } });
  expect(readQuestionDraft(id, question)?.custom.answer).toBe("  kept answer  ");
  expect(reply).not.toHaveBeenCalled();
  discardQuestionDraft(id, question);
  expect(readQuestionDraft(id, question)).toBeUndefined();
  expect(close.current()).toBe(false);
  await act(async () => close.release());
  expect(field.readOnly).toBe(false);
  expect(field.value).toBe("  kept answer  ");
});

it("gates real queue save and picker admission while Escape/cancel remains usable", async () => {
  const save = vi.fn();
  const cancel = vi.fn();
  await act(async () =>
    root.render(
      createElement(QueuedMessageEditDialog, {
        parentSessionId: id,
        message: { id: "closed-queue", text: "  original  ", attachments: [] },
        canAttach: true,
        onSave: save,
        onRemove: vi.fn(),
        onCancel: cancel,
      }),
    ),
  );
  const close = await closeInputs();
  const field = document.body.querySelector("textarea")!;
  expect(field.readOnly).toBe(true);
  await act(async () =>
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>('[aria-label="Add files or images"]')!.click(),
  );
  expect(save).not.toHaveBeenCalled();
  expect(ports.picker).not.toHaveBeenCalled();
  const cancelButton = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Cancel",
  )!;
  await act(async () => cancelButton.click());
  expect(cancel).toHaveBeenCalledOnce();
  expect(close.current()).toBe(false);
  expect(field.value).toBe("  original  ");
});

it("keeps a real pre-close queue attachment read owned through actual result application", async () => {
  let finish!: (files: Attachment[]) => void;
  ports.picker.mockImplementation(
    () =>
      new Promise<Attachment[]>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    root.render(
      createElement(QueuedMessageEditDialog, {
        parentSessionId: id,
        message: { id: "old-read", text: "exact", attachments: [] },
        canAttach: true,
        onSave: vi.fn(),
        onRemove: vi.fn(),
        onCancel: vi.fn(),
      }),
    ),
  );
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>('[aria-label="Add files or images"]')!.click(),
  );
  settleJobs.push(() => finish([]));
  const close = await closeInputs();
  let settled = false;
  const capture = close
    .capture()
    .then(
      (lease) => ({ lease }),
      (error: unknown) => ({ error }),
    )
    .finally(() => {
      settled = true;
    });
  await Promise.resolve();
  expect(settled).toBe(false);
  const file: Attachment = {
    id: "old-result",
    name: "kept.txt",
    kind: "file",
    mimeType: "text/plain",
    size: 1,
    path: "/fixture/kept.txt",
  };
  await act(async () => finish([file]));
  const result = await capture;
  // A later React commit may honestly invalidate; it cannot discard or re-run
  // the actual admitted result or publish a false-current observation.
  if ("lease" in result) expect(result.lease.current()).toBe(close.current());
  else expect(close.current()).toBe(false);
  const observed = await captureParentInputs(id);
  expect(
    observed.snapshots.find(
      (entry) => entry.snapshot.message && entry.snapshot.source !== "queue-edit-save-intent",
    )!.snapshot.draft,
  ).toMatchObject({ attachments: [{ id: "old-result" }] });
  expect(ports.picker).toHaveBeenCalledOnce();
});

it("gates the actual Composer portal callback and new send while keeping Stop available", async () => {
  const model = vi.fn();
  const submit = vi.fn();
  const stop = vi.fn();
  await composer({
    hideTopBar: false,
    busy: true,
    onModelChange: model,
    onSubmit: submit,
    onStop: stop,
  });
  const portal = document.body.querySelector<HTMLButtonElement>("[data-parent-model-portal]")!;
  expect(portal).not.toBeNull();
  const close = await closeInputs();
  const field = container.querySelector("textarea")!;
  await act(async () => {
    portal.click();
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  expect(model).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  expect(field.readOnly).toBe(true);
  await act(async () =>
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ),
  );
  expect(stop).toHaveBeenCalledOnce();
  expect(close.current()).toBe(false);
  await act(async () => close.release());
  await act(async () => portal.click());
  expect(model).toHaveBeenCalledExactlyOnceWith("codex", "portal-model");
});

it("closes a synthetic child Composer by the genuine root without rebinding its draft ID", async () => {
  const submit = vi.fn();
  const childId = `${id}:original-child`;
  await composer({ sessionId: childId, parentSessionId: id, onSubmit: submit });
  const close = await closeInputs();
  const field = container.querySelector("textarea")!;
  expect(field.readOnly).toBe(true);
  await act(async () =>
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );
  expect(submit).not.toHaveBeenCalled();
  const captured = await close.capture();
  expect(
    captured.snapshots.find((entry) => entry.kind === "composer-parent")!.snapshot
      .composerSessionId,
  ).toBe(childId);
  expect(captured.snapshots.every((entry) => entry.sessionId === id)).toBe(true);
  clearComposerDraft(childId);
});

it("gates direct Btw controller callbacks and preserves existing inactive child drafts", async () => {
  let btw!: BtwConversation;
  const submit = vi.fn();
  function Owner() {
    btw = useBtwConversation({
      parentSessionId: id,
      available: true,
      harness: "claude",
      blocks: [
        { id: "turn", role: "user", text: "first", durationMs: 1 },
        { id: "answer", role: "assistant", text: "done" },
      ],
      onSubmit: submit,
      onRetry: vi.fn(),
    });
    return null;
  }
  await act(async () => root.render(createElement(Owner)));
  await act(async () => {
    btw.openWith("  inactive  ", { draft: true });
  });
  const childId = btw.activeTabId;
  const close = await closeInputs();
  await act(async () => {
    expect(btw.openWith("denied", { draft: true })).toBe(false);
    expect(btw.submit("denied")).toBe(false);
    btw.changeDraft("denied");
    btw.changeModel("claude", "denied");
  });
  expect(btw.activeTabId).toBe(childId);
  const capture = await close.capture();
  expect(
    capture.snapshots.find((entry) => entry.kind === "btw-parent")!.snapshot.draftTexts,
  ).toEqual({ [childId!]: "  inactive  " });
  expect(submit).not.toHaveBeenCalled();
  await act(async () => btw.stop());
  expect(close.current()).toBe(false);
});

it("closes actual nested skill name/scope/submit but preserves Escape", async () => {
  const create = vi.fn();
  const cancel = vi.fn();
  await act(async () =>
    root.render(
      createElement(CreateSkillForm, {
        parentSessionId: id,
        query: "kept-name",
        cwd: "/fixture",
        onCreate: create,
        onCancel: cancel,
      }),
    ),
  );
  const close = await closeInputs();
  const field =
    container.querySelector<HTMLInputElement>('input[type="text"]') ??
    container.querySelector("input")!;
  expect(field.readOnly).toBe(true);
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(create).not.toHaveBeenCalled();
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
  );
  expect(cancel).toHaveBeenCalledOnce();
  expect(close.current()).toBe(false);
  expect(field.value).toBe("kept-name");
});

it("holds a real preexisting IME without changing editability or cancelling its text", async () => {
  await composer();
  const field = container.querySelector("textarea")!;
  field.dispatchEvent(new Event("compositionstart", { bubbles: true }));
  const close = await closeInputs();
  expect(close.current()).toBe(false);
  expect(field.readOnly).toBe(false);
  await input(field, "  完了  ");
  field.dispatchEvent(new Event("compositionend", { bubbles: true }));
  expect(field.value).toBe("  完了  ");
  await expect(close.capture()).rejects.toThrow("changed");
  expect(
    (await captureParentInputs(id)).snapshots.find((entry) => entry.kind === "composer-parent")!
      .snapshot.text,
  ).toBe("  完了  ");
});

it("keeps the real Raw attachment bridge owned until its Native draft ACK, beyond callback application", async () => {
  let finishPicker!: (files: Attachment[]) => void;
  let finishAck!: () => void;
  const ack = new Promise<null>((resolve) => {
    finishAck = () => resolve(null);
  });
  let hold = false;
  ports.invoke.mockImplementation(async (command: string) =>
    command === "session_set_draft" && hold ? ack : [],
  );
  ports.picker.mockImplementation(
    () =>
      new Promise<Attachment[]>((resolve) => {
        finishPicker = resolve;
      }),
  );
  settleJobs.push(finishAck, () => finishPicker?.([]));
  await composer();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Add files or skills"]')!.click(),
  );
  const upload = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Upload file"),
  )!;
  await act(async () => upload.click());
  const first = await closeInputs();
  hold = true;
  await act(async () =>
    finishPicker([
      {
        id: "full-ack-file",
        name: "kept.txt",
        kind: "file",
        mimeType: "text/plain",
        size: 1,
        path: "/fixture/kept.txt",
      },
    ]),
  );
  await vi.waitFor(() =>
    expect(ports.invoke.mock.calls.some(([command]) => command === "session_set_draft")).toBe(true),
  );
  await act(async () => first.release());
  const second = await closeInputs();
  let settled = false;
  const capture = second
    .capture()
    .then(
      (lease) => ({ lease }),
      (error: unknown) => ({ error }),
    )
    .finally(() => {
      settled = true;
    });
  await Promise.resolve();
  expect(settled).toBe(false);
  await act(async () => finishAck());
  const result = await capture;
  if ("lease" in result) expect(result.lease.current()).toBe(second.current());
  else expect(second.current()).toBe(false);
  expect(ports.picker).toHaveBeenCalledOnce();
  const actual = await captureParentInputs(id);
  expect(
    actual.snapshots.find((entry) => entry.kind === "composer-parent")!.snapshot.attachments,
  ).toMatchObject([{ id: "full-ack-file" }]);
});

it("never applies an old queue read into a reused component with a foreign root/message", async () => {
  let finish!: (files: Attachment[]) => void;
  ports.picker.mockImplementation(
    () =>
      new Promise<Attachment[]>((resolve) => {
        finish = resolve;
      }),
  );
  settleJobs.push(() => finish?.([]));
  const props = { canAttach: true, onSave: vi.fn(), onRemove: vi.fn(), onCancel: vi.fn() };
  await act(async () =>
    root.render(
      createElement(QueuedMessageEditDialog, {
        ...props,
        parentSessionId: id,
        message: { id: "same-message-id", text: "old root", attachments: [] },
      }),
    ),
  );
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>('[aria-label="Add files or images"]')!.click(),
  );
  const old = await closeInputs();
  const foreignId = `${id}:foreign`;
  await act(async () =>
    root.render(
      createElement(QueuedMessageEditDialog, {
        ...props,
        parentSessionId: foreignId,
        message: { id: "same-message-id", text: "  foreign root  ", attachments: [] },
      }),
    ),
  );
  expect(old.current()).toBe(false);
  let foreign!: ParentInputClosure;
  await act(async () => {
    foreign = beginParentInputClosure(foreignId, { owner: {}, timeoutMs: 5000 });
  });
  inputClosures.push(foreign);
  await foreign.capture();
  await act(async () =>
    finish([
      {
        id: "wrong-root-file",
        name: "old.txt",
        kind: "file",
        mimeType: "text/plain",
        size: 1,
        path: "/fixture/old.txt",
      },
    ]),
  );
  expect(document.body.querySelector("textarea")!.value).toBe("  foreign root  ");
  expect(document.body.querySelector('[role="alert"]')).toBeNull();
  expect(foreign.current()).toBe(true);
  expect(props.onSave).not.toHaveBeenCalled();
});

it("preserves an externally accepted recall during close while refusing a new imperative recall", async () => {
  let recall!: (value: { text: string; attachments: Attachment[] }) => void;
  const applied = vi.fn();
  const props = {
    onRecallMessageReady: (callback: typeof recall) => {
      recall = callback;
    },
  };
  await composer(props);
  const close = await closeInputs();
  await act(async () => recall({ text: "denied fresh recall", attachments: [] }));
  expect(container.querySelector("textarea")!.value).toBe("  retained draft  ");
  await composer({
    ...props,
    recalledMessage: {
      id: "accepted-recall",
      value: { text: "  accepted external recall  ", attachments: [] },
    },
    onRecalledMessageApplied: applied,
  });
  expect(container.querySelector("textarea")!.value).toBe("  accepted external recall  ");
  expect(applied).toHaveBeenCalledExactlyOnceWith("accepted-recall");
  expect(close.current()).toBe(false);
});

it("applies an external reset without retaining a gated text or Save mode", async () => {
  setComposerDraftMode(id, "save");
  await composer({ onSaveDraft: vi.fn() });
  const before = await captureParentInputs(id);
  expect(
    before.snapshots.find((entry) => entry.kind === "composer-parent")!.snapshot.draftSelected,
  ).toBe(true);
  const close = await closeInputs();
  await composer({ draftResetToken: 1, onSaveDraft: vi.fn() });
  expect(container.querySelector("textarea")!.value).toBe("");
  const after = await captureParentInputs(id);
  expect(after.snapshots.find((entry) => entry.kind === "composer-parent")!.snapshot).toMatchObject(
    { draftSelected: false, selectedMcp: [] },
  );
  expect(close.current()).toBe(false);
});

it("keeps a late rejected send from restoring into a reused foreign Composer owner", async () => {
  let rejected!: () => boolean;
  const submit = vi.fn((_text, _files, options) => {
    rejected = options.onSendRejected;
  });
  await composer({ onSubmit: submit });
  await act(async () =>
    container
      .querySelector("textarea")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      ),
  );
  const foreign = `${id}:new-owner`;
  await composer({
    sessionId: foreign,
    parentSessionId: foreign,
    initialDraft: "",
    onSubmit: submit,
  });
  await act(async () => expect(rejected()).toBe(false));
  expect(container.querySelector("textarea")!.value).toBe("");
  expect(submit).toHaveBeenCalledTimes(1);
  clearComposerDraft(foreign);
});
async function input(field: HTMLTextAreaElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function composer(extra: Record<string, unknown> = {}) {
  await act(async () =>
    root.render(
      createElement(Composer, {
        sessionId: id,
        focused: false,
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        executionCwd: "/fixture",
        initialDraft: "  retained draft  ",
        hideTopBar: true,
        onFocus: vi.fn(),
        onCwdChange: vi.fn(),
        onModelChange: vi.fn(),
        onRuntimeModeChange: vi.fn(),
        onSubmit: vi.fn(),
        ...extra,
      }),
    ),
  );
}

async function pane(extra: Partial<ComponentProps<typeof SessionPane>> = {}) {
  const noop = () => {};
  await act(async () =>
    root.render(
      createElement(SessionPane, {
        session: { ...newSession("codex", "/fixture", ""), id, composerSeed: "  retained draft  " },
        visible: true,
        focused: false,
        inSplit: false,
        composerFocused: false,
        recents: [],
        onFocus: noop,
        onClose: noop,
        onCwdChange: noop,
        onBranchChange: noop,
        onModelChange: noop,
        onModelSettingsChange: noop,
        onRuntimeModeChange: noop,
        onWorkspaceModeChange: noop,
        onWorktreeBaseChange: noop,
        onSubmit: noop,
        onSaveDraft: noop,
        onRemoveDraft: noop,
        onStop: noop,
        onCompactContext: () => false,
        onPlaceSessionInFolder: noop,
        onDeleteQueuedMessage: noop,
        onEditQueuedMessage: noop,
        onQueuedMessageEditingChange: noop,
        onSteerQueuedMessage: noop,
        onResumeQueue: noop,
        onUsageLimitResumeAtReset: noop,
        onUsageLimitDismiss: noop,
        onApproval: noop,
        onQuestionReply: noop,
        onOpenFile: noop,
        onOpenDiff: noop,
        onOpenPlan: noop,
        onBuildPlan: noop,
        onNewTerminal: noop,
        ...extra,
      }),
    ),
  );
}

async function acceptedFileSend() {
  let finish!: (files: Attachment[]) => void;
  ports.picker.mockImplementation(
    () =>
      new Promise<Attachment[]>((resolve) => {
        finish = resolve;
      }),
  );
  settleJobs.push(() => finish?.([]));
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Add files or skills"]')!.click(),
  );
  const upload = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Upload file"),
  )!;
  await act(async () => upload.click());
  const field = container.querySelector("textarea")!;
  await act(async () =>
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );
  return {
    field,
    finish: (files?: Attachment[]) =>
      finish(
        files ?? [
          {
            id: "accepted-file",
            name: "kept.txt",
            kind: "file",
            mimeType: "text/plain",
            size: 1,
            path: "/fixture/kept.txt",
          },
        ],
      ),
  };
}

it("captures an actual idle SessionPane through owned Parent/editor and Raw closure without counting its notified seed twice", async () => {
  await pane();
  let inputs!: NativeProducerInputClosure;
  const owner = {};
  let raw!: MountedComposerClosure;
  await act(async () => {
    inputs = beginNativeProducerInputClosure(id, { owner, timeoutMs: 5000 });
    producerClosures.push(inputs);
    raw = beginComposerClosure([id], { owner, timeoutMs: 5000 });
    rawClosures.push({ close: raw, owner });
  });
  const composers = await raw.captureAndFlush();
  const captured = await inputs.capture();
  const session = captured.parent.snapshots.find((entry) => entry.kind === "session-parent")!;
  expect(session.snapshot.draft).toBe("  retained draft  ");
  expect(composers.snapshots[0].snapshot.text).toBe("  retained draft  ");
  expect(captured.current()).toBe(true);
  expect(inputs.current()).toBe(true);
  expect(() => raw.assertCurrent()).not.toThrow();
  expect(composers.qualified).toBe(false);
});

it("captures an actual idle Btw after its Composer published a ref-only draft update", async () => {
  let btw!: BtwConversation;
  function Owner() {
    btw = useBtwConversation({
      parentSessionId: id,
      available: true,
      harness: "claude",
      blocks: [
        { id: "btw-idle-turn", role: "user", text: "first", durationMs: 1 },
        { id: "btw-idle-answer", role: "assistant", text: "done" },
      ],
      onSubmit: vi.fn(),
      onRetry: vi.fn(),
    });
    return createElement(BtwSheet, { btw, cwd: "/fixture", visible: true });
  }
  await act(async () => root.render(createElement(Owner)));
  await act(async () => btw.openWith("original side draft", { draft: true }));
  const child = btw.activeTabId!;
  await input(container.querySelector("textarea")!, "published side draft");
  const owner = {};
  let inputs!: NativeProducerInputClosure;
  let raw!: MountedComposerClosure;
  await act(async () => {
    inputs = beginNativeProducerInputClosure(id, { owner, timeoutMs: 5000 });
    producerClosures.push(inputs);
    raw = beginComposerClosure([child], { owner, timeoutMs: 5000 });
    rawClosures.push({ close: raw, owner });
  });
  const composers = await raw.captureAndFlush();
  const captured = await inputs.capture();
  expect(
    captured.parent.snapshots.find((entry) => entry.kind === "btw-parent")!.snapshot.draftTexts,
  ).toEqual({ [child]: "published side draft" });
  expect(composers.snapshots.find((entry) => entry.sessionId === child)!.snapshot.text).toBe(
    "published side draft",
  );
  expect(inputs.current()).toBe(true);
  expect(captured.current()).toBe(true);
  expect(() => raw.assertCurrent()).not.toThrow();
  clearComposerDraft(child);
});

it.each([
  ["ordinary message", "onSubmit", 3],
  ["/clear", "onSubmit", 3],
  ["/draft retained", "onSaveDraft", 2],
  ["/btw retained", "onBtwCommand", 1],
  ["/new", "onNewSession", 0],
  ["/resume", "onResumeProviderSession", 0],
  ["/compact", "onCompactContext", 0],
] as const)(
  "preserves ordinary open callback arguments for %s",
  async (text, callback, argumentCount) => {
    const effect = vi.fn(() => true);
    await composer({
      harness: "claude",
      initialDraft: text,
      canSaveDraft: true,
      [callback]: effect,
    });
    const field = container.querySelector("textarea")!;
    await act(async () =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      ),
    );
    expect(effect).toHaveBeenCalledOnce();
    expect(effect.mock.calls[0]).toHaveLength(argumentCount);
  },
);

it("holds an actual typed pending Composer React commit instead of masking the next changed snapshot", async () => {
  await pane();
  const field = container.querySelector("textarea")!;
  let closed!: ParentInputClosure;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field,
      "  typed pending  ",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
    closed = beginParentInputClosure(id, { owner: {}, timeoutMs: 5000 });
    inputClosures.push(closed);
  });
  expect(field.value).toBe("  typed pending  ");
  expect(closed.current()).toBe(false);
  await expect(closed.capture()).rejects.toThrow();
  await act(async () => closed.release());
  expect(field.value).toBe("  typed pending  ");
});

it.each([false, true])(
  "finishes one real accepted Send across the attachment wait and root wrapper (closed=%s)",
  async (closed) => {
    const first = vi.fn();
    const latest = vi.fn();
    await pane({ onSubmit: first });
    const read = await acceptedFileSend();
    expect(first).not.toHaveBeenCalled();
    await pane({ onSubmit: latest });
    let close: ParentInputClosure | undefined;
    if (closed) {
      close = await closeInputs();
      const owner = {};
      const raw = beginComposerClosure([id], { owner, timeoutMs: 5000 });
      rawClosures.push({ close: raw, owner });
      // New user work remains refused while both original gates are held.
      await act(async () =>
        read.field.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        ),
      );
    }
    await act(async () => read.finish());
    await vi.waitFor(() => expect(latest).toHaveBeenCalledOnce());
    expect(first).not.toHaveBeenCalled();
    expect(latest.mock.calls[0][0]).toBe(id);
    expect(latest.mock.calls[0][2]).toMatchObject([{ id: "accepted-file" }]);
    expect(read.field.value).toBe("");
    const raw = await captureParentInputs(id);
    expect(
      raw.snapshots.some(
        (entry) =>
          entry.snapshot.source === "composer-dispatch-intent" &&
          entry.snapshot.disposition === "accepted-unknown",
      ),
    ).toBe(true);
    if (close) expect(read.field.readOnly).toBe(true);
  },
);

it("rechecks current permission/worktree props before an accepted Send continuation and keeps its draft", async () => {
  const submit = vi.fn();
  await composer({ onSubmit: submit });
  const read = await acceptedFileSend();
  await composer({ onSubmit: submit, worktreeRemoved: true });
  await closeInputs();
  await act(async () => read.finish());
  expect(submit).not.toHaveBeenCalled();
  expect(read.field.value).toContain("retained draft");
  expect(container.textContent).toContain("The message was not sent");
});

it("retains an unknown original Send without turning Raw draft recovery into provider replay", async () => {
  const dispatched = vi.fn();
  const submit = vi.fn(() => {
    dispatched();
    throw new Error("fixture lost provider disposition");
  });
  await pane({ onSubmit: submit });
  const read = await acceptedFileSend();
  await closeInputs();
  const owner = {};
  const raw = beginComposerClosure([id], { owner, timeoutMs: 5000 });
  rawClosures.push({ close: raw, owner });
  await act(async () => read.finish());
  expect(dispatched).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("fixture lost provider disposition");
  const retained = await captureParentInputs(id);
  expect(
    retained.snapshots.some(
      (entry) =>
        entry.snapshot.source === "composer-dispatch-intent" &&
        entry.snapshot.disposition === "dispatching",
    ),
  ).toBe(true);
  await act(async () => raw.retryFailed(owner));
  expect(dispatched).toHaveBeenCalledOnce();
  expect(submit).toHaveBeenCalledOnce();
});

it("preserves an accepted Save draft continuation and disposition through the actual root sink", async () => {
  setComposerDraftMode(id, "save");
  const save = vi.fn();
  const submit = vi.fn();
  await pane({ onSaveDraft: save, onSubmit: submit });
  const read = await acceptedFileSend();
  await closeInputs();
  await act(async () => read.finish());
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0]).toBe(id);
  expect(save.mock.calls[0][2]).toMatchObject([{ id: "accepted-file" }]);
  expect(submit).not.toHaveBeenCalled();
  expect(read.field.value).toBe("");
  const retained = await captureParentInputs(id);
  expect(
    retained.snapshots.some(
      (entry) =>
        entry.snapshot.source === "composer-save-draft-intent" &&
        entry.snapshot.disposition === "accepted-unknown",
    ),
  ).toBe(true);
});

it("finishes an original delayed Btw child Send but refuses new closed work with original thread/root ownership", async () => {
  let btw!: BtwConversation;
  const sent = vi.fn();
  function Owner() {
    btw = useBtwConversation({
      parentSessionId: id,
      available: true,
      harness: "claude",
      blocks: [
        { id: "original-btw-turn", role: "user", text: "first", durationMs: 1 },
        { id: "original-btw-answer", role: "assistant", text: "done" },
      ],
      onSubmit: sent,
      onRetry: vi.fn(),
    });
    return createElement(BtwSheet, { btw, cwd: "/fixture", visible: true });
  }
  await act(async () => root.render(createElement(Owner)));
  await act(async () => btw.openWith("  retained side question  ", { draft: true }));
  const originalThread = btw.activeTabId;
  const read = await acceptedFileSend();
  await closeInputs();
  const owner = {};
  const raw = beginComposerClosure([originalThread!], { owner, timeoutMs: 5000 });
  rawClosures.push({ close: raw, owner });
  await act(async () => expect(btw.submit("denied new closed work")).toBe(false));
  await act(async () => read.finish([]));
  expect(sent).toHaveBeenCalledOnce();
  expect(sent.mock.calls[0][0][0].id).toBe("original-btw-turn");
  expect(sent.mock.calls[0][1]).toBe(originalThread);
  expect(sent.mock.calls[0][3]).toBe("retained side question");
  const retained = await captureParentInputs(id);
  expect(
    retained.snapshots.some(
      (entry) =>
        entry.snapshot.source === "btw-dispatch-intent" &&
        entry.snapshot.threadId === originalThread &&
        entry.snapshot.disposition === "accepted-unknown",
    ),
  ).toBe(true);
  expect(retained.snapshots.every((entry) => entry.sessionId === id)).toBe(true);
  clearComposerDraft(originalThread!);
});

it("does not resume an accepted Send into a reused foreign root", async () => {
  const submit = vi.fn();
  await composer({ onSubmit: submit });
  const read = await acceptedFileSend();
  await closeInputs();
  await composer({ sessionId: `${id}-foreign`, initialDraft: "foreign kept", onSubmit: submit });
  const foreign = container.querySelector("textarea")!;
  const before = foreign.value;
  await act(async () => read.finish());
  expect(submit).not.toHaveBeenCalled();
  expect(foreign.value).toBe(before);
});

it("admits the real workspace capture shortcut only while the standalone Composer is open", async () => {
  const change = vi.fn();
  await composer({
    cwd: "/fixture",
    draftWorkspace: true,
    workspaceMode: "worktree",
    worktreeBase: "main",
    onWorkspaceModeChange: change,
  });
  const field = container.querySelector("textarea")!;
  const shortcut = () =>
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "g",
        code: "KeyG",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  await act(async () => shortcut());
  expect(change).toHaveBeenCalledExactlyOnceWith("current", undefined);
  await closeInputs();
  await act(async () => shortcut());
  expect(change).toHaveBeenCalledOnce();
});

function dragRows() {
  const handles = [...container.querySelectorAll<HTMLElement>("[data-queue-handle]")];
  expect(handles).toHaveLength(3);
  for (const [index, handle] of handles.entries()) {
    const row = handle.parentElement!;
    const captured = new Set<number>();
    row.getBoundingClientRect = () => ({
      x: 0,
      y: index * 32,
      left: 0,
      right: 300,
      width: 300,
      top: index * 32,
      bottom: index * 32 + 32,
      height: 32,
      toJSON: () => ({}),
    });
    row.setPointerCapture = (pointerId) => {
      captured.add(pointerId);
    };
    row.hasPointerCapture = (pointerId) => captured.has(pointerId);
    row.releasePointerCapture = (pointerId) => {
      captured.delete(pointerId);
    };
  }
  const pointer = (target: EventTarget, type: string, y: number) =>
    target.dispatchEvent(
      Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
        pointerId: 9,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        pointerType: "mouse",
        clientX: 10,
        clientY: y,
      }),
    );
  return {
    down: () => pointer(handles[0], "pointerdown", 16),
    up: () => pointer(window, "pointerup", 80),
    cancel: () => pointer(window, "pointercancel", 80),
    move: () => pointer(window, "pointermove", 80),
  };
}

const queued = ["queue-a", "queue-b", "queue-c"].map((messageId) => ({
  id: messageId,
  text: messageId,
  attachments: [],
}));
it.each(["before-release", "settling", "open"])(
  "retains the actual animated queue commit through the latest root callback (%s)",
  async (timing) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    document.documentElement.style.setProperty("--motion-reorder-duration", "200ms");
    const first = vi.fn();
    const latest = vi.fn();
    const session = { ...newSession("codex", "/fixture", ""), id, queuedMessages: queued };
    await pane({ session, onReorderQueuedMessages: first });
    const drag = dragRows();
    await act(async () => {
      drag.down();
      drag.move();
    });
    if (timing === "before-release") await closeInputs();
    await act(async () => drag.up());
    expect(first).not.toHaveBeenCalled();
    if (timing === "settling") await closeInputs();
    let settled = false;
    let published = false;
    const close = inputClosures.at(-1);
    const observed = close?.capture().then(
      (lease) => {
        published = true;
        settled = true;
        leases.push(lease);
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    if (close) {
      expect(published).toBe(false);
      // External React/producer changes can honestly hold this observation;
      // neither a hold nor pointerup may discard the original delayed effect.
      if (settled) expect(close.current()).toBe(false);
    }
    await pane({
      session: {
        ...session,
        queuedMessages: queued.map((message) => ({ ...message, text: `${message.text} latest` })),
      },
      onReorderQueuedMessages: latest,
    });
    await act(async () => vi.advanceTimersByTime(200));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith(id, ["queue-b", "queue-c", "queue-a"]);
    await observed;
  },
);

it("cancels a real old queue drag without commit and invalidates rather than certifying it", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  document.documentElement.style.setProperty("--motion-reorder-duration", "200ms");
  const reorder = vi.fn();
  await composer({ queuedMessages: queued, onReorderQueuedMessages: reorder });
  const drag = dragRows();
  await act(async () => {
    drag.down();
    drag.move();
  });
  const close = await closeInputs();
  await act(async () => drag.cancel());
  await act(async () => vi.advanceTimersByTime(200));
  expect(reorder).not.toHaveBeenCalled();
  expect(close.current()).toBe(false);
  await expect(close.capture()).rejects.toThrow();
});

it("keeps the standalone open drag callback's one public argument", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  document.documentElement.style.setProperty("--motion-reorder-duration", "200ms");
  const reorder = vi.fn();
  await composer({ queuedMessages: queued, onReorderQueuedMessages: reorder });
  const drag = dragRows();
  await act(async () => {
    drag.down();
    drag.move();
    drag.up();
  });
  await act(async () => vi.advanceTimersByTime(200));
  expect(reorder).toHaveBeenCalledExactlyOnceWith(["queue-b", "queue-c", "queue-a"]);
});

it("never forwards a settling queue drag into a reused foreign root", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  document.documentElement.style.setProperty("--motion-reorder-duration", "200ms");
  const original = vi.fn();
  const foreign = vi.fn();
  const session = { ...newSession("codex", "/fixture", ""), id, queuedMessages: queued };
  await pane({ session, onReorderQueuedMessages: original });
  const drag = dragRows();
  await act(async () => {
    drag.down();
    drag.move();
    drag.up();
  });
  const close = await closeInputs();
  await pane({ session: { ...session, id: `${id}-foreign` }, onReorderQueuedMessages: foreign });
  await act(async () => vi.advanceTimersByTime(200));
  expect(original).not.toHaveBeenCalled();
  expect(foreign).not.toHaveBeenCalled();
  expect(close.current()).toBe(false);
});

it("captures the real question DOM and retained same-target draft through unmount/discard", async () => {
  const reply = vi.fn();
  await act(async () =>
    root.render(
      createElement(QuestionForm, {
        prompt: question,
        draftScope: id,
        parentSessionId: id,
        onReply: reply,
      }),
    ),
  );
  const field = container.querySelector("textarea")!;
  await input(field, "  exact answer \n");
  const lease = await captureParentInputs(id);
  expect(lease.snapshots.filter((entry) => entry.kind === "question-draft")).toHaveLength(2);
  expect(
    lease.snapshots.find((entry) => entry.snapshot.source === "retained-question-draft")!.snapshot
      .draft,
  ).toMatchObject({ custom: { answer: "  exact answer \n" } });
  field.value = "silent DOM replacement";
  expect(lease.current()).toBe(false);
  await act(async () => root.render(null));
  const retained = await captureParentInputs(id);
  expect(retained.snapshots).toHaveLength(1);
  expect(retained.snapshots[0].snapshot.prompt).toMatchObject({
    providerTurnId: "original-provider-turn",
    callId: "original-provider-call",
  });
  discardQuestionDraft(id, question);
  expect(retained.current()).toBe(false);
  expect((await captureParentInputs(id)).snapshots).toEqual([]);
  expect(reply).not.toHaveBeenCalled();
});

it("keeps cache namespaces separate from logical ownership and invalidates retained ABA writes", async () => {
  associateQuestionDraft(`${id}:remote-key`, question, id);
  associateQuestionDraft("foreign-cache", question, "foreign-session");
  writeQuestionDraft(`${id}:remote-key`, question, {
    step: 0,
    answers: {},
    custom: { answer: "" },
    delivery: undefined,
  });
  writeQuestionDraft("foreign-cache", question, {
    step: 0,
    answers: {},
    custom: { answer: "foreign secret" },
  });
  const lease = await captureParentInputs(id);
  expect(lease.snapshots).toHaveLength(1);
  expect(Object.prototype.hasOwnProperty.call(lease.snapshots[0].snapshot.draft, "delivery")).toBe(
    true,
  );
  writeQuestionDraft(`${id}:remote-key`, question, {
    step: 0,
    answers: {},
    custom: { answer: "changed" },
  });
  writeQuestionDraft(`${id}:remote-key`, question, {
    step: 0,
    answers: {},
    custom: { answer: "" },
    delivery: undefined,
  });
  expect(lease.current()).toBe(false);
  discardQuestionDraft(`${id}:remote-key`, question);
  discardQuestionDraft("foreign-cache", question);
});

it("does not retarget a retained cache entry when its namespace is reused by another root", async () => {
  const cache = `${id}:conflicting-cache`;
  const stop = associateQuestionDraft(cache, question, id);
  writeQuestionDraft(cache, question, {
    step: 0,
    answers: {},
    custom: { answer: "original root" },
  });
  const first = await captureParentInputs(id);
  associateQuestionDraft(cache, question, "another-root");
  expect(first.current()).toBe(false);
  expect((await captureParentInputs("another-root")).snapshots).toEqual([]);
  expect((await captureParentInputs(id)).snapshots).toEqual([]);
  expect((await captureParentInputs(id)).missingCoverage).toContain(
    "unassigned-parent-input-scope",
  );
  discardQuestionDraft(cache, question);
  stop?.();
});

it("holds real question IME without answering or changing the normal draft", async () => {
  const reply = vi.fn();
  await act(async () =>
    root.render(
      createElement(QuestionForm, {
        prompt: question,
        parentSessionId: id,
        onReply: reply,
      }),
    ),
  );
  const field = container.querySelector("textarea")!;
  const lease = await captureParentInputs(id);
  field.dispatchEvent(new Event("compositionstart", { bubbles: true }));
  expect(lease.current()).toBe(false);
  await expect(captureParentInputs(id)).rejects.toThrow("composing");
  field.dispatchEvent(new Event("compositionend", { bubbles: true }));
  expect((await captureParentInputs(id)).current()).toBe(true);
  expect(reply).not.toHaveBeenCalled();
});

it("retains an actual unknown question dispatch without resending on remount", async () => {
  const reply = vi.fn(() => {
    throw new Error("lost decision reply");
  });
  const props = { prompt: question, draftScope: id, parentSessionId: id, onReply: reply };
  await act(async () => root.render(createElement(QuestionForm, props)));
  await input(container.querySelector("textarea")!, "  unknown answer  ");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await act(async () => root.render(null));
  const lease = await captureParentInputs(id);
  expect(lease.snapshots[0].snapshot.draft).toMatchObject({
    delivery: "unknown",
    pendingAction: "answer",
    custom: { answer: "  unknown answer  " },
  });
  await act(async () => root.render(createElement(QuestionForm, props)));
  expect(lease.current()).toBe(false);
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(reply).toHaveBeenCalledTimes(1);
});

it("keeps an actual queue attachment preparation owned after retirement until it settles", async () => {
  let finish!: (files: Attachment[]) => void;
  ports.picker.mockImplementation(
    () =>
      new Promise<Attachment[]>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    root.render(
      createElement(QueuedMessageEditDialog, {
        parentSessionId: id,
        message: {
          id: "original-queue",
          text: "  queue draft  ",
          attachments: [],
        },
        canAttach: true,
        onSave: vi.fn(),
        onRemove: vi.fn(),
        onCancel: vi.fn(),
      }),
    ),
  );
  const before = await captureParentInputs(id);
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>('[aria-label="Add files or images"]')!.click(),
  );
  expect(before.current()).toBe(false);
  await act(async () => root.render(null));
  const pending = await captureParentInputs(id);
  expect(pending.snapshots).toHaveLength(1);
  expect(pending.snapshots[0].snapshot).toMatchObject({
    source: "queue-edit-attachment-preparation",
    messageId: "original-queue",
    status: "pending",
  });
  await act(async () => finish([]));
  expect(pending.current()).toBe(false);
  expect((await captureParentInputs(id)).snapshots).toEqual([]);
});

it("retains the original queue save after a callback dispatches then throws without retrying", async () => {
  const dispatched: string[] = [];
  const save = vi.fn((text: string) => {
    dispatched.push(text);
    throw new Error("reply lost after dispatch");
  });
  await act(async () =>
    root.render(
      createElement(QueuedMessageEditDialog, {
        parentSessionId: id,
        message: { id: "queue-dispatched-once", text: "  original queue input  ", attachments: [] },
        canAttach: true,
        onSave: save,
        onRemove: vi.fn(),
        onCancel: vi.fn(),
      }),
    ),
  );
  const button = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.title === "Save (Ctrl/Cmd+Enter)",
  )!;
  await act(async () => button.click());
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
    "reply lost after dispatch",
  );
  expect(document.body.querySelector("textarea")!.value).toBe("  original queue input  ");
  expect(save).toHaveBeenCalledTimes(1);
  expect(dispatched).toHaveLength(1);
  await act(async () => root.render(null));
  const retained = await captureParentInputs(id);
  expect(retained.snapshots).toHaveLength(1);
  expect(retained.snapshots[0].snapshot).toMatchObject({
    source: "queue-edit-save-intent",
    disposition: "dispatch-unknown",
    message: { id: "queue-dispatched-once", text: "  original queue input  " },
    draft: { text: "  original queue input  " },
  });
  expect(retained.missingCoverage).toContain("decision-conservation");
  expect(save).toHaveBeenCalledTimes(1);
});

it("captures actual Composer parent inputs and invalidates silent DOM, model ABA and IME", async () => {
  await composer({
    quoteRequest: { id: 91, text: "  quote  ", mode: "append" },
  });
  const field = container.querySelector("textarea")!;
  const lease = await captureParentInputs(id);
  expect(lease.snapshots.find((entry) => entry.kind === "composer-parent")!.snapshot).toMatchObject(
    {
      composerSessionId: id,
      initialDraft: "  retained draft  ",
      planSelected: false,
      operatorSelected: false,
      orchestrationSelected: false,
    },
  );
  field.value += "silent";
  expect(lease.current()).toBe(false);
  await composer({ model: "other" });
  const changed = await captureParentInputs(id);
  await composer({ model: "" });
  expect(changed.current()).toBe(false);
  field.dispatchEvent(new Event("compositionstart", { bubbles: true }));
  await expect(captureParentInputs(id)).rejects.toThrow("composing");
  field.dispatchEvent(new Event("compositionend", { bubbles: true }));
});

it("retains actual Composer dispatch bytes through synchronous retirement and a late rejection", async () => {
  let rejectSend!: () => boolean;
  const onSubmit = vi.fn((_text, _files, options) => {
    rejectSend = options.onSendRejected;
    root.render(null);
  });
  await composer({ onSubmit });
  const field = container.querySelector("textarea")!;
  await act(async () =>
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(onSubmit).toHaveBeenCalledTimes(1);
  const retained = await captureParentInputs(id);
  expect(retained.snapshots).toHaveLength(1);
  expect(retained.snapshots[0].snapshot).toMatchObject({
    source: "composer-dispatch-intent",
    rawText: "  retained draft  ",
    disposition: "accepted-unknown",
  });
  expect(rejectSend()).toBe(false);
  expect(retained.current()).toBe(false);
  expect((await captureParentInputs(id)).snapshots[0].snapshot.disposition).toBe(
    "late-send-rejection",
  );
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it("captures inactive Btw drafts under the root while retaining original child identifiers", async () => {
  let btw!: BtwConversation;
  const submit = vi.fn();
  function Owner() {
    btw = useBtwConversation({
      parentSessionId: id,
      available: true,
      blocks: [
        { id: "u", role: "user", text: "first", durationMs: 1000 },
        { id: "a", role: "assistant", text: "done" },
      ],
      harness: "claude",
      onSubmit: submit,
      onRetry: vi.fn(),
    });
    return null;
  }
  await act(async () => root.render(createElement(Owner)));
  await act(async () => {
    btw.openWith("  inactive one  ", { draft: true });
  });
  const firstChild = btw.activeTabId!;
  await act(async () => {
    btw.openWith("  inactive two  ", { draft: true });
  });
  const secondChild = btw.activeTabId!;
  expect(secondChild).not.toBe(firstChild);
  const lease = await captureParentInputs(id);
  expect(lease.snapshots[0].snapshot.draftTexts).toEqual({
    [firstChild]: "  inactive one  ",
    [secondChild]: "  inactive two  ",
  });
  expect(lease.missingCoverage).toContain("nested-btw-input-scope");
  btw.changeDraft("later");
  expect(lease.current()).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});

it("captures the actual SessionPane one-shot seed without copying the Session DTO", async () => {
  const noop = () => {};
  const session = {
    ...newSession("codex", "/fixture", ""),
    id,
    composerSeed: "  one-shot seed  ",
    privateSentinel: "not-a-producer-field",
  };
  await act(async () =>
    root.render(
      createElement(SessionPane, {
        session,
        visible: true,
        focused: false,
        inSplit: false,
        composerFocused: false,
        recents: [],
        onFocus: noop,
        onClose: noop,
        onCwdChange: noop,
        onBranchChange: noop,
        onModelChange: noop,
        onModelSettingsChange: noop,
        onRuntimeModeChange: noop,
        onWorkspaceModeChange: noop,
        onWorktreeBaseChange: noop,
        onSubmit: noop,
        onSaveDraft: noop,
        onRemoveDraft: noop,
        onStop: noop,
        onCompactContext: () => false,
        onPlaceSessionInFolder: noop,
        onDeleteQueuedMessage: noop,
        onEditQueuedMessage: noop,
        onQueuedMessageEditingChange: noop,
        onSteerQueuedMessage: noop,
        onResumeQueue: noop,
        onUsageLimitResumeAtReset: noop,
        onUsageLimitDismiss: noop,
        onApproval: noop,
        onQuestionReply: noop,
        onOpenFile: noop,
        onOpenDiff: noop,
        onOpenPlan: noop,
        onBuildPlan: noop,
        onNewTerminal: noop,
      }),
    ),
  );
  const lease = await captureParentInputs(id);
  const parent = lease.snapshots.find((entry) => entry.kind === "session-parent")!;
  expect(parent.snapshot.composerSeed).toBe("  one-shot seed  ");
  expect(Object.prototype.hasOwnProperty.call(parent.snapshot, "draft")).toBe(true);
  expect(parent.snapshot).not.toHaveProperty("privateSentinel");
  expect(parent.snapshot).not.toHaveProperty("blocks");
  expect(lease.snapshots.some((entry) => entry.kind === "composer-parent")).toBe(true);
});

it("captures the actual nested skill name/scope and preserves original input after accepted creation", async () => {
  const create = vi.fn(() => root.render(null));
  await act(async () =>
    root.render(
      createElement(CreateSkillForm, {
        parentSessionId: id,
        query: "",
        cwd: "/fixture",
        onCancel: vi.fn(),
        onCreate: create,
      }),
    ),
  );
  const field = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      field,
      "  my-skill  ",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const before = await captureParentInputs(id);
  expect(before.snapshots[0].snapshot).toMatchObject({
    source: "create-skill-form",
    rawName: "  my-skill  ",
    scope: "project",
  });
  field.dispatchEvent(new Event("compositionstart", { bubbles: true }));
  await expect(captureParentInputs(id)).rejects.toThrow("composing");
  field.dispatchEvent(new Event("compositionend", { bubbles: true }));
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(create).toHaveBeenCalledExactlyOnceWith("my-skill", "project");
  const retained = await captureParentInputs(id);
  expect(retained.snapshots).toHaveLength(1);
  expect(retained.snapshots[0].snapshot).toMatchObject({
    source: "create-skill-intent",
    rawName: "  my-skill  ",
    disposition: "accepted-unknown",
  });
  expect(before.current()).toBe(false);
});
