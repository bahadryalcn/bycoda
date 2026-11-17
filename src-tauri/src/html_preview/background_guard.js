// CSP does not consistently gate WebRTC. Retire capabilities before authored code.
(() => {
  for (const key of [
    "RTCPeerConnection",
    "webkitRTCPeerConnection",
    "mozRTCPeerConnection",
    "WebTransport",
    "WebSocket",
    "Worker",
    "SharedWorker",
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
})();
