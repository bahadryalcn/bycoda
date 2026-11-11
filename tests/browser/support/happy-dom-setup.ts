// Happy DOM 20.14 dispatches selectionchange synchronously. Real browsers queue
// it, otherwise CodeMirror receives a nested update while changing selection.
// Remove this shim once happy-dom includes upstream fix #2325.
if (typeof document !== "undefined" && "happyDOM" in window) {
  // Motion cancels native animations during teardown. Happy DOM eagerly creates
  // a finished promise and rejects it even when nobody requested that promise.
  // Consume only expected cancellation; keep the original promise rejectable
  // for callers and let every other animation error fail the test.
  const cancelAnimation = Animation.prototype.cancel;
  Animation.prototype.cancel = function () {
    void this.finished.catch((error: unknown) => {
      if (!(error instanceof DOMException) || error.name !== "AbortError") throw error;
    });
    cancelAnimation.call(this);
  };
  let selectionMethodDepth = 0;
  const selection = document.getSelection();
  if (selection) {
    for (const method of [
      "addRange",
      "removeRange",
      "removeAllRanges",
      "collapse",
      "extend",
      "collapseToStart",
      "collapseToEnd",
      "selectAllChildren",
      "setBaseAndExtent",
      "setPosition",
      "empty",
      "deleteFromDocument",
    ] as const) {
      const original = selection[method];
      if (typeof original !== "function") continue;
      Object.defineProperty(selection, method, {
        configurable: true,
        value: (...args: unknown[]) => {
          selectionMethodDepth++;
          try {
            return Reflect.apply(original, selection, args);
          } finally {
            selectionMethodDepth--;
          }
        },
      });
    }
  }
  const dispatch = document.dispatchEvent.bind(document);
  document.dispatchEvent = (event: Event): boolean => {
    // Explicit dispatchEvent calls remain synchronous. Only Selection's own
    // notifications are queued, and never their capture/bubble phases.
    if (
      event.type !== "selectionchange" ||
      event.eventPhase !== Event.NONE ||
      selectionMethodDepth === 0
    ) {
      return dispatch(event);
    }
    setTimeout(() => dispatch(event), 0);
    return true;
  };
}
