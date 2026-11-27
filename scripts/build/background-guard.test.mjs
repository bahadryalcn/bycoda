import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

const guard = await readFile(
  new URL("../../src-tauri/src/html_preview/background_guard.js", import.meta.url),
  "utf8",
);

test("background guard tolerates native readonly placeholders without exposing a mutable bridge", () => {
  const context = createContext({});
  runInContext(
    `Object.defineProperty(globalThis, '__TAURI_INTERNALS__', { value: { plugins: {} } });`,
    context,
  );
  assert.doesNotThrow(() => runInContext(guard, context));
  assert.equal(runInContext("Object.keys(__TAURI_INTERNALS__).length", context), 0);
  assert.equal(runInContext("Object.isFrozen(__TAURI_INTERNALS__)", context), true);
  assert.equal(runInContext("Object.getPrototypeOf(__TAURI_INTERNALS__)", context), null);
  assert.equal(runInContext("typeof __TAURI_INTERNALS__.invoke", context), "undefined");
  assert.equal(runInContext("typeof __TAURI_IPC__", context), "undefined");
});

test("background capabilities stay retired, including readonly configurable and writable fixed globals", () => {
  const context = createContext({});
  runInContext(
    `Object.defineProperty(globalThis, 'WebSocket', { value: function(){}, writable: true }); Object.defineProperty(globalThis, 'Worker', { value: function(){}, configurable: true });`,
    context,
  );
  runInContext(guard, context);
  for (const key of [
    "RTCPeerConnection",
    "WebTransport",
    "WebSocket",
    "Worker",
    "SharedWorker",
    "__TAURI__",
  ]) {
    assert.equal(runInContext(`typeof globalThis[${JSON.stringify(key)}]`, context), "undefined");
    assert.throws(
      () =>
        runInContext(
          `Object.defineProperty(globalThis, ${JSON.stringify(key)}, { value: function(){} })`,
          context,
        ),
      /Cannot redefine property/,
    );
  }
  assert.doesNotThrow(() => runInContext(guard, context));
});

test("immutable native shims cannot recover their WebView2 transport", () => {
  const context = createContext({});
  runInContext(
    `
    globalThis.chrome = { webview: { postMessage() { throw new Error('native transport reached'); } } };
    const bridge = {};
    Object.defineProperty(bridge, 'invoke', { value: () => globalThis.chrome.webview.postMessage('test') });
    Object.defineProperty(globalThis, '__TAURI_INTERNALS__', { value: bridge });
  `,
    context,
  );
  assert.doesNotThrow(() => runInContext(guard, context));
  assert.equal(runInContext("typeof chrome", context), "undefined");
  assert.throws(
    () => runInContext("__TAURI_INTERNALS__.invoke()", context),
    /Cannot read properties of undefined/,
  );
  assert.throws(
    () => runInContext("Object.defineProperty(globalThis, 'chrome', { value: {} })", context),
    /Cannot redefine property/,
  );
});
