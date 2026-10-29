// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMountedEditorClosure, type EditorWorkTicket } from "../data/mountedEditorClosure";
import { chooseMergeRegion, mergeResolution } from "../../source-control/model/mergeResolution";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import type { MountedEditorObserver, MountedEditorView } from "./useMountedEditorClosure";

const format = vi.hoisted(() => vi.fn());
vi.mock("../../../shared/lib/format", () => ({
  formatProjectText: format,
  hasBundledFormatter: () => true,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => [] }));

const cleanup: (() => void | Promise<void>)[] = [];
const kinds = ["source", "split", "merge"] as const;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Storage();
  storage.setItem("bycoda.autosave", "0");
  storage.setItem("bycoda.formatOnSave", "0");
  storage.setItem("bycoda.diffLayout", "split");
  vi.stubGlobal("localStorage", storage);
  format.mockReset();
});
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) await stop();
  vi.unstubAllGlobals();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function fixture(kind: (typeof kinds)[number]) {
  const registry = createMountedEditorClosure();
  let port: MountedEditorView | null = null;
  const registration = registry.register(() => ({ snapshot: { text: port!.read().text } }), {
    canClose: () => !!port && !port.read().composing && !port.read().compositionStarted,
    close: (closed) => port?.setClosed?.(closed),
  });
  const observer: MountedEditorObserver = {
    attach(next) {
      port = next;
      registration.changed();
    },
    changed: registration.changed,
    operation: registration.operation,
    allowed: registration.allowed,
    closed: registration.closed,
    external: registration.external,
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const saveRequestRef = {
    current: null as ((parent?: EditorWorkTicket) => Promise<boolean>) | null,
  };
  const onSave = vi.fn<(text: string, ticket?: EditorWorkTicket) => Promise<void>>(async () => {});
  cleanup.push(async () => {
    await act(async () => root.unmount());
    registration.unregister();
    host.remove();
  });
  await act(async () =>
    root.render(
      createElement(CodeMirrorEditor, {
        path: "/repo/editor.tsx",
        cwd: "/repo",
        active: false,
        value:
          kind === "merge" ? "<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> branch\n" : "original\n",
        gitOriginal: kind === "split" ? "original\n" : null,
        showDiff: kind === "split",
        formatOnSave: true,
        canAutosave: () => true,
        onDirtyChange: vi.fn(),
        onErrorCountChange: vi.fn(),
        onSave,
        saveRequestRef,
        captureObserver: observer,
      }),
    ),
  );
  const editors = host.querySelectorAll<HTMLElement>(".cm-editor");
  const editor =
    kind === "merge"
      ? host.querySelector<HTMLElement>('[aria-label="Resolved output"]')!
      : editors[editors.length - 1];
  const view = EditorView.findFromDOM(editor)!;
  act(() => {
    if (kind === "merge")
      chooseMergeRegion(view, mergeResolution(view.state).regions[0].id, "theirs");
    else view.dispatch({ changes: { from: 0, insert: "edited " } });
  });
  return { registry, registration, onSave, saveRequestRef, view };
}

it.each(kinds)(
  "keeps the normal open %s onSave callback at one argument with the actual observer installed",
  async (kind) => {
    const f = await fixture(kind);
    const text = f.view.state.doc.toString();
    await act(async () => expect(await f.saveRequestRef.current!()).toBe(true));
    expect(f.onSave).toHaveBeenCalledExactlyOnceWith(text);
  },
);

it.each(kinds)(
  "carries the actual original %s save lineage only when closure requires a filesystem child",
  async (kind) => {
    const f = await fixture(kind);
    const formatting = deferred<{ formatted: string; cursorOffset: number }>();
    const write = deferred<void>();
    let child: EditorWorkTicket | null = null;
    f.onSave.mockImplementation(async (_text, ticket) => {
      child = f.registration.operation("filesystem-child", ticket);
      expect(child).not.toBeNull();
      try {
        await write.promise;
      } finally {
        child?.();
      }
    });
    let saving!: Promise<boolean>;
    const parent = kind === "merge" ? f.registration.operation("original-manual-save") : null;
    if (kind !== "merge") {
      localStorage.setItem("bycoda.formatOnSave", "1");
      format.mockReturnValue(formatting.promise);
      act(() => {
        saving = f.saveRequestRef.current!();
      });
      expect(format).toHaveBeenCalledOnce();
    }
    const close = f.registry.beginEditorInputClosure("session", { owner: {}, timeoutMs: 10_000 });
    cleanup.push(close.release);
    try {
      if (kind === "merge")
        act(() => {
          saving = f.saveRequestRef.current!(parent!);
        });
      else await act(async () => formatting.resolve({ formatted: "formatted\n", cursorOffset: 0 }));
      await vi.waitFor(() => expect(f.onSave).toHaveBeenCalledOnce());
      parent?.();
      expect(f.onSave.mock.calls[0]).toHaveLength(2);
      expect(typeof f.onSave.mock.calls[0][1]).toBe("function");
      expect(f.registration.operation("new-save")).toBeNull();
      let finished = false;
      const capturing = close.capture().then((value) => {
        finished = true;
        return value;
      });
      await Promise.resolve();
      expect(finished).toBe(false);
      await act(async () => {
        write.resolve();
        expect(await saving).toBe(true);
      });
      const data = await capturing;
      expect(data.snapshots[0].snapshot.text).toBe(f.onSave.mock.calls[0][0]);
      expect(close.current()).toBe(true);
      data.release();
    } finally {
      parent?.();
      formatting.resolve({ formatted: "formatted\n", cursorOffset: 0 });
      write.resolve();
      await saving;
    }
  },
);
