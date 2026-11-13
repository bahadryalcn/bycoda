// Imported statically before React: react-scan must install the DevTools hook before react-dom
// evaluates (a top-level await here does not order sibling imports). Loaded before React (static import order + top-level await). Starts react-scan the
// way src/main.tsx does (`scan({ enabled: true })`) and adds only passive counters:
// scan's own onCommitStart / onRender callbacks feed window.__renderMeter.
import { scan, ReactScanInternals } from "react-scan";
type Bucket = Record<string, number>;
type Meter = {
  source: string;
  version: string;
  commits: number;
  renders: number;
  mounts: number;
  unmounts: number;
  byName: Bucket;
  mountsByName: Bucket;
};
const fresh = (): Meter => ({
  source: "react-scan scan({ onCommitStart, onRender })",
  version: "",
  commits: 0,
  renders: 0,
  mounts: 0,
  unmounts: 0,
  byName: {},
  mountsByName: {},
});
let meter = fresh();
// Visual acceptance uses the same product tree without the measurement overlay.
const visualOnly = new URLSearchParams(location.search).get("visual") === "1";
// Composite fibers only: function (0), class (1), forwardRef (11), simple memo (15).
// Host elements, providers, fragments and the memo wrapper (14) are not component renders.
const COMPOSITE = new Set([0, 1, 11, 15]);
meter.version = ReactScanInternals.version;
scan({
  enabled: !visualOnly,
  showToolbar: !visualOnly,
  onCommitStart() {
    meter.commits++;
  },
  onRender(fiber, renders) {
    if (!COMPOSITE.has(fiber.tag)) return;
    for (const render of renders) {
      const name = render.componentName || "Anonymous";
      if (render.phase === 4) {
        meter.unmounts++;
        continue;
      }
      meter.renders += render.count;
      meter.byName[name] = (meter.byName[name] ?? 0) + render.count;
      if (render.phase === 1) {
        meter.mounts++;
        meter.mountsByName[name] = (meter.mountsByName[name] ?? 0) + 1;
      }
    }
  },
});
const version = meter.version;
Object.assign(window, {
  __renderMeter: {
    reset() {
      meter = fresh();
      meter.version = version;
    },
    snapshot: () => JSON.parse(JSON.stringify(meter)) as Meter,
  },
});
