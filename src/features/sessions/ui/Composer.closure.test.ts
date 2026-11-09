// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import {
  beginComposerClosure,
  mountedComposerObservation,
  type MountedComposerClosure,
} from "../data/composerClosure";
import {
  clearComposerDraft,
  getComposerAttachments,
  getComposerDraft,
  setComposerDraft,
} from "../model/draftCache";
import type { Attachment } from "../model/session";
import { loadProjectFiles } from "../../files/model/fileIndex";

const ports = vi.hoisted(() => ({ invoke: vi.fn(), picker: vi.fn(), dialog: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ports.invoke, isTauri: () => false }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@tauri-apps/plugin-dialog", async (original) => ({
  ...(await original<typeof import("@tauri-apps/plugin-dialog")>()),
  open: ports.dialog,
}));
vi.mock("../model/attachments", async (original) => ({
  ...(await original<typeof import("../model/attachments")>()),
  pickAttachments: ports.picker,
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const file: Attachment = {
  id: "held-file",
  name: "selected.txt",
  kind: "file",
  mimeType: "text/plain",
  size: 4,
  path: "/fixture/selected.txt",
};
let root: Root;
let container: HTMLDivElement;
let id: string;
let live: boolean;
let owner: object;
let closed: MountedComposerClosure | undefined;
let submit: ReturnType<typeof vi.fn>;
let published: ReturnType<typeof vi.fn>;
let heldWrite: ReturnType<typeof deferred> | undefined;
let failWrites: number;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  id = `closure-${crypto.randomUUID()}`;
  owner = {};
  closed = undefined;
  heldWrite = undefined;
  failWrites = 0;
  submit = vi.fn();
  published = vi.fn((text: string) => setComposerDraft(id, text));
  ports.picker.mockReset();
  ports.dialog.mockReset();
  ports.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "session_set_draft") {
      if (heldWrite) await heldWrite.promise;
      if (failWrites-- > 0) throw new Error("Native draft ACK unavailable");
      return null;
    }
    return [];
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  live = true;
});
afterEach(async () => {
  closed?.reopen(owner);
  heldWrite?.resolve();
  if (live) await act(async () => root.unmount());
  await vi.waitFor(() => expect(mountedComposerObservation().active).toBe(0));
  clearComposerDraft(id);
  container.remove();
  vi.unstubAllGlobals();
});

async function draw(extra: Record<string, unknown> = {}) {
  await act(async () =>
    root.render(
      createElement(Composer, {
        sessionId: id,
        focused: false,
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        executionCwd: "/fixture",
        initialDraft: "Keep this draft",
        hideTopBar: true,
        onFocus: vi.fn(),
        onCwdChange: vi.fn(),
        onModelChange: vi.fn(),
        onRuntimeModeChange: vi.fn(),
        onSubmit: submit,
        onDraftChange: published,
        ...extra,
      }),
    ),
  );
}
async function chooseFile() {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Add files or skills"]')!.click(),
  );
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((entry) =>
    entry.textContent?.includes("Upload file"),
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
function close(timeoutMs = 30_000) {
  closed = beginComposerClosure([id], { owner, timeoutMs });
  return closed;
}

async function openSkillCreation(extra: Record<string, unknown> = {}) {
  await draw({ harness: "claude", initialDraft: "/new-fixture-skill", ...extra });
  await act(async () =>
    container.querySelector("textarea")!.dispatchEvent(new Event("input", { bubbles: true })),
  );
  const create = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "New skill",
  );
  expect(create).toBeDefined();
  await act(async () => create!.click());
  return document.querySelector<HTMLFormElement>("[data-skill-picker] form")!;
}

it("rejects an already open slash completion before changing its closed draft", async () => {
  await draw({ harness: "claude", initialDraft: "/pla" });
  const input = container.querySelector("textarea")!;
  await act(async () => input.dispatchEvent(new Event("input", { bubbles: true })));
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (button) => button.textContent?.includes("/plan"),
  );
  expect(option).toBeDefined();
  const closure = close();
  await closure.captureAndFlush();
  await act(async () => option!.click());
  expect(input.value).toBe("/pla");
  expect(() => closure.assertCurrent()).not.toThrow();
});

it("rejects an already open mention completion before changing its closed draft", async () => {
  ports.invoke.mockImplementation(async (command: string) =>
    command === "list_project_files"
      ? [{ path: "/fixture/selected.txt", relative: "selected.txt", name: "selected.txt" }]
      : command === "session_set_draft"
        ? null
        : [],
  );
  await loadProjectFiles("/fixture", true);
  await draw({ initialDraft: "@sel" });
  const input = container.querySelector("textarea")!;
  await act(async () => input.dispatchEvent(new Event("input", { bubbles: true })));
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (button) => button.textContent?.includes("selected.txt"),
  );
  expect(option).toBeDefined();
  const closure = close();
  await closure.captureAndFlush();
  await act(async () => option!.click());
  expect(input.value).toBe("@sel");
  expect(() => closure.assertCurrent()).not.toThrow();
});

it("rejects insertion from an already open plus menu without dropping its draft", async () => {
  await draw();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Add files or skills"]')!.click(),
  );
  const option = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Skills"),
  );
  expect(option).toBeDefined();
  const closure = close();
  await closure.captureAndFlush();
  await act(async () => option!.click());
  expect(container.querySelector("textarea")!.value).toBe("Keep this draft");
  expect(() => closure.assertCurrent()).not.toThrow();
});

it("does not start skill creation from a form that was open before closure", async () => {
  const form = await openSkillCreation();
  expect(form).not.toBeNull();
  const closure = close();
  await closure.captureAndFlush();
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(ports.invoke.mock.calls.some(([command]) => command === "create_path")).toBe(false);
  expect(container.querySelector("textarea")!.value).toBe("/new-fixture-skill");
  expect(() => closure.assertCurrent()).not.toThrow();
});

it("owns accepted skill completion through its write and retries only its later draft ACK", async () => {
  const written = deferred();
  const opened = vi.fn();
  let failDraft = true;
  ports.invoke.mockImplementation(async (command: string) => {
    if (command === "create_path") return "/fixture/.agents/skills/new-fixture-skill";
    if (command === "write_text_file") {
      await written.promise;
      return null;
    }
    if (command === "session_set_draft") {
      if (failDraft) {
        failDraft = false;
        throw new Error("Skill capture ACK unavailable");
      }
      return null;
    }
    return [];
  });
  const form = await openSkillCreation({ onOpenFile: opened });
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await vi.waitFor(() =>
    expect(ports.invoke.mock.calls.some(([command]) => command === "write_text_file")).toBe(true),
  );
  const closure = close();
  const rejected = expect(closure.captureAndFlush()).rejects.toThrow(
    "Skill capture ACK unavailable",
  );
  expect(mountedComposerObservation().active).toBeGreaterThan(0);
  await act(async () => written.resolve());
  await rejected;
  await closure.retryFailed(owner);
  await closure.captureAndFlush();
  expect(ports.invoke.mock.calls.filter(([command]) => command === "create_path")).toHaveLength(1);
  expect(ports.invoke.mock.calls.filter(([command]) => command === "write_text_file")).toHaveLength(
    1,
  );
  expect(opened).toHaveBeenCalledExactlyOnceWith(
    "/fixture/.agents/skills/new-fixture-skill/SKILL.md",
  );
});

it("retries inspection of the actual selected paths without reopening their successful chooser", async () => {
  const actual =
    await vi.importActual<typeof import("../model/attachments")>("../model/attachments");
  ports.picker.mockImplementation(actual.pickAttachments);
  ports.dialog.mockResolvedValue(["/fixture/selected.txt"]);
  let attempts = 0;
  ports.invoke.mockImplementation(async (command: string, args?: { paths?: string[] }) => {
    if (command === "inspect_paths") {
      expect(args?.paths).toEqual(["/fixture/selected.txt"]);
      if (++attempts === 1) throw new Error("Inspection temporarily unavailable");
      return [{ path: "/fixture/selected.txt", name: "selected.txt", size: 4, isDir: false }];
    }
    return command === "session_set_draft" ? null : [];
  });
  await draw();
  await chooseFile();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Inspection temporarily unavailable"),
  );
  const closure = close();
  await expect(closure.captureAndFlush()).rejects.toThrow("Inspection temporarily unavailable");
  await act(async () => closure.retryFailed(owner));
  const capture = await closure.captureAndFlush();
  expect(ports.dialog).toHaveBeenCalledOnce();
  expect(attempts).toBe(2);
  expect(
    capture.snapshots.find((entry) => entry.sessionId === id)?.snapshot.attachments,
  ).toMatchObject([{ path: "/fixture/selected.txt", name: "selected.txt" }]);
  expect(getComposerAttachments(id)).toMatchObject([{ path: "/fixture/selected.txt" }]);
  expect(submit).not.toHaveBeenCalled();
});

it("does not retry a failed selection into a genuinely later cleared draft", async () => {
  const actual =
    await vi.importActual<typeof import("../model/attachments")>("../model/attachments");
  ports.picker.mockImplementation(actual.pickAttachments);
  ports.dialog.mockResolvedValue(["/fixture/selected.txt"]);
  let inspections = 0;
  ports.invoke.mockImplementation(async (command: string) => {
    if (command === "inspect_paths") {
      inspections++;
      throw new Error("Inspection temporarily unavailable");
    }
    return command === "session_set_draft" ? null : [];
  });
  await draw();
  await chooseFile();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Inspection temporarily unavailable"),
  );
  await draw({ draftResetToken: 1 });
  expect(container.querySelector("textarea")!.value).toBe("");
  const closure = close();
  await expect(closure.captureAndFlush()).rejects.toThrow("Inspection temporarily unavailable");
  await expect(closure.retryFailed(owner)).rejects.toThrow("earlier draft");
  await expect(closure.captureAndFlush()).rejects.toThrow("earlier draft");
  expect(ports.dialog).toHaveBeenCalledOnce();
  expect(inspections).toBe(1);
  expect(getComposerAttachments(id)).toEqual([]);
  expect(container.querySelector("textarea")!.value).toBe("");
});

it("one failed selection does not make another failed selection's explicit retry stale", async () => {
  const actual =
    await vi.importActual<typeof import("../model/attachments")>("../model/attachments");
  ports.picker.mockImplementation(actual.pickAttachments);
  ports.dialog
    .mockResolvedValueOnce(["/fixture/first.txt"])
    .mockResolvedValueOnce(["/fixture/second.txt"]);
  let failInspection = true;
  ports.invoke.mockImplementation(async (command: string, args?: { paths?: string[] }) => {
    if (command === "inspect_paths") {
      if (failInspection) throw new Error("Selected file inspection unavailable");
      return args!.paths!.map((path) => ({
        path,
        name: path.split("/").at(-1),
        size: 4,
        isDir: false,
      }));
    }
    return command === "session_set_draft" ? null : [];
  });
  await draw();
  await chooseFile();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Selected file inspection unavailable"),
  );
  await chooseFile();
  await vi.waitFor(() => expect(ports.dialog).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(mountedComposerObservation().active).toBe(0));
  const closure = close();
  await expect(closure.captureAndFlush()).rejects.toThrow("Selected file inspection unavailable");
  failInspection = false;
  await act(async () => closure.retryFailed(owner));
  const result = await closure.captureAndFlush();
  expect(ports.dialog).toHaveBeenCalledTimes(2);
  expect(
    result.snapshots
      .find((entry) => entry.sessionId === id)
      ?.snapshot.attachments.map((item) => item.path),
  ).toEqual(["/fixture/first.txt", "/fixture/second.txt"]);
});

it("captures actual DOM whitespace before publication effects and never turns it into a send", async () => {
  await draw();
  const input = container.querySelector("textarea")!;
  let capture!: ReturnType<MountedComposerClosure["captureAndFlush"]>;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      " \n\t",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    capture = close().captureAndFlush();
    expect(input.readOnly).toBe(true);
  });
  const result = await capture;
  expect(result.qualified).toBe(false);
  expect(result.snapshots.find((entry) => entry.sessionId === id)?.snapshot.text).toBe(" \n\t");
  expect(getComposerDraft(id)).toBe(" \n\t");
  expect(submit).not.toHaveBeenCalled();
  expect(result.missingCoverage).toContain("native-challenge");
  closed!.reopen(owner);
  expect(input.readOnly).toBe(false);
});

it("retains an old mount's held ACK while an identical replacement joins the same session", async () => {
  await draw();
  heldWrite = deferred();
  await act(async () => root.unmount());
  live = false;
  await vi.waitFor(() => expect(mountedComposerObservation().active).toBeGreaterThan(0));
  root = createRoot(container);
  live = true;
  await draw();
  const capture = close().captureAndFlush();
  expect(mountedComposerObservation().active).toBeGreaterThan(0);
  heldWrite.resolve();
  const result = await capture;
  expect(result.snapshots.every((entry) => entry.snapshot.text === "Keep this draft")).toBe(true);
  expect(getComposerDraft(id)).toBe("Keep this draft");
});

it("waits for an admitted picker result and its real Native row ACK while rejecting new input", async () => {
  await draw();
  const read = deferred<Attachment[]>();
  ports.picker.mockReturnValue(read.promise);
  await chooseFile();
  expect(ports.picker).toHaveBeenCalledOnce();
  const capture = close().captureAndFlush();
  await chooseFile();
  expect(ports.picker).toHaveBeenCalledOnce();
  const input = container.querySelector("textarea")!;
  const blocked = new Event("beforeinput", { bubbles: true, cancelable: true });
  input.dispatchEvent(blocked);
  expect(blocked.defaultPrevented).toBe(true);
  heldWrite = deferred();
  await act(async () => read.resolve([file]));
  await vi.waitFor(() =>
    expect(ports.invoke.mock.calls.some(([name]) => name === "session_set_draft")).toBe(true),
  );
  let done = false;
  void capture.then(() => {
    done = true;
  });
  expect(done).toBe(false);
  expect(mountedComposerObservation().active).toBeGreaterThan(0);
  heldWrite.resolve();
  const result = await capture;
  expect(result.snapshots.find((entry) => entry.sessionId === id)?.snapshot.attachments).toEqual([
    file,
  ]);
  expect(getComposerAttachments(id)).toEqual([file]);
  expect(submit).not.toHaveBeenCalled();
});

it("retains late attachment bytes in the original session after the actual Composer unmounts", async () => {
  await draw();
  const read = deferred<Attachment[]>();
  ports.picker.mockReturnValue(read.promise);
  await chooseFile();
  await act(async () => root.unmount());
  live = false;
  published.mockClear();
  await act(async () => read.resolve([file]));
  await vi.waitFor(() => expect(getComposerAttachments(id)).toEqual([file]));
  expect(getComposerDraft(id)).toContain("Keep this draft");
  expect(published).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

it("a newer explicit cache clear is not resurrected by a retired picker's late result", async () => {
  await draw();
  const read = deferred<Attachment[]>();
  ports.picker.mockReturnValue(read.promise);
  await chooseFile();
  await act(async () => root.unmount());
  live = false;
  clearComposerDraft(id);
  const writesBefore = ports.invoke.mock.calls.filter(
    ([command]) => command === "session_set_draft",
  ).length;
  await act(async () => read.resolve([file]));
  await vi.waitFor(() => expect(mountedComposerObservation().active).toBe(0));
  expect(getComposerDraft(id)).toBeUndefined();
  expect(getComposerAttachments(id)).toEqual([]);
  expect(
    ports.invoke.mock.calls.filter(([command]) => command === "session_set_draft"),
  ).toHaveLength(writesBefore);
});

it("retries a failed Native draft ACK without opening the picker or replaying its read", async () => {
  await draw();
  ports.picker.mockResolvedValue([file]);
  failWrites = 1;
  await chooseFile();
  await vi.waitFor(() => expect(container.textContent).toContain("Native draft ACK unavailable"));
  const closure = close();
  await expect(closure.captureAndFlush()).rejects.toThrow("Native draft ACK unavailable");
  await closure.retryFailed(owner);
  const result = await closure.captureAndFlush();
  expect(result.snapshots.find((entry) => entry.sessionId === id)?.snapshot.attachments).toEqual([
    file,
  ]);
  expect(ports.picker).toHaveBeenCalledOnce();
});

it("composition is preserved instead of forcibly committed by an explicit closure", async () => {
  await draw();
  const input = container.querySelector("textarea")!;
  input.dispatchEvent(new Event("compositionstart", { bubbles: true }));
  const closure = close();
  expect(input.readOnly).toBe(false);
  await expect(closure.captureAndFlush()).rejects.toMatchObject({ code: "composition" });
  input.dispatchEvent(new Event("compositionend", { bubbles: true }));
  expect(() => closure.assertCurrent()).toThrow("changed");
  closure.reopen(owner);
  expect(input.readOnly).toBe(false);
  expect(input.value).toBe("Keep this draft");
});

it("an unexpected later DOM mutation invalidates capture and remains available after exact reopen", async () => {
  await draw();
  const input = container.querySelector("textarea")!;
  const closure = close();
  await closure.captureAndFlush();
  await act(async () => {
    input.value = "later externally restored draft";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(() => closure.assertCurrent()).toThrow("changed");
  closure.reopen(owner);
  expect(input.value).toBe("later externally restored draft");
  expect(getComposerDraft(id)).toBe("later externally restored draft");
});

it("Stop remains available while new submit and editor changes are explicitly closed", async () => {
  const stop = vi.fn();
  await draw({ busy: true, onStop: stop });
  close();
  const input = container.querySelector("textarea")!;
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ),
  );
  expect(stop).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
  expect(input.value).toBe("Keep this draft");
});
