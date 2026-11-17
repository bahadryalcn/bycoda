import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { t } from "../../../shared/i18n";
import { projectKey } from "../../../shared/lib/paths";
import { addBackgroundLibraryImage, listBackgroundLibrary } from "../model/backgroundLibrary";
import {
  addSavedTheme,
  loadSavedThemes,
  saveSavedThemes,
  normalizeThemeName,
  type SavedTheme,
} from "../model/savedThemes";
import { designLook, normalizeDesignMetadata, type DesignDraft } from "../model/designs";
import { captureAppearanceSnapshot } from "../model/appearanceSnapshot";
import { loadChatBackgroundPath } from "../model/appearance";
import { chatBackgroundKind } from "../../../shared/lib/chatBackgroundKind";
import { rememberBackground } from "../model/backgroundHistory";
import {
  loadProjectChatBackgroundSettings,
  saveProjectChatBackgroundSettings,
} from "../../projects/public/projectChatBackground";
import {
  saveChatBackgroundFrom,
  validateChatBackgroundMedia,
} from "../../projects/public/chatBackground";
import { applySavedTheme } from "../ui/appearance/controls/savedThemeActions";
import type { AppearanceSettings } from "../ui/useAppearanceSettings";

const changed = () => new Error(t("The saved design changed. Reopen it before saving again."));

/** Load media before changing any active preference. Missing assets leave the current choice intact. */
export async function openSavedDesign(theme: SavedTheme): Promise<DesignDraft> {
  if (theme.creation && theme.creation.kind !== "motion" && !theme.imageId)
    throw new Error(t("Saved media is missing. Your current design is unchanged."));
  const kind = theme.creation?.kind ?? "image";
  const image = theme.imageId
    ? (await listBackgroundLibrary()).find((entry) => entry.id === theme.imageId)
    : undefined;
  if (theme.imageId && !image)
    throw new Error(t("Saved media is missing. Your current design is unchanged."));
  if (image) await validateChatBackgroundMedia(image.path);
  const source =
    image && chatBackgroundKind(image.path) === "html"
      ? await invoke<string>("read_chat_background_html", { path: image.path })
      : undefined;
  return {
    kind: source ? "scene" : kind,
    name: theme.name,
    prompt: theme.creation?.prompt ?? "",
    look: theme.look,
    path: image?.path,
    source,
    saved: theme,
  };
}

/** Merge independent sibling saves; hold a conflicting edit instead of overwriting it. */
export async function saveDesign(
  draft: DesignDraft,
  replace = false,
  authorized: () => Promise<boolean> = async () => true,
): Promise<SavedTheme> {
  const name = normalizeThemeName(draft.name);
  if (!name) throw new Error(t("Enter a design name."));
  if (draft.kind !== "motion" && !draft.path)
    throw new Error(t("Create or import a background first."));
  if (draft.path) await validateChatBackgroundMedia(draft.path);
  const image = draft.path
    ? await addBackgroundLibraryImage(draft.path, { source: "generated", prompt: draft.prompt })
    : undefined;
  if (!(await authorized())) throw new Error("Background authority changed");
  const themes = loadSavedThemes();
  const look = designLook(draft.kind, draft.look);
  let result: SavedTheme;
  let next: SavedTheme[];
  if (replace && draft.saved) {
    const current = themes.find((entry) => entry.id === draft.saved?.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(draft.saved)) throw changed();
    result = {
      ...current,
      name,
      look,
      imageId: image?.id,
      backgroundPaths: image?.id === current.imageId ? current.backgroundPaths : undefined,
      creation: { kind: draft.kind, prompt: draft.prompt },
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    };
    next = themes.map((entry) => (entry.id === result.id ? result : entry));
  } else {
    next = addSavedTheme(
      themes,
      { name, look, imageId: image?.id, creation: { kind: draft.kind, prompt: draft.prompt } },
      Date.now(),
      crypto.randomUUID(),
    );
    if (next.length === themes.length)
      throw new Error(t("The saved design library is full. Delete a design first."));
    result = next[next.length - 1];
  }
  if (!saveSavedThemes(next)) throw new Error(t("Could not save the theme."));
  return result;
}

export async function applyDesign(
  appearance: AppearanceSettings,
  draft: DesignDraft,
  project?: string,
) {
  if (project) {
    if (draft.kind === "motion") throw new Error(t("Motion presets apply to the app."));
    if (!draft.path) throw new Error(t("Create or import a background first."));
    const target = projectKey(project);
    const previous = loadProjectChatBackgroundSettings(target);
    const path = await saveChatBackgroundFrom(draft.path);
    await validateChatBackgroundMedia(path);
    if (JSON.stringify(loadProjectChatBackgroundSettings(target)) !== JSON.stringify(previous))
      throw changed();
    const image = draft.look.image ?? captureAppearanceSnapshot().image!;
    rememberBackground([path, previous?.path ?? null], target);
    saveProjectChatBackgroundSettings(
      target,
      {
        path,
        emptyOpacity: image.emptyOpacity,
        sessionOpacity: image.sessionOpacity,
        scope: image.scope,
        effect: image.effect,
      },
      true,
    );
    return;
  }
  // A transient library copy gives applySavedTheme its existing validated asset path.
  const previous = loadChatBackgroundPath();
  const image = draft.path ? await addBackgroundLibraryImage(draft.path) : undefined;
  if (loadChatBackgroundPath() !== previous) throw changed();
  const theme: SavedTheme = {
    id: draft.saved?.id ?? "draft",
    name: draft.name,
    createdAt: 0,
    updatedAt: 0,
    look: designLook(draft.kind, draft.look),
    imageId: image?.id,
    creation: { kind: draft.kind, prompt: draft.prompt },
  };
  if ((await applySavedTheme(appearance, theme)) !== "applied")
    throw new Error(t("Saved media is missing. Your current design is unchanged."));
}

export async function exportDesign(theme: SavedTheme): Promise<void> {
  const image = theme.imageId
    ? (await listBackgroundLibrary()).find((entry) => entry.id === theme.imageId)
    : undefined;
  if (theme.imageId && !image)
    throw new Error(t("Saved media is missing. Your current design is unchanged."));
  const path = await save({
    defaultPath: `${theme.name}.bycoda-design.json`,
    filters: [{ name: t("Saved designs"), extensions: ["json"] }],
  });
  if (!path) return;
  await invoke("export_appearance_design", {
    path,
    design: {
      name: theme.name,
      kind: theme.creation?.kind ?? "theme",
      look: theme.look,
      prompt: theme.creation?.prompt ?? "",
    },
    assetPath: image?.path ?? null,
  });
}

export async function importDesign(): Promise<SavedTheme | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: t("Saved designs"), extensions: ["json"] }],
  });
  if (typeof path !== "string") return null;
  const imported = await invoke<{ design: unknown; assetPath: string | null }>(
    "import_appearance_design",
    { path },
  );
  const metadata = normalizeDesignMetadata(imported.design);
  if (metadata.kind !== "motion" && metadata.kind !== "theme" && !imported.assetPath)
    throw new Error(t("Saved media is missing. Your current design is unchanged."));
  const image = imported.assetPath
    ? (await validateChatBackgroundMedia(imported.assetPath),
      await addBackgroundLibraryImage(imported.assetPath))
    : undefined;
  const before = loadSavedThemes();
  const after = addSavedTheme(
    before,
    {
      name: metadata.name,
      look: metadata.kind === "theme" ? metadata.look : designLook(metadata.kind, metadata.look),
      imageId: image?.id,
      ...(metadata.kind !== "theme"
        ? { creation: { kind: metadata.kind, prompt: metadata.prompt } }
        : {}),
    },
    Date.now(),
    crypto.randomUUID(),
  );
  if (after.length === before.length || !saveSavedThemes(after))
    throw new Error(t("Could not save the theme."));
  return after[after.length - 1];
}
