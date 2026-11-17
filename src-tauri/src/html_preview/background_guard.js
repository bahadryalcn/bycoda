// CSP does not consistently gate WebRTC. Retire capabilities before authored code.
(() => {
  for (const key of [
    "RTCPeerConnection",
    "webkitRTCPeerConnection",
    "mozRTCPeerConnection",
    "webkit",
    "WebTransport",
    "WebSocket",
    "Worker",
    "SharedWorker",
    // WebView2's immutable IPC shims look up this transport at call time.
    "chrome",
    "__TAURI_INTERNALS__",
    "__TAURI__",
    "__TAURI_IPC__",
  ]) {
    const property = Object.getOwnPropertyDescriptor(globalThis, key);
    if (!property || property.configurable) {
      Object.defineProperty(globalThis, key, {
        value: undefined,
        writable: false,
        configurable: false,
      });
    } else if (property.writable) {
      Object.defineProperty(globalThis, key, { value: undefined, writable: false });
    } else if (property.value && typeof property.value === "object") {
      // WebView2 injects a nonconfigurable, readonly { plugins: {} } placeholder
      // even into opaque frames. Empty and seal it instead of redefining its global.
      for (const member of Reflect.ownKeys(property.value)) {
        const field = Object.getOwnPropertyDescriptor(property.value, member);
        if (field.configurable) delete property.value[member];
        else if (field.writable)
          Object.defineProperty(property.value, member, { value: undefined });
      }
      Object.setPrototypeOf(property.value, null);
      Object.freeze(property.value);
    }
  }
  // CSP frame-src does not cover about:blank, so a frame would be a fresh realm with
  // unpatched constructors. Refuse to create, expose or keep any nested browsing context.
  if (typeof Document === "undefined" || typeof MutationObserver === "undefined") return;
  const blocked = /^(i?frame|object|embed)$/i;
  const originalCreate = Document.prototype.createElement;
  Object.defineProperty(Document.prototype, "createElement", {
    value: function createElement(name, ...rest) {
      if (blocked.test(String(name)))
        throw new DOMException("Frames are disabled", "NotSupportedError");
      return originalCreate.call(this, name, ...rest);
    },
    configurable: false,
    writable: false,
  });
  for (const key of ["contentWindow", "contentDocument"]) {
    for (const name of [
      "HTMLIFrameElement",
      "HTMLFrameElement",
      "HTMLObjectElement",
      "HTMLEmbedElement",
    ]) {
      const type = globalThis[name];
      if (type && type.prototype && Object.getOwnPropertyDescriptor(type.prototype, key)) {
        Object.defineProperty(type.prototype, key, { get: () => null, configurable: false });
      }
    }
  }
  const sweep = (node) => {
    if (node.nodeType !== 1) return;
    if (blocked.test(node.localName)) node.remove();
    else node.querySelectorAll("iframe,frame,object,embed").forEach((frame) => frame.remove());
  };
  new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(sweep);
  }).observe(document, { childList: true, subtree: true });
})();
