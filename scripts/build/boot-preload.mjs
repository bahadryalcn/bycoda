/**
 * Starts the workspace App chunk download beside the boot entry instead of after it.
 *
 * Startup is `index.html` -> `apps/desktop/src/main.ts` -> `src/main.tsx` -> `import("./app/App")`,
 * so the largest chunk was requested only after the main chunk had been evaluated. A
 * `modulepreload` link fetches and parses a module graph without evaluating it, so the
 * guarded order stays intact: the legacy storage migration at the top of `main.tsx` still
 * runs before any App module executes, and `loadWindowSurface` still decides the role.
 *
 * The tag is injected only into `index.html` (the other native pages are separate inputs
 * with their own entries) and is skipped by a small inline script for any window that
 * never evaluates App: host-tools windows and a plain-browser load that shows the
 * "requires the desktop app" failure.
 */

const APP_MODULE = /[\\/]src[\\/]app[\\/]App\.tsx$/;
const HTML_ENTRY = "/index.html";

/**
 * File names of the App chunk and its static chunk imports, minus `exclude`.
 * @param {Record<string, { type: string, fileName: string, imports?: string[], facadeModuleId?: string | null, modules?: Record<string, unknown> }>} bundle
 * @param {Iterable<string>} [exclude] files the page already preloads
 * @returns {string[]}
 */
export function appPreloadFiles(bundle, exclude = []) {
  const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
  const app =
    chunks.find((chunk) => chunk.facadeModuleId && APP_MODULE.test(chunk.facadeModuleId)) ??
    chunks.find((chunk) => Object.keys(chunk.modules ?? {}).some((id) => APP_MODULE.test(id)));
  if (!app) return [];
  const skip = new Set(exclude);
  const files = [];
  const visit = (fileName) => {
    if (skip.has(fileName) || files.includes(fileName)) return;
    const chunk = bundle[fileName];
    if (!chunk || chunk.type !== "chunk") return;
    files.push(fileName);
    for (const imported of chunk.imports ?? []) visit(imported);
  };
  visit(app.fileName);
  return files;
}

/** Runs in the page head before any module: warm the graph only for a window that boots App. */
export function preloadScript(hrefs) {
  return `(function(){if(!("__TAURI_INTERNALS__" in window)||new URLSearchParams(location.search).has("hostTools"))return;${JSON.stringify(hrefs)}.forEach(function(h){var l=document.createElement("link");l.rel="modulepreload";l.crossOrigin="";l.href=h;document.head.appendChild(l)})})();`;
}

/** @returns {import("vite").Plugin} */
export function bootAppPreload() {
  let base = "/";
  return {
    name: "bycoda-boot-app-preload",
    configResolved(config) {
      base = config.base.endsWith("/") ? config.base : `${config.base}/`;
    },
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        // Dev serves modules unbundled: there is no bundle and no chunk to preload.
        if (!ctx.bundle || ctx.path !== HTML_ENTRY) return;
        const entry = ctx.chunk;
        const loaded = entry ? [entry.fileName, ...(entry.imports ?? [])] : [];
        const files = appPreloadFiles(ctx.bundle, loaded);
        if (files.length === 0) {
          console.warn("[bycoda-boot-app-preload] App chunk not found; boot will not preload it");
          return;
        }
        return [
          {
            tag: "script",
            children: preloadScript(files.map((file) => `${base}${file}`)),
            injectTo: "head",
          },
        ];
      },
    },
  };
}
