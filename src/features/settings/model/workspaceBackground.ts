import { createStore } from "../../../shared/lib/store";
import {
  acceptAppearanceStorageChange,
  readAppearanceSaveIssues,
  readAppearanceValue,
  registerAppearanceSaveFailure,
  writeAppearanceValue,
} from "./appearancePersistence";
import {
  WORKSPACE_BACKGROUND_DEFAULT,
  WORKSPACE_BACKGROUND_PRESETS,
  workspaceBackgroundImage,
  type WorkspaceBackground,
} from "../../../shared/theme/workspaceBackground";

export { WORKSPACE_BACKGROUND_DEFAULT, WORKSPACE_BACKGROUND_PRESETS };
export type { WorkspaceBackground };
const KEY = "bycoda.workspaceBackground.v1";
const listeners = createStore();
let cachedRaw: string | null | undefined;
let snapshot: WorkspaceBackground = WORKSPACE_BACKGROUND_DEFAULT;
let baseline: WorkspaceBackground = WORKSPACE_BACKGROUND_DEFAULT;
let pendingBaseline: WorkspaceBackground | undefined;
let lastWritten: WorkspaceBackground | undefined;
const lastWrittenFields = new Set<keyof WorkspaceBackground>();
let issue: "unavailable" | "conflict" | null = null;
let watching = false;
export const readWorkspaceBackgroundIssue = () => issue;
function setIssue(next: typeof issue, emit = true) {
  if (issue === next) return;
  issue = next;
  if (emit) listeners.notify();
}

export function normalizeWorkspaceBackground(input: unknown): WorkspaceBackground {
  const raw = input && typeof input === "object" ? (input as Partial<WorkspaceBackground>) : {};
  const colors =
    Array.isArray(raw.colors) &&
    raw.colors.length === 3 &&
    raw.colors.every((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c))
      ? (raw.colors.map((c) => c.toLowerCase()) as [string, string, string])
      : ([...WORKSPACE_BACKGROUND_DEFAULT.colors] as [string, string, string]);
  const number = (v: unknown, fallback: number, max: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(0, Math.min(max, Math.round(v)))
      : fallback;
  return {
    enabled: raw.enabled === true,
    style:
      raw.style === "radial" || raw.style === "mesh" || raw.style === "solid"
        ? raw.style
        : "linear",
    colors,
    angle: number(raw.angle, WORKSPACE_BACKGROUND_DEFAULT.angle, 360),
    strength: number(raw.strength, WORKSPACE_BACKGROUND_DEFAULT.strength, 100),
  };
}

export function loadWorkspaceBackground(): WorkspaceBackground {
  let raw: string | null;
  try {
    raw = readAppearanceValue(KEY);
  } catch {
    setIssue("unavailable", false);
    return snapshot;
  }
  if (raw === cachedRaw) {
    if (issue === "unavailable" && !readAppearanceSaveIssues().some((entry) => entry.key === KEY))
      setIssue(null, false);
    return snapshot;
  }
  try {
    snapshot = normalizeWorkspaceBackground(raw ? JSON.parse(raw) : null);
  } catch {
    // Malformed external data cannot replace the last usable value.
    setIssue("unavailable", false);
    return snapshot;
  }
  cachedRaw = raw;
  if (issue === "unavailable" && !readAppearanceSaveIssues().some((entry) => entry.key === KEY))
    setIssue(null, false);
  if (!readAppearanceSaveIssues().some((issue) => issue.key === KEY)) baseline = snapshot;
  return snapshot;
}

/**
 * Mean colour and HSL lightness of the artwork stops (the first stop for a solid fill). Layers
 * derive from the canvas veiled over this (--ui-layer-base in src/styles/index.css), so fields,
 * borders and selection step away from the ground the artwork really shows.
 */
export function workspaceBackgroundGround(value: WorkspaceBackground): {
  color: string;
  lightness: number;
} {
  const stops = value.style === "solid" ? [value.colors[0]] : value.colors;
  const channels = [1, 3, 5].map((offset) => {
    const sum = stops.reduce(
      (total, hex) => total + Number.parseInt(hex.slice(offset, offset + 2), 16),
      0,
    );
    return Math.round(sum / stops.length);
  });
  const lightness = (Math.max(...channels) + Math.min(...channels)) / 2 / 2.55;
  return {
    color: `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`,
    lightness: Math.round(lightness * 10) / 10,
  };
}

export function applyWorkspaceBackground(value: WorkspaceBackground) {
  const safe = normalizeWorkspaceBackground(value);
  const root = document.documentElement;
  root.classList.toggle("has-workspace-background", safe.enabled);
  if (safe.enabled) {
    root.style.setProperty("--workspace-background-image", workspaceBackgroundImage(safe));
    root.style.setProperty("--workspace-background-strength", String(safe.strength / 100));
    const ground = workspaceBackgroundGround(safe);
    root.style.setProperty("--workspace-background-ground", ground.color);
    root.style.setProperty("--workspace-background-lightness", `${ground.lightness}%`);
  } else {
    root.style.removeProperty("--workspace-background-ground");
    root.style.removeProperty("--workspace-background-lightness");
    root.style.removeProperty("--workspace-background-image");
    root.style.removeProperty("--workspace-background-strength");
  }
}

function notify() {
  cachedRaw = undefined;
  applyWorkspaceBackground(loadWorkspaceBackground());
  if (!readAppearanceSaveIssues().some((entry) => entry.key === KEY)) pendingBaseline = undefined;
  listeners.notify();
}

export function saveWorkspaceBackground(
  value: WorkspaceBackground,
  options: {
    base?: WorkspaceBackground;
    replace?: boolean;
    fields?: (keyof WorkspaceBackground)[];
  } = {},
): boolean {
  if (cachedRaw === undefined) loadWorkspaceBackground();
  const draft = normalizeWorkspaceBackground(value);
  const replace = options.replace === true;
  const editBase = pendingBaseline ?? options.base ?? baseline;
  let base: string | null;
  try {
    base = localStorage.getItem(KEY);
  } catch {
    // A failed read is unknown, not evidence that the stored value is absent.
    setIssue("unavailable");
    pendingBaseline = editBase;
    const retry = () => saveWorkspaceBackground(value, options);
    registerAppearanceSaveFailure({
      key: KEY,
      value: JSON.stringify(draft),
      settingId: "workspace-background",
      applied: true,
      notify,
      retry,
    });
    notify();
    return false;
  }
  let current: WorkspaceBackground;
  try {
    current = normalizeWorkspaceBackground(base ? JSON.parse(base) : null);
  } catch {
    if (replace) current = normalizeWorkspaceBackground(null);
    else {
      setIssue("unavailable");
      pendingBaseline = editBase;
      registerAppearanceSaveFailure({
        key: KEY,
        value: JSON.stringify(draft),
        settingId: "workspace-background",
        applied: true,
        notify,
        retry: () => saveWorkspaceBackground(value, options),
      });
      notify();
      return false;
    }
  }
  const edited = (field: keyof WorkspaceBackground) =>
    replace ||
    options.fields?.includes(field) === true ||
    JSON.stringify(draft[field]) !== JSON.stringify(editBase[field]);
  const serialized = JSON.stringify({
    enabled: edited("enabled") ? draft.enabled : current.enabled,
    style: edited("style") ? draft.style : current.style,
    colors: edited("colors") ? draft.colors : current.colors,
    angle: edited("angle") ? draft.angle : current.angle,
    strength: edited("strength") ? draft.strength : current.strength,
  });
  const retry = () => {
    let latest: WorkspaceBackground;
    try {
      const raw = localStorage.getItem(KEY);
      latest = normalizeWorkspaceBackground(raw ? JSON.parse(raw) : null);
    } catch {
      setIssue("unavailable");
      return false;
    }
    const fields: (keyof WorkspaceBackground)[] = [
      "enabled",
      "style",
      "colors",
      "angle",
      "strength",
    ];
    if (
      fields.some(
        (field) =>
          edited(field) &&
          JSON.stringify(latest[field]) !== JSON.stringify(current[field]) &&
          JSON.stringify(latest[field]) !== JSON.stringify(draft[field]),
      )
    ) {
      setIssue("conflict");
      return false;
    }
    return saveWorkspaceBackground(draft, { base: editBase, replace, fields: options.fields });
  };
  const fields: (keyof WorkspaceBackground)[] = ["enabled", "style", "colors", "angle", "strength"];
  if (
    !replace &&
    fields.some(
      (field) =>
        edited(field) &&
        JSON.stringify(current[field]) !== JSON.stringify(editBase[field]) &&
        (pendingBaseline !== undefined ||
          lastWritten === undefined ||
          !lastWrittenFields.has(field) ||
          JSON.stringify(current[field]) !== JSON.stringify(lastWritten[field])) &&
        JSON.stringify(current[field]) !== JSON.stringify(draft[field]),
    )
  ) {
    pendingBaseline = editBase;
    registerAppearanceSaveFailure({
      key: KEY,
      value: JSON.stringify(draft),
      settingId: "workspace-background",
      applied: true,
      notify,
      retry,
    });
    setIssue("conflict");
    notify();
    return false;
  }
  const ok = writeAppearanceValue(KEY, serialized, "workspace-background", notify, true, retry);
  if (!ok) pendingBaseline = editBase;
  else {
    for (const field of fields) {
      if (edited(field)) lastWrittenFields.add(field);
      else if (JSON.stringify(current[field]) !== JSON.stringify(lastWritten?.[field]))
        lastWrittenFields.delete(field);
    }
    lastWritten = normalizeWorkspaceBackground(JSON.parse(serialized));
    pendingBaseline = undefined;
    setIssue(null);
  }
  return ok;
}

export function subscribeWorkspaceBackground(listener: () => void) {
  return listeners.subscribe(listener);
}

export function initWorkspaceBackground() {
  applyWorkspaceBackground(loadWorkspaceBackground());
  if (watching) return;
  watching = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY && event.key !== null) return;
    lastWritten = undefined;
    lastWrittenFields.clear();
    // Keep an unsaved draft; a retry checks its original durable value first.
    if (readAppearanceSaveIssues().some((issue) => issue.key === KEY)) return;
    acceptAppearanceStorageChange(KEY);
    notify();
  });
}
