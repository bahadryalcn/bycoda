import { listenWindow } from "../../platform/tauri/listenWindow";

type Rect = { x: number; y: number; width: number; height: number };
type Geometry = Rect & { maximized?: boolean };
const KEY = "bycoda.tools-hub.geometry.v1";

/** Physical coordinates support monitors with different scaling and removed displays. */
export function reachableToolsGeometry(
  saved: Geometry,
  monitors: readonly Rect[],
): Geometry | null {
  if (!monitors.length || ![saved.x, saved.y, saved.width, saved.height].every(Number.isFinite))
    return null;
  const monitor =
    monitors.find(
      (rect) =>
        saved.x >= rect.x &&
        saved.x < rect.x + rect.width &&
        saved.y >= rect.y &&
        saved.y < rect.y + rect.height,
    ) ?? monitors[0];
  const width = Math.min(Math.max(360, saved.width), monitor.width);
  const height = Math.min(Math.max(320, saved.height), monitor.height);
  return {
    x: Math.round(Math.min(Math.max(saved.x, monitor.x), monitor.x + monitor.width - width)),
    y: Math.round(Math.min(Math.max(saved.y, monitor.y), monitor.y + monitor.height - height)),
    width: Math.round(width),
    height: Math.round(height),
    maximized: saved.maximized === true,
  };
}

export async function retainToolsWindowGeometry() {
  const [{ getCurrentWebviewWindow }, { availableMonitors }, { PhysicalPosition, PhysicalSize }] =
    await Promise.all([
      import("@tauri-apps/api/webviewWindow"),
      import("@tauri-apps/api/window"),
      import("@tauri-apps/api/dpi"),
    ]);
  const view = getCurrentWebviewWindow();
  try {
    const input = localStorage.getItem(KEY);
    if (input) {
      const monitors = await availableMonitors();
      const saved = reachableToolsGeometry(
        JSON.parse(input),
        monitors.map((monitor) => ({ ...monitor.position, ...monitor.size })),
      );
      if (saved) {
        await view.setSize(new PhysicalSize(saved.width, saved.height));
        await view.setPosition(new PhysicalPosition(saved.x, saved.y));
        if (saved.maximized) await view.maximize();
      }
    }
  } catch {
    /* Invalid or unavailable layout never prevents opening tools. */
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const remember = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void Promise.all([view.outerPosition(), view.outerSize(), view.isMaximized()])
        .then(([position, size, maximized]) => {
          if (stopped) return;
          // Keep normal bounds when maximized; those are the reachable restore bounds.
          if (maximized) {
            const previous = localStorage.getItem(KEY);
            if (previous)
              localStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(previous), maximized }));
          } else localStorage.setItem(KEY, JSON.stringify({ ...position, ...size, maximized }));
        })
        .catch(() => {});
    }, 250);
  };
  const moved = listenWindow("tauri://move", remember);
  const resized = listenWindow("tauri://resize", remember);
  remember();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    moved();
    resized();
  };
}
