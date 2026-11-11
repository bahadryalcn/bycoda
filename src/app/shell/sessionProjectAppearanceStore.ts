import { subscribeProjectPathsChanged } from "../../features/projects/model/recents";
import {
  loadRailBackgrounds,
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupLogos,
  loadTabGroupMascots,
  TAB_GROUP_LOGOS_CHANGED,
} from "../../features/workspace/model/tabGroups";

type Snapshot = {
  colors: ReturnType<typeof loadTabGroupColors>;
  customColors: ReturnType<typeof loadTabGroupCustomColors>;
  labels: ReturnType<typeof loadTabGroupLabels>;
  logos: ReturnType<typeof loadTabGroupLogos>;
  mascots: ReturnType<typeof loadTabGroupMascots>;
  backgrounds: Map<string, ReturnType<typeof loadRailBackgrounds>>;
};

function readSnapshot(): Snapshot {
  return {
    colors: loadTabGroupColors(),
    customColors: loadTabGroupCustomColors(),
    labels: loadTabGroupLabels(),
    logos: loadTabGroupLogos(),
    mascots: loadTabGroupMascots(),
    backgrounds: new Map(),
  };
}

const serverSnapshot: Snapshot = {
  colors: {},
  customColors: {},
  labels: {},
  logos: {},
  mascots: {},
  backgrounds: new Map(),
};
let snapshot: Snapshot | undefined;
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;

export function getSessionProjectAppearanceSnapshot(): Snapshot {
  if (typeof window === "undefined") return serverSnapshot;
  return (snapshot ??= readSnapshot());
}

export function getSessionProjectAppearanceServerSnapshot(): Snapshot {
  return serverSnapshot;
}

export function getSessionProjectBackground(
  snapshot: Snapshot,
  key: string,
  part: "header" | "body" = "header",
) {
  if (snapshot === serverSnapshot) return undefined;
  if (!snapshot.backgrounds.has(key)) snapshot.backgrounds.set(key, loadRailBackgrounds(key));
  return snapshot.backgrounds.get(key)?.[part];
}

export function subscribeSessionProjectAppearance(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    const refresh = () => {
      snapshot = readSnapshot();
      for (const callback of listeners) callback();
    };
    const unsubscribe = subscribeProjectPathsChanged(refresh);
    window.addEventListener(TAB_GROUP_LOGOS_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    // Catch changes between render and subscription, including while no cards were mounted.
    snapshot = readSnapshot();
    stop = () => {
      unsubscribe();
      window.removeEventListener(TAB_GROUP_LOGOS_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
      snapshot = undefined;
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop?.();
      stop = undefined;
    }
  };
}
