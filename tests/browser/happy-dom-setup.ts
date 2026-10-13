// Happy DOM 20.14 dispatches selectionchange synchronously. Real browsers queue
// it, otherwise CodeMirror receives a nested update while changing selection.
// Remove this shim once happy-dom includes upstream fix #2325.
if (typeof document !== "undefined" && "happyDOM" in window) {
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
