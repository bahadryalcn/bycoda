// @vitest-environment happy-dom
import { StrictMode, act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { captureEditorInputs } from "../data/mountedEditorClosure";
import { useMountedEditorClosure, type MountedEditorObserver } from "./useMountedEditorClosure";

it("keeps original accepted promises through strict effect replay, then releases only their retired registrations", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const original = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  let started = false;
  let actual!: Promise<void>;
  let observer!: MountedEditorObserver;
  let finish!: () => void;
  const read = vi.fn(() => ({ snapshot: { text: "live replacement" } }));
  function Probe() {
    observer = useMountedEditorClosure(read);
    useLayoutEffect(() => {
      if (!started) {
        started = true;
        finish = observer.operation("accepted-save");
        actual = original.finally(finish);
        void actual.catch(() => {});
      }
    }, []);
    return null;
  }
  try {
    await act(async () => root.render(createElement(StrictMode, null, createElement(Probe))));
    read.mockClear();
    await expect(captureEditorInputs("s")).rejects.toMatchObject({ code: "busy" });
    expect(read).not.toHaveBeenCalled();
    await act(async () => {
      resolve();
      await actual;
    });
    finish(); // An original finalizer cannot remove the newer live registration twice.
    const replacement = await captureEditorInputs("s");
    expect(replacement.current()).toBe(true);
    expect(replacement.snapshots).toHaveLength(1);
    expect(replacement.snapshots[0].snapshot.text).toBe("live replacement");
    replacement.release();
    const later = new Promise<void>((_, no) => {
      reject = no;
    });
    const finishLater = observer.operation("accepted-failing-save");
    const accepted = later.finally(finishLater);
    void accepted.catch(() => {});
    await act(async () => root.render(null));
    read.mockClear();
    await expect(captureEditorInputs("s")).rejects.toMatchObject({ code: "busy" });
    expect(read).not.toHaveBeenCalled();
    await act(async () => {
      reject(new Error("actual save failure"));
      await accepted.catch(() => {});
    });
    const empty = await captureEditorInputs("s");
    expect(empty.current()).toBe(true);
    expect(empty.snapshots).toHaveLength(0);
    empty.release();
  } finally {
    resolve();
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
