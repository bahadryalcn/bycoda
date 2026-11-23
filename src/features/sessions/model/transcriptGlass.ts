import { IS_LINUX } from "../../../platform/tauri/platform";

/**
 * Engine and platform fallback, not a GPU probe: it does not detect software rendering, and not
 * every WebKitGTK install renders this way. Measured with Playwright WebKit on Linux under WSL
 * (software compositing), a 40-message transcript painted scroll frames in 1.3-8 s with one
 * `backdrop-filter` per message surface and in about 0.1 s without, whatever the blur radius, so
 * the cost is per layer. Chromium and WebKit on other platforms were not affected and keep the
 * glass.
 *
 * Where this applies, only the repeated per-message blur is dropped. Each message keeps its fill,
 * edge and settings; the composer, the activity dock and floating panels keep their one glass layer.
 *
 * `webkitConvertPointFromPageToNode` is a legacy API only WebKit still ships, so it tells WebKit
 * from Chromium on Linux without reading the user agent.
 */
export function isLinuxWebKit(linux: boolean, scope: object): boolean {
  return linux && "webkitConvertPointFromPageToNode" in scope;
}

export const FLAT_TRANSCRIPT_GLASS =
  typeof window !== "undefined" && isLinuxWebKit(IS_LINUX, window);
