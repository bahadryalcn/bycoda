import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { appPreloadFiles, bootAppPreload, preloadScript } from "./boot-preload.mjs";

const chunk = (fileName, imports = [], extra = {}) => ({
  type: "chunk",
  fileName,
  imports,
  ...extra,
});

function bundleFixture() {
  return {
    "assets/main-a.js": chunk("assets/main-a.js", ["assets/runtime.js", "assets/shared.js"], {
      facadeModuleId: "G:/repo/apps/desktop/src/main.ts",
    }),
    "assets/runtime.js": chunk("assets/runtime.js"),
    "assets/shared.js": chunk("assets/shared.js", ["assets/runtime.js"]),
    "assets/App-b.js": chunk("assets/App-b.js", ["assets/shared.js", "assets/vendor.js"], {
      facadeModuleId: "G:\\repo\\src\\app\\App.tsx",
      isDynamicEntry: true,
    }),
    "assets/vendor.js": chunk("assets/vendor.js", ["assets/runtime.js"]),
    "assets/style.css": { type: "asset", fileName: "assets/style.css" },
  };
}

test("preloads the App chunk and its static graph, skipping what the page already loads", () => {
  const entry = ["assets/main-a.js", "assets/runtime.js", "assets/shared.js"];
  assert.deepEqual(appPreloadFiles(bundleFixture(), entry), [
    "assets/App-b.js",
    "assets/vendor.js",
  ]);
});

test("finds an App module merged into another chunk and ignores assets", () => {
  const bundle = bundleFixture();
  bundle["assets/App-b.js"].facadeModuleId = null;
  bundle["assets/App-b.js"].modules = { "G:/repo/src/app/App.tsx": {} };
  assert.deepEqual(appPreloadFiles(bundle, []).slice(0, 1), ["assets/App-b.js"]);
  assert.deepEqual(appPreloadFiles({ "a.css": { type: "asset", fileName: "a.css" } }), []);
});

test("returns nothing, without throwing, when the bundle has no App chunk", () => {
  assert.deepEqual(appPreloadFiles({ "assets/main-a.js": chunk("assets/main-a.js") }), []);
});

function runPreload(window, search) {
  const links = [];
  const document = {
    head: { appendChild: (link) => links.push(link) },
    createElement: () => ({}),
  };
  vm.runInNewContext(preloadScript(["/assets/App-b.js", "/assets/vendor.js"]), {
    ...window,
    window,
    document,
    location: { search },
    URLSearchParams,
  });
  return links;
}

test("injected script warms App as modulepreload only for a native workspace window", () => {
  const links = runPreload({ __TAURI_INTERNALS__: {} }, "");
  assert.deepEqual(
    links.map((link) => [link.rel, link.href, link.crossOrigin]),
    [
      ["modulepreload", "/assets/App-b.js", ""],
      ["modulepreload", "/assets/vendor.js", ""],
    ],
  );
  // Tool windows never evaluate App; a plain browser only shows the failure screen.
  assert.deepEqual(runPreload({ __TAURI_INTERNALS__: {} }, '?hostTools={"cwd":"/r"}'), []);
  assert.deepEqual(runPreload({}, ""), []);
});

test("plugin injects one head script into index.html only, and nothing in dev", () => {
  const plugin = bootAppPreload();
  plugin.configResolved({ base: "/" });
  const { handler, order } = plugin.transformIndexHtml;
  assert.equal(order, "post");
  const bundle = bundleFixture();
  const entry = bundle["assets/main-a.js"];
  const tags = handler("", { path: "/index.html", bundle, chunk: entry });
  assert.equal(tags.length, 1);
  assert.equal(tags[0].tag, "script");
  assert.equal(tags[0].injectTo, "head");
  assert.match(tags[0].children, /"\/assets\/App-b\.js","\/assets\/vendor\.js"/);
  assert.doesNotMatch(tags[0].children, /shared\.js|runtime\.js/);
  assert.equal(handler("", { path: "/quick-composer.html", bundle, chunk: entry }), undefined);
  assert.equal(handler("", { path: "/index.html" }), undefined);
});
