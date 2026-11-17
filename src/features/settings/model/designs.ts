import { normalizeAppearanceSnapshot, type AppearanceSnapshot } from "./appearanceSnapshot";
import { normalizeThemeName, type SavedTheme } from "./savedThemes";

export type DesignKind = "image" | "scene" | "motion";
export type DesignDraft = {
  kind: DesignKind;
  name: string;
  prompt: string;
  look: AppearanceSnapshot;
  path?: string;
  /** Authored source, excluding the bundled offline runtime. */
  source?: string;
  saved?: SavedTheme;
};

/** Metadata is normalized again after a portable file crosses the native boundary. */
export function normalizeDesignMetadata(value: unknown): {
  name: string;
  kind: DesignKind | "theme";
  prompt: string;
  look: AppearanceSnapshot;
} {
  if (!value || typeof value !== "object") throw new Error("Invalid design file");
  const raw = value as Record<string, unknown>;
  const name = normalizeThemeName(raw.name);
  if (
    !name ||
    !["theme", "image", "scene", "motion"].includes(String(raw.kind)) ||
    typeof raw.prompt !== "string" ||
    raw.prompt.length > 8000 ||
    !raw.look ||
    typeof raw.look !== "object"
  )
    throw new Error("Invalid design metadata");
  return {
    name,
    kind: raw.kind as DesignKind | "theme",
    prompt: raw.prompt,
    look: normalizeAppearanceSnapshot(raw.look),
  };
}

/** A background creation cannot silently change fonts, colors or the app's other settings. */
export function designLook(kind: DesignKind, look: AppearanceSnapshot): AppearanceSnapshot {
  if (kind === "motion") return { motion: look.motion, live: look.live };
  return { image: look.image, live: { scene: "none", intensity: look.live?.intensity ?? 0.3 } };
}

/** Current state comes from the preference stores, so it survives reopening and renaming. */
export function designIsCurrent(draft: DesignDraft, selection: unknown, project: boolean): boolean {
  if (!selection || typeof selection !== "object") return false;
  const current = selection as Record<string, unknown>;
  const matches = (wanted: unknown, actual: unknown) =>
    !wanted ||
    (!!actual &&
      typeof actual === "object" &&
      Object.entries(wanted as Record<string, unknown>).every(
        ([key, value]) => (actual as Record<string, unknown>)[key] === value,
      ));
  if (draft.kind === "motion")
    return (
      !project &&
      !!(draft.look.motion || draft.look.live) &&
      matches(draft.look.motion, current.motion) &&
      matches(draft.look.live, current.live)
    );
  const identity = (path: string) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    return name.match(/(?:asset-)?([a-f0-9]{24,64})\./i)?.[1].slice(0, 24) ?? path;
  };
  if (
    typeof current.path !== "string" ||
    !draft.path ||
    identity(current.path) !== identity(draft.path)
  )
    return false;
  const { blur: _globalBlur, ...projectImage } = draft.look.image ?? {};
  return (
    matches(project ? projectImage : draft.look.image, project ? current : current.image) &&
    (!project ? matches(draft.look.live, current.live) : true)
  );
}
