// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuickComposer } from "./QuickComposer";
import { quickNativeReply } from "../model/nativeQuickLaunch.fixture";
import {
  createQuickComposerClosureRuntime,
  type QuickComposerClosureRuntime,
} from "../model/quickComposerClosure";
import { createMountedComposerRegistry } from "../../sessions/data/composerClosure";
import { PersistenceDrainRegistry } from "../../sessions/data/persistenceDrain";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  choose: vi.fn(),
  shown: () => {},
  effort: "high",
  mode: "supervised",
  preferredModel: "fixture-model",
  projects: ["/fixture/project", "/fixture/other"],
  drop: (_event: unknown) => {},
  clipboardPaths: [] as string[],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => false }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ hide: vi.fn() }) }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: typeof native.drop) => {
      native.drop = handler;
      return () => {};
    },
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async (name, handler) => {
    if (name === "quick_composer_shown") native.shown = handler;
    return () => {};
  }),
}));
vi.mock("../../../platform/tauri/fs", () => ({
  pickFiles: native.choose,
  basename: (path: string) => path.split("/").at(-1),
  subscribeGitChanged: () => () => {},
  gitBranches: async () => null,
  saveGeneratedImage: vi.fn(),
  deleteGeneratedImages: vi.fn(),
}));
vi.mock("../../workspaces/model/workspaceCreation", () => ({
  shortWorkspaceRef: (value: string) => value,
  useWorkspaceCreation: (_cwd: string, _active: boolean, choice?: string) => ({
    mode: choice ?? "current",
    pending: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("./useQuickPickerMotion", () => ({ useQuickPickerMotion: () => {} }));
vi.mock("./QuickProjectIcon", () => ({
  QuickProjectIcon: () => null,
  loadQuickProjectAppearance: () => ({}),
}));
vi.mock("./QuickModelSelector", () => ({
  QuickModelSelector: ({
    onChange,
    onSettingsChange,
  }: {
    onChange(value: object): void;
    onSettingsChange(value: object): void;
  }) =>
    createElement(
      "button",
      {
        onClick: () => {
          onChange({ harness: "codex", id: "other-model" });
          onSettingsChange({ effort: "low" });
        },
      },
      "Select another model",
    ),
}));
vi.mock("../model/quickSessionDefaults", () => ({
  quickSessionModelSettings: (_model: unknown, _cwd: unknown, settings: object) => ({
    effort: native.effort,
    ...settings,
  }),
  quickSessionRuntimeMode: (_harness: unknown, _cwd: unknown, selected: string | null) =>
    selected ?? native.mode,
}));
vi.mock("../model/quickComposer", async (actual) => ({
  ...(await actual<object>()),
  loadQuickProjects: () => native.projects,
  initialQuickChoice: () => ({ harness: "codex", model: native.preferredModel }),
  resolveQuickModel: (choice: { harness: string; model: string }) => ({
    harness: choice.harness,
    id: choice.model,
    name: "Fixture model",
  }),
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
let root: Root;
let container: HTMLDivElement;
let live: boolean;
let runtime: QuickComposerClosureRuntime;
let closed: ReturnType<QuickComposerClosureRuntime["begin"]> | undefined;
let key: object;
const onShown = vi.fn();
const info = (path: string) => ({ path, name: path.split("/").at(-1), size: 3, isDir: false });
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent?.trim() === label || entry.getAttribute("aria-label") === label,
  )!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    callback();
    return 0;
  });
  localStorage.clear();
  native.effort = "high";
  native.mode = "supervised";
  native.preferredModel = "fixture-model";
  native.projects = ["/fixture/project", "/fixture/other"];
  native.clipboardPaths = [];
  native.choose.mockReset().mockResolvedValue(["/fixture/selected.txt"]);
  native.invoke
    .mockReset()
    .mockImplementation(async (command: string, args?: { paths?: string[] }) => {
      if (command === "inspect_paths") return args!.paths!.map(info);
      if (command === "read_file_base64") return "YWJj";
      if (command === "write_attachment") return "/fixture/retained-image.png";
      if (command === "clipboard_file_paths") return native.clipboardPaths;
      if (command === "clipboard_image") return new TextEncoder().encode("abc").buffer;
      if (command === "quick_composer_capture") return "/fixture/screenshot.png";
      return quickNativeReply(command, args);
    });
  runtime = createQuickComposerClosureRuntime(
    createMountedComposerRegistry({
      registry: new PersistenceDrainRegistry(),
      publish: async () => {},
    }),
  );
  key = {};
  closed = undefined;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  live = true;
});
afterEach(async () => {
  closed?.reopen(key);
  if (live) await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const draw = async () => {
  await act(async () => root.render(createElement(QuickComposer, { onShown, closure: runtime })));
};
const type = async (text: string) => {
  await act(async () => {
    const input = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const choose = async (label = "Choose files…") => {
  await act(async () => button("Add attachment").click());
  await act(async () => button(label).click());
};
const close = (timeoutMs = 30_000) => (closed = runtime.begin({ owner: key, timeoutMs }));
const calls = (command: string) => native.invoke.mock.calls.filter(([name]) => name === command);

it("captures mounted whitespace and full effective options without a fabricated session write", async () => {
  await draw();
  await type(" \n\t");
  const capture = await close().captureAndFlush();
  expect(capture).toMatchObject({
    qualified: false,
    draft: { prompt: " \n\t", cwd: "/fixture/project", choice: { model: "fixture-model" } },
    effective: { settings: { effort: "high" }, runtimeMode: "supervised" },
  });
  expect(container.querySelector("textarea")!.readOnly).toBe(true);
  expect(calls("session_set_draft")).toHaveLength(0);
  expect(calls("quick_composer_submit_intent")).toHaveLength(0);
  await act(async () => button("Close composer").click());
  expect(calls("quick_composer_dismiss")).toHaveLength(1);
  expect(() => closed!.assertCurrent()).not.toThrow();
});

it("gates already open command and model-setting completion callbacks", async () => {
  await draw();
  await type("/pla");
  const option = document.querySelector<HTMLButtonElement>('[role="option"]')!;
  await close().captureAndFlush();
  await act(async () => option.click());
  expect(container.querySelector("textarea")!.value).toBe("/pla");
  expect(() => closed!.assertCurrent()).not.toThrow();
  closed!.reopen(key);
  closed = undefined;
  await act(async () => button("Fixture model").click());
  await close().captureAndFlush();
  await act(async () => button("Select another model").click());
  const capture = await closed!.captureAndFlush();
  expect(capture.draft.choice.model).toBe("fixture-model");
  expect(capture.draft.modelSettings).toEqual({});
});

it("a provider effective-default change invalidates the full snapshot with unchanged prompt/files", async () => {
  await draw();
  await type("Keep me");
  const captured = await close().captureAndFlush();
  native.effort = "low";
  native.mode = "full-access";
  await draw();
  expect(() => closed!.assertCurrent()).toThrow("changed");
  expect(captured.effective!.settings.effort).toBe("high");
  expect(container.querySelector("textarea")!.value).toBe("Keep me");
});

it("retains a late selected result across actual unmount and restores it in the same window intent", async () => {
  await draw();
  await type("Original draft");
  const selected = deferred<string[]>();
  native.choose.mockReturnValue(selected.promise);
  await choose();
  await act(async () => root.unmount());
  live = false;
  const capture = close().captureAndFlush();
  expect(runtime.observation().active).toBe(1);
  await act(async () => selected.resolve(["/fixture/selected.txt"]));
  const result = await capture;
  expect(result.draft.prompt).toContain("Original draft");
  expect(result.draft.attachments).toMatchObject([{ path: "/fixture/selected.txt" }]);
  closed!.reopen(key);
  closed = undefined;
  root = createRoot(container);
  live = true;
  await draw();
  expect(container.querySelector("textarea")!.value).toContain("Original draft");
  expect(document.querySelector('[aria-label="Attachments"]')).not.toBeNull();
  expect(calls("quick_composer_release_capture")).toHaveLength(0);
});

it("retries the selected path's failed inspection without opening another native chooser", async () => {
  await draw();
  let attempts = 0;
  native.invoke.mockImplementation(async (command: string, args?: { paths?: string[] }) => {
    if (command === "inspect_paths") {
      if (++attempts === 1) throw new Error("Inspection unavailable");
      return args!.paths!.map(info);
    }
    return undefined;
  });
  await choose();
  await vi.waitFor(() => expect(container.textContent).toContain("Inspection unavailable"));
  await expect(close().captureAndFlush()).rejects.toThrow("Inspection unavailable");
  await act(async () => closed!.retryFailed(key));
  const result = await closed!.captureAndFlush();
  expect(native.choose).toHaveBeenCalledOnce();
  expect(attempts).toBe(2);
  expect(result.draft.attachments).toMatchObject([{ path: "/fixture/selected.txt" }]);
});

it("holds the original clipboard image through a failed spill and retries only the spill", async () => {
  await draw();
  await type("Image intent");
  let writes = 0;
  native.invoke.mockImplementation(async (command: string, args?: { data?: string }) => {
    if (command === "clipboard_file_paths") return [];
    if (command === "clipboard_image") return new TextEncoder().encode("abc").buffer;
    if (command === "write_attachment") {
      expect(args!.data).toBe("YWJj");
      if (++writes === 1) throw new Error("Spill unavailable");
      return "/fixture/image.png";
    }
    return undefined;
  });
  await act(async () => {
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "", files: [], items: [] },
    });
    container.querySelector("textarea")!.dispatchEvent(paste);
  });
  await vi.waitFor(() => expect(container.textContent).toContain("Spill unavailable"));
  await expect(close().captureAndFlush()).rejects.toThrow("Spill unavailable");
  await act(async () => closed!.retryFailed(key));
  const result = await closed!.captureAndFlush();
  expect(calls("clipboard_image")).toHaveLength(1);
  expect(writes).toBe(2);
  expect(result.draft.attachments).toMatchObject([{ path: "/fixture/image.png" }]);
});

it("retains a successful screenshot selection across inspection failure without recapturing or deleting it", async () => {
  await draw();
  let attempts = 0;
  native.invoke.mockImplementation(async (command: string, args?: { paths?: string[] }) => {
    if (command === "quick_composer_capture") return "/fixture/screen.png";
    if (command === "inspect_paths") {
      if (++attempts === 1) throw new Error("Screenshot inspection unavailable");
      return args!.paths!.map(info);
    }
    if (command === "read_file_base64") return "YWJj";
    return undefined;
  });
  await choose("Take screenshot…");
  await expect(close().captureAndFlush()).rejects.toThrow("Screenshot inspection unavailable");
  await act(async () => closed!.retryFailed(key));
  expect((await closed!.captureAndFlush()).draft.attachments).toMatchObject([
    { path: "/fixture/screen.png" },
  ]);
  expect(calls("quick_composer_capture")).toHaveLength(1);
  expect(calls("quick_composer_release_capture")).toHaveLength(0);
});

it("admits a queued clipboard capture immediately and waits for its later spill settlement", async () => {
  await draw();
  const inspection = deferred();
  const spill = deferred();
  native.invoke.mockImplementation(async (command: string, args?: { paths?: string[] }) => {
    if (command === "inspect_paths") {
      await inspection.promise;
      return args!.paths!.map(info);
    }
    if (command === "clipboard_file_paths") return [];
    if (command === "clipboard_image") return new TextEncoder().encode("abc").buffer;
    if (command === "write_attachment") {
      await spill.promise;
      return "/fixture/queued.png";
    }
    return undefined;
  });
  await choose();
  await act(async () => {
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "", files: [], items: [] },
    });
    container.querySelector("textarea")!.dispatchEvent(paste);
  });
  await vi.waitFor(() => expect(calls("clipboard_image")).toHaveLength(1));
  expect(runtime.observation().active).toBe(2);
  const capture = close().captureAndFlush();
  let finished = false;
  void capture.then(() => {
    finished = true;
  });
  await act(async () => inspection.resolve());
  await vi.waitFor(() => expect(calls("write_attachment")).toHaveLength(1));
  expect(finished).toBe(false);
  expect(runtime.observation().active).toBe(1);
  await act(async () => spill.resolve());
  const result = await capture;
  expect(result.draft.attachments.map((file) => file.path)).toEqual([
    "/fixture/selected.txt",
    "/fixture/queued.png",
  ]);
  expect(calls("clipboard_image")).toHaveLength(1);
});

it("a possibly accepted launch is never automatically replayed by closure retry", async () => {
  await draw();
  await type("Do not duplicate this launch");
  native.invoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "quick_composer_submit_intent") throw new Error("Launch outcome unknown");
    return quickNativeReply(command, args, "pending");
  });
  await act(async () => button("Start").click());
  expect(container.textContent).toContain("Launch outcome unknown");
  await expect(close().captureAndFlush()).rejects.toThrow("Launch outcome unknown");
  await expect(closed!.retryFailed(key)).rejects.toThrow("unknown");
  expect(calls("quick_composer_submit_intent")).toHaveLength(1);
  expect(calls("quick_composer_submit_status")).toHaveLength(1);
  expect(container.querySelector("textarea")!.value).toBe("Do not duplicate this launch");
});

it("an unknown screenshot capture ACK is not turned into a different screenshot by retry", async () => {
  await draw();
  native.invoke.mockImplementation(async (command: string) => {
    if (command === "quick_composer_capture") throw new Error("Capture ACK unknown");
    return undefined;
  });
  await choose("Take screenshot…");
  await expect(close().captureAndFlush()).rejects.toThrow("Capture ACK unknown");
  await expect(closed!.retryFailed(key)).rejects.toThrow("Capture ACK unknown");
  expect(calls("quick_composer_capture")).toHaveLength(1);
  expect(calls("quick_composer_release_capture")).toHaveLength(0);
});

it("explicit Start reconciles a lost ACK without sending newer edits or clearing them", async () => {
  await draw();
  await type("Original accepted request");
  native.invoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "quick_composer_submit_intent") throw new Error("ACK lost");
    return quickNativeReply(command, args);
  });
  await act(async () => button("Start").click());
  const original = calls("quick_composer_submit_intent")[0][1]!.submission;
  await type("Newer unsent draft");
  await act(async () => button("Start").click());
  expect(calls("quick_composer_submit_intent")).toHaveLength(1);
  expect(calls("quick_composer_launch_scope")).toHaveLength(1);
  expect(calls("quick_composer_submit_status")[0][1]).toEqual({ query: original });
  expect(container.querySelector("textarea")!.value).toBe("Newer unsent draft");
});

it("retains the full newer unsent attachment draft after an old launch ACK", async () => {
  await draw();
  await type("Original with attachment");
  await choose("Take screenshot…");
  const gate = deferred();
  native.invoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "quick_composer_submit_intent") await gate.promise;
    return quickNativeReply(command, args);
  });
  await act(async () => button("Start").click());
  await vi.waitFor(() => expect(calls("quick_composer_submit_intent")).toHaveLength(1));
  await type("Newer unsent request reuses the screenshot");
  await act(async () => gate.resolve());
  await vi.waitFor(() => expect(runtime.observation().active).toBe(0));
  const snapshot = await close().captureAndFlush();
  expect(snapshot.draft.prompt).toBe("Newer unsent request reuses the screenshot");
  expect(snapshot.draft.attachments).toMatchObject([{ path: "/fixture/screenshot.png" }]);
  expect(calls("quick_composer_release_capture")).toHaveLength(0);
});

it("an old accepted ACK preserves the current remounted IME DOM before its input event", async () => {
  await draw();
  await type("Original raw draft");
  await choose("Take screenshot…");
  const gate = deferred();
  native.invoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "quick_composer_submit_intent") await gate.promise;
    return quickNativeReply(command, args);
  });
  await act(async () => button("Start").click());
  await vi.waitFor(() => expect(calls("quick_composer_submit_intent")).toHaveLength(1));
  await act(async () => root.unmount());
  live = false;
  root = createRoot(container);
  live = true;
  await draw();
  const input = container.querySelector("textarea")!;
  await act(async () => {
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "未送信の新しい入力",
    );
    gate.resolve();
  });
  await vi.waitFor(() => expect(runtime.observation().active).toBe(0));
  expect(input.value).toBe("未送信の新しい入力");
  expect(calls("quick_composer_release_capture")).toHaveLength(0);
  await act(async () =>
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
  );
  expect((await close().captureAndFlush()).draft.attachments).toMatchObject([
    { path: "/fixture/screenshot.png" },
  ]);
});

it("only a fresh Native Failed status permits an explicit corrected tuple", async () => {
  await draw();
  await type("Invalid original");
  let sends = 0;
  let scopes = 0;
  native.invoke.mockImplementation(async (command: string, args?: unknown) => {
    const result = quickNativeReply(
      command,
      args,
      command === "quick_composer_submit_status" ||
        (command === "quick_composer_submit_intent" && ++sends === 1)
        ? "failed"
        : "queued",
    );
    if (command === "quick_composer_launch_scope") result!.nextSequence = ++scopes;
    return result;
  });
  await act(async () => button("Start").click());
  await expect(close().captureAndFlush()).rejects.toThrow("unknown");
  await expect(closed!.retryFailed(key)).rejects.toThrow("unknown");
  expect(calls("quick_composer_submit_intent")).toHaveLength(1);
  expect(calls("quick_composer_launch_scope")).toHaveLength(1);
  closed!.reopen(key);
  closed = undefined;
  await type("Corrected explicit request");
  await act(async () => button("Start").click());
  const [first, second] = calls("quick_composer_submit_intent").map((call) => call[1]!.submission);
  expect(first).toMatchObject({ sequence: 1, request: { prompt: "Invalid original" } });
  expect(second).toMatchObject({ sequence: 2, request: { prompt: "Corrected explicit request" } });
  expect(second.intentId).not.toBe(first.intentId);
  expect(container.querySelector("textarea")!.value).toBe("");
});

it("over-capacity clipboard selection is retained as failure without inspection or recapture", async () => {
  await draw();
  native.invoke.mockImplementation(async (command: string) =>
    command === "clipboard_file_paths" ? ["x".repeat(524289)] : undefined,
  );
  await act(async () => {
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "", files: [], items: [] },
    });
    container.querySelector("textarea")!.dispatchEvent(paste);
  });
  await vi.waitFor(() => expect(container.textContent).toContain("retained attachment capacity"));
  await expect(close().captureAndFlush()).rejects.toThrow("retained attachment capacity");
  await expect(closed!.retryFailed(key)).rejects.toThrow("retained attachment capacity");
  expect(calls("clipboard_file_paths")).toHaveLength(1);
  expect(calls("inspect_paths")).toHaveLength(0);
});

it("keeps the ordinary over-capacity notice while retaining only the accepted File objects", async () => {
  await draw();
  native.invoke.mockImplementation(async (command: string, args?: { name?: string }) =>
    command === "write_attachment" ? `/fixture/${args!.name}` : undefined,
  );
  await act(async () => {
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: () => "",
        files: Array.from(
          { length: 21 },
          (_, index) => new File(["abc"], `${index}.txt`, { type: "text/plain" }),
        ),
        items: [],
      },
    });
    container.querySelector("textarea")!.dispatchEvent(paste);
  });
  await vi.waitFor(() => expect(container.textContent).toContain("You can attach up to 20 files."));
  expect((await close().captureAndFlush()).draft.attachments).toHaveLength(20);
  expect(calls("write_attachment")).toHaveLength(20);
});

it("owns a held launch across replacement and preserves newly typed text after its actual ACK", async () => {
  await draw();
  await type("First intent");
  const ack = deferred();
  native.invoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "quick_composer_submit_intent") await ack.promise;
    return quickNativeReply(command, args);
  });
  await act(async () => button("Start").click());
  await vi.waitFor(() => expect(calls("quick_composer_submit_intent")).toHaveLength(1));
  await act(async () => root.unmount());
  live = false;
  root = createRoot(container);
  live = true;
  await draw();
  expect(button("Starting…") ?? button("Start")).toBeDefined();
  await type("New draft while old launch settles");
  await act(async () => ack.resolve());
  await vi.waitFor(() => expect(runtime.observation().active).toBe(0));
  expect(container.querySelector("textarea")!.value).toBe("New draft while old launch settles");
  expect(calls("quick_composer_submit_intent")).toHaveLength(1);
});

it("a real module replacement retains the window intent and previously admitted chooser", async () => {
  const original = await import("../model/quickComposerClosure");
  runtime = original.quickComposerClosure;
  await draw();
  await type("HMR retained intent");
  const selected = deferred<string[]>();
  native.choose.mockReturnValue(selected.promise);
  await choose();
  const updated = await import("../model/quickComposerClosure?quick-implementation-reload");
  runtime = updated.quickComposerClosure;
  await draw();
  await act(async () => selected.resolve(["/fixture/selected.txt"]));
  await vi.waitFor(() => expect(runtime.observation().active).toBe(0));
  const result = await close().captureAndFlush();
  expect(result.draft.prompt).toContain("HMR retained intent");
  expect(result.draft.attachments).toMatchObject([{ path: "/fixture/selected.txt" }]);
  expect(native.choose).toHaveBeenCalledOnce();
  closed!.reopen(key);
  closed = undefined;
  native.preferredModel = "refreshed-after-hmr";
  native.projects = ["/fixture/refreshed"];
  await act(async () => native.shown());
  const refreshed = await close().captureAndFlush();
  expect(refreshed.draft.cwd).toBe("/fixture/refreshed");
  expect(refreshed.draft.choice.model).toBe("refreshed-after-hmr");
  expect(refreshed.draft.prompt).toContain("HMR retained intent");
});
