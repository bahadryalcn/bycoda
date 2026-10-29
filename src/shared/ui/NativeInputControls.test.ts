// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InlineEdit } from "./InlineEdit";
import { TagInput } from "./TagInput";
import {
  issueNativeInputPublication,
  type NativeInputPublication,
} from "../lib/native-input-observer";
import {
  createNotesInputClosure,
  type NotesInputClosure,
} from "../../features/notes/notesInputClosure";
import type {
  NativeInputObserver,
  NativeInputRead,
  NativeInputRegistration,
  NativeInputWork,
} from "../lib/native-input-observer";

let root: Root;
let container: HTMLDivElement;
const gates: NotesInputClosure[] = [];
const settle: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    for (const end of settle.splice(0)) end();
  });
  await act(async () => root.unmount());
  for (const gate of gates.splice(0)) gate.release();
  container.remove();
  vi.unstubAllGlobals();
});
function observed() {
  const registry = createNotesInputClosure();
  const retired: NativeInputRead[] = [];
  let registration!: NativeInputRegistration;
  const observer: NativeInputObserver = {
    attach(read, controls) {
      const actual = registry.register(read, controls);
      registration = actual;
      return {
        ...actual,
        unregister() {
          retired.push(read());
          actual.unregister();
        },
      };
    },
  };
  return { registry, observer, retired, registration: () => registration };
}
async function inline(observer: NativeInputObserver, save = vi.fn(), value = "Saved title") {
  await act(async () =>
    root.render(
      createElement(InlineEdit, { label: "Title", value, onSave: save, inputObserver: observer }),
    ),
  );
  return save;
}
async function type(text: string) {
  const field = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return field;
}
async function edit(text: string) {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="Title:"]')!.click(),
  );
  return type(text);
}
function key(field: HTMLElement, value: string) {
  field.dispatchEvent(
    new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
  );
}
async function close(registry: ReturnType<typeof createNotesInputClosure>) {
  let gate!: NotesInputClosure;
  await act(async () => {
    gate = registry.beginNotesInputClosure("root", { owner: {}, timeoutMs: 5000 });
    gates.push(gate);
  });
  return gate;
}

it("captures exact InlineEdit raw whitespace, preserves focus/selection and refuses new closed save/cancel/blur", async () => {
  const owner = observed();
  const save = await inline(owner.observer);
  const field = await edit("  \t untouched title  ");
  field.focus();
  field.setSelectionRange(2, 7);
  const gate = await close(owner.registry);
  expect(field.readOnly).toBe(true);
  expect(field.matches(":disabled")).toBe(false);
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(2);
  const captured = await gate.capture();
  expect(captured.snapshots[0].snapshot.draft).toBe("  \t untouched title  ");
  await act(async () => {
    key(field, "Enter");
    key(field, "Escape");
    field.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
    );
  });
  expect(save).not.toHaveBeenCalled();
  expect(container.querySelector("input")).toBe(field);
  expect(field.value).toBe("  \t untouched title  ");
  expect(captured.current()).toBe(true);
});

it("admits InlineEdit before deferred onSave and waits for the true returned Promise and its child", async () => {
  const owner = observed();
  let finish!: () => void;
  const result = new Promise<void>((resolve) => {
    finish = resolve;
  });
  settle.push(() => finish());
  let child: NativeInputWork | null = null;
  const save = vi.fn((next: string) => {
    expect(next).toBe("Exact title");
    child = owner.registration().operation("actual-native-save");
    expect(child).not.toBeNull();
    return result.finally(() => child?.());
  });
  await inline(owner.observer, save);
  const field = await edit("  Exact title  ");
  let gate!: NotesInputClosure;
  await act(async () => {
    key(field, "Enter");
    expect(save).not.toHaveBeenCalled();
    gate = owner.registry.beginNotesInputClosure("root", { owner: {}, timeoutMs: 5000 });
    gates.push(gate);
  });
  expect(save).toHaveBeenCalledExactlyOnceWith("Exact title");
  expect(owner.registration().operation("fresh-closed")).toBeNull();
  let complete = false;
  const pending = gate.capture().then((lease) => {
    complete = true;
    return lease;
  });
  await Promise.resolve();
  expect(complete).toBe(false);
  await act(async () => finish());
  const captured = await pending;
  expect(captured.current()).toBe(true);
  expect(captured.snapshots[0].snapshot).toMatchObject({
    phase: "saved",
    shown: "Exact title",
    committed: "Exact title",
    pendingInput: null,
  });
  expect(save).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Exact title");
});

it("captures the exact canonical InlineEdit view after an attested pre-Native state echo and actual outcome commit", async () => {
  const owner = observed();
  let finish!: () => void;
  const saved = new Promise<void>((resolve) => {
    finish = resolve;
  });
  settle.push(() => finish());
  const acknowledged = vi.fn();
  function Owner() {
    const [title, setTitle] = useState<{ value: string; publication?: NativeInputPublication }>({
      value: "Saved title",
    });
    return createElement(InlineEdit, {
      label: "Title",
      value: title.value,
      inputObserver: owner.observer,
      inputPublication: title.publication,
      onSave: (next) => {
        const original = owner.registration().operation("real-state-publication")!;
        const publication = issueNativeInputPublication({
          target: owner.observer,
          value: next,
          current: () => true,
          apply: (callback) => original.apply(callback),
          committed: () => {
            acknowledged();
            original();
          },
        });
        setTitle({ value: next, publication });
        return saved;
      },
    });
  }
  await act(async () => root.render(createElement(Owner)));
  const field = await edit("  canonical accepted  ");
  let gate!: NotesInputClosure;
  await act(async () => {
    key(field, "Enter");
    gate = owner.registry.beginNotesInputClosure("root", { owner: {}, timeoutMs: 5000 });
    gates.push(gate);
  });
  expect(acknowledged).toHaveBeenCalledOnce();
  let done = false;
  const pending = gate.capture().then((lease) => {
    done = true;
    return lease;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  await act(async () => finish());
  const captured = await pending;
  expect(captured.current()).toBe(true);
  expect(captured.snapshots[0].snapshot).toMatchObject({
    value: "canonical accepted",
    committed: "canonical accepted",
    shown: "canonical accepted",
    phase: "saved",
    draft: "  canonical accepted  ",
    pendingInput: null,
  });
});

it("invalidates an unmarked same-scope InlineEdit value echo instead of whitelisting the next value", async () => {
  const owner = observed();
  function Owner() {
    const [title, setTitle] = useState("Saved title");
    return createElement(InlineEdit, {
      label: "Title",
      value: title,
      inputObserver: owner.observer,
      onSave: async (next) => {
        setTitle(next);
      },
    });
  }
  await act(async () => root.render(createElement(Owner)));
  const field = await edit("  unmarked echo  ");
  let gate!: NotesInputClosure;
  await act(async () => {
    key(field, "Enter");
    gate = owner.registry.beginNotesInputClosure("root", { owner: {}, timeoutMs: 5000 });
    gates.push(gate);
  });
  await expect(gate.capture()).rejects.toThrow();
  expect(gate.current()).toBe(false);
});

it("waits for an exact no-write InlineEdit result commit before capture", async () => {
  const owner = observed();
  const save = await inline(owner.observer);
  const field = await edit("  Saved title  ");
  let gate!: NotesInputClosure;
  await act(async () => {
    key(field, "Enter");
    gate = owner.registry.beginNotesInputClosure("root", { owner: {}, timeoutMs: 5000 });
    gates.push(gate);
  });
  const captured = await gate.capture();
  expect(captured.current()).toBe(true);
  expect(save).not.toHaveBeenCalled();
  expect(captured.snapshots[0].snapshot).toMatchObject({
    draft: "  Saved title  ",
    editing: false,
    shown: "Saved title",
  });
});

it("keeps a validation result owned until its actual InlineEdit layout commits", async () => {
  const owner = observed();
  const save = vi.fn();
  await act(async () =>
    root.render(
      createElement(InlineEdit, {
        label: "Title",
        value: "Saved title",
        onSave: save,
        validate: () => "Invalid title",
        inputObserver: owner.observer,
      }),
    ),
  );
  const field = await edit("  invalid exact  ");
  let gate!: NotesInputClosure;
  await act(async () => {
    key(field, "Enter");
    gate = owner.registry.beginNotesInputClosure("root", { owner: {}, timeoutMs: 5000 });
    gates.push(gate);
  });
  const captured = await gate.capture();
  expect(captured.current()).toBe(true);
  expect(save).not.toHaveBeenCalled();
  expect(captured.snapshots[0].snapshot).toMatchObject({
    draft: "  invalid exact  ",
    editing: true,
    error: "Invalid title",
  });
});

it("keeps an accepted InlineEdit callback after detach and freezes final data without late DOM reads", async () => {
  const owner = observed();
  let finish!: () => void;
  const result = new Promise<void>((resolve) => {
    finish = resolve;
  });
  settle.push(() => finish());
  const save = vi.fn(() => result);
  await inline(owner.observer, save);
  const field = await edit("  retired input  ");
  await act(async () => {
    key(field, "Enter");
    root.render(null);
  });
  expect(save).toHaveBeenCalledExactlyOnceWith("retired input");
  expect(owner.retired).toHaveLength(0);
  expect(() =>
    owner.registry.beginNotesInputClosure("root", { owner: {}, timeoutMs: 1000 }),
  ).toThrow();
  await act(async () => finish());
  expect(owner.retired).toHaveLength(1);
  expect(owner.retired[0].snapshot).toMatchObject({
    draft: "  retired input  ",
    phase: "saved",
    pendingInput: null,
  });
  expect(owner.retired[0].busy).toBeUndefined();
});

it("does not apply an old InlineEdit result into another logical observer's reused position", async () => {
  const original = observed();
  const foreign = observed();
  let finish!: () => void;
  const result = new Promise<void>((resolve) => {
    finish = resolve;
  });
  settle.push(() => finish());
  const save = vi.fn(() => result);
  const other = vi.fn();
  await inline(original.observer, save);
  const field = await edit("  original accepted  ");
  await act(async () => key(field, "Enter"));
  await inline(foreign.observer, other, "Foreign exact title");
  await act(async () => finish());
  expect(container.textContent).toContain("Foreign exact title");
  expect(other).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledExactlyOnceWith("original accepted");
  expect(original.retired[0].snapshot.draft).toBe("  original accepted  ");
});

it("retains the latest original-scope external title when a detached save completes", async () => {
  const owner = observed();
  let finish!: () => void;
  const result = new Promise<void>((resolve) => {
    finish = resolve;
  });
  settle.push(() => finish());
  const save = vi.fn(() => result);
  await inline(owner.observer, save);
  const field = await edit("  original user input  ");
  await act(async () => key(field, "Enter"));
  await inline(owner.observer, save, "Authoritative external title");
  await act(async () => root.render(null));
  await act(async () => finish());
  expect(owner.retired[0].snapshot).toMatchObject({
    value: "Authoritative external title",
    committed: "Authoritative external title",
    shown: "Authoritative external title",
    draft: "  original user input  ",
  });
});

it("preflights real IME before InlineEdit close and never forces a commit", async () => {
  const owner = observed();
  const save = await inline(owner.observer);
  const field = await edit("入力中");
  await act(async () =>
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
  );
  expect(() =>
    owner.registry.beginNotesInputClosure("root", { owner: {}, timeoutMs: 1000 }),
  ).toThrow();
  expect(field.readOnly).toBe(false);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Save Title"]')!.click(),
  );
  expect(save).not.toHaveBeenCalled();
  expect(field.value).toBe("入力中");
});

it("keeps failed InlineEdit raw input and blocks fresh closed retry", async () => {
  const owner = observed();
  const save = vi.fn(async () => {
    throw new Error("actual save error");
  });
  await inline(owner.observer, save);
  const field = await edit("  failed exact  ");
  await act(async () => key(field, "Enter"));
  const gate = await close(owner.registry);
  const captured = await gate.capture();
  expect(captured.snapshots[0].snapshot).toMatchObject({
    draft: "  failed exact  ",
    failed: "failed exact",
    phase: "failed",
  });
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Try again")!
      .click(),
  );
  expect(container.querySelector("input")).toBeNull();
  expect(save).toHaveBeenCalledOnce();
  expect(captured.current()).toBe(true);
});

it("holds InlineEdit work capacity visibly while keeping raw draft edits usable", async () => {
  const owner = observed();
  const save = await inline(owner.observer);
  const field = await edit("  first  ");
  const busy = Array.from({ length: 16 }, () => owner.registration().operation("existing")!);
  settle.push(() => busy.forEach((work) => work()));
  await type("  capacity kept  ");
  await act(async () => key(field, "Enter"));
  expect(save).not.toHaveBeenCalled();
  expect(field.value).toBe("  capacity kept  ");
  expect(container.textContent).toContain("input limit");
  expect(container.textContent).not.toContain("preparing");
});

it("captures exact uncommitted TagInput text and gates Enter/comma/remove/blur without losing selection", async () => {
  const owner = observed();
  const changes = vi.fn();
  await act(async () =>
    root.render(
      createElement(TagInput, {
        label: "Tags",
        defaultValue: ["existing"],
        onValueChange: changes,
        inputObserver: owner.observer,
      }),
    ),
  );
  const field = await type("  pending tag  ");
  field.focus();
  field.setSelectionRange(2, 7);
  const gate = await close(owner.registry);
  const captured = await gate.capture();
  expect(captured.snapshots[0].snapshot).toMatchObject({
    tags: ["existing"],
    draft: "  pending tag  ",
  });
  expect(field.readOnly).toBe(true);
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(2);
  await act(async () => {
    key(field, "Enter");
    key(field, ",");
    container.querySelector<HTMLButtonElement>('button[aria-label="Remove existing"]')!.click();
    field.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
    );
  });
  expect(changes).not.toHaveBeenCalled();
  expect(field.value).toBe("  pending tag  ");
  expect(captured.current()).toBe(true);
});

it("preserves external TagInput values and invalidates a closed observation", async () => {
  const owner = observed();
  const props = { label: "Tags", inputObserver: owner.observer, onValueChange: vi.fn() };
  await act(async () => root.render(createElement(TagInput, { ...props, value: ["first"] })));
  await type("  local raw  ");
  const gate = await close(owner.registry);
  await gate.capture();
  await act(async () => root.render(createElement(TagInput, { ...props, value: ["external"] })));
  expect(container.textContent).toContain("external");
  expect(container.querySelector("input")!.value).toBe("  local raw  ");
  expect(gate.current()).toBe(false);
  expect(props.onValueChange).not.toHaveBeenCalled();
});

it("preflights TagInput composition before changing readonly and preserves native beforeinput gating", async () => {
  const owner = observed();
  await act(async () =>
    root.render(createElement(TagInput, { label: "Tags", inputObserver: owner.observer })),
  );
  const field = await type("入力中");
  await act(async () =>
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
  );
  expect(() =>
    owner.registry.beginNotesInputClosure("root", { owner: {}, timeoutMs: 1000 }),
  ).toThrow();
  expect(field.readOnly).toBe(false);
  await act(async () =>
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
  );
  await close(owner.registry);
  const event = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: "x",
  });
  field.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(field.value).toBe("入力中");
});

it("preserves the ordinary observed TagInput callback's one normalized public argument", async () => {
  const owner = observed();
  const changes = vi.fn();
  await act(async () =>
    root.render(
      createElement(TagInput, {
        label: "Tags",
        onValueChange: changes,
        inputObserver: owner.observer,
      }),
    ),
  );
  const field = await type("  normal  ");
  await act(async () => key(field, "Enter"));
  expect(changes).toHaveBeenCalledExactlyOnceWith(["normal"]);
  expect(field.value).toBe("");
});

it("captures a pre-close accepted TagInput mutation only after its exact internal React batch commits", async () => {
  const owner = observed();
  const change = vi.fn();
  await act(async () =>
    root.render(
      createElement(TagInput, {
        label: "Tags",
        inputObserver: owner.observer,
        onValueChange: change,
      }),
    ),
  );
  const field = await type("  committed tag  ");
  let gate!: NotesInputClosure;
  await act(async () => {
    key(field, "Enter");
    gate = owner.registry.beginNotesInputClosure("root", { owner: {}, timeoutMs: 5000 });
    gates.push(gate);
  });
  const captured = await gate.capture();
  expect(captured.current()).toBe(true);
  expect(change).toHaveBeenCalledExactlyOnceWith(["committed tag"]);
  expect(captured.snapshots[0].snapshot).toMatchObject({
    tags: ["committed tag"],
    draft: "",
    stateDraft: "",
  });
});

it("keeps the exact TagInput comma draft and normal edits when accepted work capacity is full", async () => {
  const owner = observed();
  const changes = vi.fn();
  await act(async () =>
    root.render(
      createElement(TagInput, {
        label: "Tags",
        onValueChange: changes,
        inputObserver: owner.observer,
      }),
    ),
  );
  const busy = Array.from({ length: 16 }, () => owner.registration().operation("existing")!);
  settle.push(() => busy.forEach((work) => work()));
  const field = await type("  kept tag  ,");
  expect(changes).not.toHaveBeenCalled();
  expect(field.value).toBe("  kept tag  ,");
  expect(container.textContent).toContain("input limit");
  await type("  still editable  ");
  expect(field.value).toBe("  still editable  ");
});

it("retains an accepted TagInput callback through its true Promise and exact view without an await-wide permit", async () => {
  const owner = observed();
  let finish!: () => void;
  const actual = new Promise<void>((resolve) => {
    finish = resolve;
  });
  settle.push(() => finish());
  const change = vi.fn(async () => {
    await actual;
    expect(owner.registration().operation("fresh-after-await")).toBeNull();
  });
  await act(async () =>
    root.render(
      createElement(TagInput, {
        label: "Tags",
        inputObserver: owner.observer,
        onValueChange: change,
      }),
    ),
  );
  const field = await type("  original async tag  ");
  await act(async () => key(field, "Enter"));
  const gate = await close(owner.registry);
  let finished = false;
  const captured = gate.capture().then((data) => {
    finished = true;
    return data;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(finished).toBe(false);
  expect(change).toHaveBeenCalledExactlyOnceWith(["original async tag"]);
  await act(async () => {
    key(field, "Enter");
    key(field, ",");
  });
  expect(change).toHaveBeenCalledOnce();
  await act(async () => finish());
  const data = await captured;
  expect(data.current()).toBe(true);
  expect(gate.current()).toBe(true);
  expect(data.snapshots[0].snapshot).toMatchObject({
    tags: ["original async tag"],
    draft: "",
    acceptedChanges: [],
  });
  data.release();
});

it("keeps exact controlled TagInput request bytes after async rejection and ACKs the real error layout without replay", async () => {
  const owner = observed();
  let reject!: (error: Error) => void;
  const actual = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  settle.push(() => reject(new Error("cleanup")));
  const change = vi.fn(() => actual);
  await act(async () =>
    root.render(
      createElement(TagInput, {
        label: "Tags",
        value: ["saved"],
        inputObserver: owner.observer,
        onValueChange: change,
      }),
    ),
  );
  const field = await type("  \trequested 漢🦀  ");
  await act(async () => key(field, "Enter"));
  const gate = await close(owner.registry);
  const captured = gate.capture();
  await act(async () => reject(new Error("effect outcome is unknown")));
  const data = await captured;
  expect(data.current()).toBe(true);
  expect(gate.current()).toBe(true);
  expect(data.snapshots[0].snapshot).toMatchObject({
    tags: ["saved"],
    draft: "",
    stateDraft: "",
    acceptedChanges: [
      {
        kind: "tag-add",
        raw: "  \trequested 漢🦀  ",
        tags: ["saved", "requested 漢🦀"],
        outcome: "unverified",
      },
    ],
  });
  expect(container.textContent).toContain("Could not verify the tag change");
  expect(change).toHaveBeenCalledExactlyOnceWith(["saved", "requested 漢🦀"]);
  await act(async () => key(field, "Enter"));
  expect(change).toHaveBeenCalledOnce();
  data.release();
});

it.each(["fulfilled", "rejected"] as const)(
  "conserves a detached TagInput's real %s callback and frozen original data without touching its replacement",
  async (outcome) => {
    const owner = observed();
    let finish!: () => void, reject!: () => void;
    const actual = new Promise<void>((resolve, fail) => {
      finish = resolve;
      reject = () => fail(new Error("original unknown outcome"));
    });
    settle.push(() => finish());
    const change = vi.fn(() => actual);
    await act(async () =>
      root.render(
        createElement(TagInput, {
          label: "Original tags",
          value: ["saved"],
          inputObserver: owner.observer,
          onValueChange: change,
        }),
      ),
    );
    const field = await type("  detached original  ");
    await act(async () => key(field, "Enter"));
    await act(async () => root.render(null));
    expect(owner.retired).toHaveLength(0);
    await expect(owner.registry.captureNotesInputs("root")).rejects.toMatchObject({ code: "busy" });
    const replacement = observed();
    const newChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(TagInput, {
          label: "Replacement tags",
          value: ["replacement"],
          inputObserver: replacement.observer,
          onValueChange: newChange,
        }),
      ),
    );
    await type("replacement private text");
    await act(async () => (outcome === "fulfilled" ? finish() : reject()));
    expect(owner.retired).toHaveLength(1);
    expect(owner.retired[0].snapshot).toMatchObject({ source: "tag-input", tags: ["saved"] });
    expect(owner.retired[0].snapshot.acceptedChanges).toEqual(
      outcome === "fulfilled"
        ? []
        : [
            {
              kind: "tag-add",
              raw: "  detached original  ",
              tags: ["saved", "detached original"],
              outcome: "unverified",
            },
          ],
    );
    expect(container.querySelector("input")!.value).toBe("replacement private text");
    expect(container.textContent).not.toContain("Could not verify");
    expect(newChange).not.toHaveBeenCalled();
    expect(change).toHaveBeenCalledExactlyOnceWith(["saved", "detached original"]);
    const data = await owner.registry.captureNotesInputs("root");
    expect(data.snapshots).toHaveLength(0);
    data.release();
  },
);

it("retains a synchronous TagInput dispatch-then-throw outcome without retrying its callback", async () => {
  const owner = observed();
  const dispatched: string[][] = [];
  const change = vi.fn((tags: string[]) => {
    dispatched.push([...tags]);
    throw new Error("callback dispatched then outcome became unknown");
  });
  await act(async () =>
    root.render(
      createElement(TagInput, {
        label: "Tags",
        value: ["saved"],
        inputObserver: owner.observer,
        onValueChange: change,
      }),
    ),
  );
  const field = await type("  exact unknown  ");
  await act(async () => key(field, "Enter"));
  const gate = await close(owner.registry);
  const data = await gate.capture();
  expect(data.current()).toBe(true);
  expect(data.snapshots[0].snapshot.acceptedChanges).toEqual([
    {
      kind: "tag-add",
      raw: "  exact unknown  ",
      tags: ["saved", "exact unknown"],
      outcome: "unverified",
    },
  ]);
  expect(dispatched).toEqual([["saved", "exact unknown"]]);
  await act(async () => key(field, "Enter"));
  expect(change).toHaveBeenCalledOnce();
  data.release();
});

it("retains completed TagInput bytes if the original view retired before its actual mutation layout", async () => {
  const owner = observed();
  let finish!: () => void;
  const actual = new Promise<void>((resolve) => {
    finish = resolve;
  });
  settle.push(() => finish());
  const change = vi.fn(() => {
    flushSync(() => root.render(null));
    return actual;
  });
  await act(async () =>
    root.render(
      createElement(TagInput, {
        label: "Tags",
        value: ["saved"],
        inputObserver: owner.observer,
        onValueChange: change,
      }),
    ),
  );
  const field = await type("  never projected  ");
  await act(async () => key(field, "Enter"));
  expect(owner.retired).toHaveLength(0);
  await expect(owner.registry.captureNotesInputs("root")).rejects.toMatchObject({ code: "busy" });
  await act(async () => finish());
  expect(owner.retired).toHaveLength(1);
  expect(owner.retired[0].snapshot.acceptedChanges).toEqual([
    {
      kind: "tag-add",
      raw: "  never projected  ",
      tags: ["saved", "never projected"],
      outcome: "settled-without-view",
    },
  ]);
  expect(change).toHaveBeenCalledExactlyOnceWith(["saved", "never projected"]);
});

it("retains all bounded unknown TagInput originals and refuses a new callback without evicting bytes or blocking typing", async () => {
  const owner = observed();
  const change = vi.fn(async () => {
    throw new Error("unknown original");
  });
  await act(async () =>
    root.render(
      createElement(TagInput, {
        label: "Tags",
        value: ["saved"],
        inputObserver: owner.observer,
        onValueChange: change,
      }),
    ),
  );
  for (let i = 0; i < 16; i++) {
    const field = await type(`  original ${i}  `);
    await act(async () => key(field, "Enter"));
  }
  const field = await type("  refused seventeenth  ");
  await act(async () => key(field, "Enter"));
  expect(change).toHaveBeenCalledTimes(16);
  expect(field.value).toBe("  refused seventeenth  ");
  expect(container.textContent).toContain("input limit");
  await type("  still selectable and editable  ");
  const data = await owner.registry.captureNotesInputs("root");
  expect(data.snapshots[0].snapshot.acceptedChanges).toEqual(
    Array.from({ length: 16 }, (_, i) => ({
      kind: "tag-add",
      raw: `  original ${i}  `,
      tags: ["saved", `original ${i}`],
      outcome: "unverified",
    })),
  );
  expect(data.snapshots[0].snapshot.draft).toBe("  still selectable and editable  ");
  data.release();
});

it("refuses an over-budget TagInput callback before effects while keeping exact raw text", async () => {
  const owner = observed();
  const change = vi.fn();
  await act(async () =>
    root.render(
      createElement(TagInput, {
        label: "Tags",
        inputObserver: owner.observer,
        onValueChange: change,
      }),
    ),
  );
  const original = "x".repeat(1024 * 1024);
  const field = await type(original);
  await act(async () => key(field, "Enter"));
  expect(change).not.toHaveBeenCalled();
  expect(field.value).toBe(original);
  expect(container.textContent).toContain("input limit");
  const data = await owner.registry.captureNotesInputs("root");
  expect(data.snapshots[0].snapshot).toMatchObject({ draft: original, acceptedChanges: [] });
  data.release();
});
