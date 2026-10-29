// @vitest-environment happy-dom
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MergeView } from "@codemirror/merge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMountedEditorClosure } from "../data/mountedEditorClosure";
import { replaceEditorDoc } from "../editor/editorDoc";
import { installEditorInputGate, type MountedEditorObserver } from "./useMountedEditorClosure";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  vi.useRealTimers();
});
function fixture(split = false) {
  const registry = createMountedEditorClosure();
  const host = document.createElement("div");
  document.body.append(host);
  const merge = split
    ? new MergeView({ a: { doc: "before\n" }, b: { doc: "original\n" }, parent: host })
    : null;
  const view = merge?.b ?? new EditorView({ doc: "original\n", parent: host });
  let gate!: ReturnType<typeof installEditorInputGate>;
  let originalGate: ReturnType<typeof installEditorInputGate> | undefined;
  const registration = registry.register(
    () => ({ snapshot: { text: view.state.doc.toString(), readOnly: view.state.readOnly } }),
    {
      canClose: () => !view.compositionStarted,
      close(closed) {
        gate.setClosed(closed);
        originalGate?.setClosed(closed);
      },
    },
  );
  const observer: MountedEditorObserver = {
    attach() {},
    changed: registration.changed,
    operation: registration.operation,
    allowed: registration.allowed,
    closed: registration.closed,
    external: registration.external,
  };
  gate = installEditorInputGate(view, observer);
  if (merge) originalGate = installEditorInputGate(merge.a, observer);
  cleanup.push(() => {
    gate.release();
    originalGate?.release();
    registration.unregister();
    if (merge) merge.destroy();
    else view.destroy();
    host.remove();
  });
  return { registry, view, merge, registration, observer };
}
describe("actual CodeMirror editor input admission", () => {
  it.each([false, true])(
    "rejects specs, filter:false, prebuilt batches, direct update/setState before mutation (split=%s)",
    async (split) => {
      const f = fixture(split);
      const close = f.registry.beginEditorInputClosure("s", { owner: {}, timeoutMs: 10_000 });
      cleanup.push(close.release);
      const chunks = f.merge?.chunks;
      expect(f.view.state.readOnly).toBe(true);
      f.view.dispatch({ changes: { from: 0, insert: "spec " }, filter: false });
      const first = f.view.state.update({
        changes: { from: 0, insert: "prebuilt " },
        filter: false,
      });
      f.view.dispatch(first);
      f.view.dispatch([
        first,
        first.state.update({ changes: { from: 0, insert: "batch " }, filter: false }),
      ]);
      f.view.update([first]);
      f.view.setState(EditorState.create({ doc: "replacement bypass" }));
      f.view.dispatch({ effects: StateEffect.reconfigure.of([]), filter: false });
      expect(f.view.state.doc.toString()).toBe("original\n");
      expect(f.view.state.readOnly).toBe(true);
      if (f.merge) {
        expect(f.merge.a.state.doc.toString()).toBe("before\n");
        expect(f.merge.chunks).toBe(chunks);
      }
      f.view.dispatch({ selection: { anchor: 2 } });
      expect(f.view.state.selection.main.head).toBe(2);
      const raw = await close.capture();
      expect(close.current()).toBe(true);
      expect(raw.missingCoverage).toContain("editor-view-aliases");
      expect(raw.missingCoverage).toContain("editor-surface-inventory");
      close.release();
      f.view.dispatch({ changes: { from: 0, insert: "reopened " }, filter: false });
      expect(f.view.state.doc.toString()).toBe("reopened original\n");
      expect(f.view.state.readOnly).toBe(false);
    },
  );
  it("settles original work and explicit children while denying new work; sync apply never grants across await", async () => {
    const f = fixture();
    const parent = f.registration.operation("save")!;
    const close = f.registry.beginEditorInputClosure("s", { owner: {}, timeoutMs: 10_000 });
    cleanup.push(close.release);
    expect(f.registration.operation("new-save")).toBeNull();
    const child = f.registration.operation("original-formatter", parent)!;
    child.apply(() =>
      f.view.dispatch({ changes: { from: 0, insert: "accepted " }, filter: false }),
    );
    await child.apply(async () => {
      await Promise.resolve();
      f.view.dispatch({ changes: { from: 0, insert: "ambient bypass " }, filter: false });
    });
    expect(f.view.state.doc.toString()).toBe("accepted original\n");
    let settled = false;
    const capturing = close.capture().then((value) => {
      settled = true;
      return value;
    });
    parent();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(f.registration.operation("late-child", parent)).toBeNull();
    child();
    expect((await capturing).snapshots[0].snapshot.text).toBe("accepted original\n");
    expect(close.current()).toBe(true);
  });
  it("preserves actual external split updates and invalidates the original preparation", async () => {
    const f = fixture(true);
    const close = f.registry.beginEditorInputClosure("s", { owner: {}, timeoutMs: 10_000 });
    cleanup.push(close.release);
    f.registration.external(() =>
      f.merge!.a.dispatch({ changes: { from: 0, insert: "external " } }),
    );
    expect(f.merge!.a.state.doc.toString()).toBe("external before\n");
    expect(f.view.state.doc.toString()).toBe("original\n");
    expect(close.current()).toBe(false);
    await expect(close.capture()).rejects.toMatchObject({ code: "busy" });
  });
  it("keeps gates closed after deadline/abort until the original release, without cancelling accepted work", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const work = f.registration.operation("original")!;
    const controller = new AbortController();
    const close = f.registry.beginEditorInputClosure("s", {
      owner: {},
      timeoutMs: 20,
      signal: controller.signal,
    });
    cleanup.push(close.release);
    const capture = close.capture();
    void capture.catch(() => {});
    controller.abort();
    await vi.advanceTimersByTimeAsync(21);
    await expect(capture).rejects.toMatchObject({ code: "busy" });
    expect(f.registration.closed()).toBe(true);
    expect(f.registration.operation("new")).toBeNull();
    work.apply(() => f.view.dispatch({ changes: { from: 0, insert: "original " } }));
    work();
    expect(f.view.state.doc.toString()).toBe("original original\n");
    close.release();
    expect(f.registration.closed()).toBe(false);
  });
  it("never infers whole-editor roster completeness from an empty closed registry", async () => {
    const f = createMountedEditorClosure();
    const close = f.beginEditorInputClosure("s", { owner: {}, timeoutMs: 10_000 });
    cleanup.push(close.release);
    expect(() => f.beginEditorInputClosure("other", { owner: {}, timeoutMs: 100 })).toThrow();
    const data = await close.capture();
    expect(data.snapshots).toHaveLength(0);
    expect(data.missingCoverage).toEqual(
      expect.arrayContaining([
        "editor-surface-inventory",
        "actor-inventory",
        "filesystem",
        "buffers",
      ]),
    );
    expect(data).not.toHaveProperty("rosterComplete");
  });
  it("restores the real original readonly permission rather than globally making the editor editable", () => {
    const f = fixture();
    f.view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) });
    const close = f.registry.beginEditorInputClosure("s", { owner: {}, timeoutMs: 10_000 });
    cleanup.push(close.release);
    expect(f.view.state.readOnly).toBe(true);
    close.release();
    expect(f.view.state.readOnly).toBe(true);
  });
  it("never reports a blocked full-document replacement as applied", () => {
    const f = fixture();
    const close = f.registry.beginEditorInputClosure("s", { owner: {}, timeoutMs: 10_000 });
    cleanup.push(close.release);
    expect(replaceEditorDoc(f.view, "blocked replacement\n")).toBe(false);
    expect(f.view.state.doc.toString()).toBe("original\n");
  });
});
