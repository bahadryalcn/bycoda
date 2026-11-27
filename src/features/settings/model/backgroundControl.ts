import { invoke } from "@tauri-apps/api/core";
import {
  applyChatBackground,
  loadChatBackgroundPath,
  saveChatBackgroundPath,
  loadChatBackgroundEmptyOpacity,
  loadChatBackgroundSessionOpacity,
  loadChatBackgroundScope,
} from "./appearance";
import {
  loadProjectChatBackgroundSettings,
  saveProjectChatBackgroundSettings,
} from "../../projects/public/projectChatBackground";
import { rememberBackground } from "./backgroundHistory";
import { projectKey } from "../../../shared/lib/paths";
import { chatBackgroundKind } from "../../../shared/lib/chatBackgroundKind";
import { authoredSceneSource } from "./designSource";
import { backgroundDesign, backgroundMediaId } from "./backgroundNames";
import { loadSavedThemes } from "./savedThemes";
import { listBackgroundLibrary } from "./backgroundLibrary";
import { captureAppearanceSnapshot } from "./appearanceSnapshot";
import { saveDesign } from "../runtime/savedDesigns";

/** Read only the effective choice for this authenticated project, never a caller-named file. */
export async function readConversationBackground(
  input: Record<string, unknown>,
  project: string,
  authorized: () => Promise<boolean>,
) {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 32000;
  if (
    Object.keys(input).some(
      (key) => !["target", "offset", "limit", "expectedPath", "designId"].includes(key),
    ) ||
    !["global", "project"].includes(String(input.target)) ||
    !Number.isSafeInteger(offset) ||
    Number(offset) < 0 ||
    Number(offset) > 2097152 ||
    !Number.isSafeInteger(limit) ||
    Number(limit) < 1 ||
    Number(limit) > 32000 ||
    (input.designId !== undefined &&
      (typeof input.designId !== "string" || !input.designId || input.designId.length > 100)) ||
    (input.expectedPath !== undefined &&
      (typeof input.expectedPath !== "string" || input.expectedPath.length > 4096))
  )
    throw new Error("Invalid background read request");
  if (!(await authorized())) throw new Error("Background authority unavailable");
  const themes = loadSavedThemes();
  const saved =
    input.designId === undefined ? undefined : themes.find((entry) => entry.id === input.designId);
  if (input.designId !== undefined && (!saved?.imageId || saved.creation?.kind === "motion"))
    throw new Error("Saved background is unavailable");
  const asset = saved
    ? (await listBackgroundLibrary()).find((entry) => entry.id === saved.imageId)
    : undefined;
  if (saved && !asset) throw new Error("Saved background media is missing");
  const selection = () => {
    if (saved) {
      if (
        JSON.stringify(loadSavedThemes().find((entry) => entry.id === saved.id)) !==
        JSON.stringify(saved)
      )
        throw new Error("Saved background changed; restart the source read");
      return { target: input.target, path: asset!.path, scope: saved.look.image?.scope ?? "all" };
    }
    const override =
      input.target === "project" ? loadProjectChatBackgroundSettings(projectKey(project)) : null;
    return {
      target: override ? "project" : "global",
      path: override?.path ?? loadChatBackgroundPath(),
      scope: override?.scope ?? loadChatBackgroundScope(),
    };
  };
  const current = selection();
  const selected = () => {
    if (!current.path) return false;
    const override =
      input.target === "project" ? loadProjectChatBackgroundSettings(projectKey(project)) : null;
    const active = override?.path ?? loadChatBackgroundPath();
    return (
      current.path === active ||
      (!!active &&
        !!backgroundMediaId(current.path) &&
        backgroundMediaId(current.path) === backgroundMediaId(active))
    );
  };
  const design = saved ?? (current.path ? backgroundDesign(current.path, themes) : undefined);
  const metadata = {
    designId: design?.id,
    title: design?.name,
    updatedAt: design?.updatedAt,
    designs: themes
      .filter((entry) => entry.imageId && entry.creation?.kind !== "motion")
      .map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
  };
  if (!(await authorized())) throw new Error("Background authority changed");
  if (input.expectedPath !== undefined && input.expectedPath !== current.path)
    throw new Error("Background selection changed; restart the source read");
  if (!current.path) return { selected: false, ...current, ...metadata };
  const kind = chatBackgroundKind(current.path);
  if (kind !== "html") return { selected: selected(), ...current, kind, ...metadata };
  const html = await invoke<string>("read_chat_background_html", { path: current.path });
  if (!(await authorized()) || JSON.stringify(selection()) !== JSON.stringify(current))
    throw new Error("Background authority or selection changed");
  const source = authoredSceneSource(html);
  const end = Number(offset) + Number(limit);
  return {
    selected: selected(),
    ...current,
    ...metadata,
    kind,
    html: source.slice(Number(offset), end),
    runtime: source === html ? "html" : "three",
    offset,
    nextOffset: end < source.length ? end : null,
    totalCharacters: source.length,
  };
}

/** The caller owns authenticated session/lock checks; recheck before the durable mutation. */
export async function applyConversationBackground(
  input: Record<string, unknown>,
  project: string,
  authorized: () => Promise<boolean>,
  saveOnly = false,
) {
  project = projectKey(project);
  if (
    Object.keys(input).some(
      (key) =>
        !["html", "title", "target", "confirmed", "designId", "expectedUpdatedAt"].includes(key),
    ) ||
    input.confirmed !== true ||
    !["global", "project"].includes(String(input.target)) ||
    typeof input.html !== "string" ||
    !input.html.trim() ||
    input.html.length > 2097152 ||
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.title.length > 160 ||
    (input.designId !== undefined &&
      (typeof input.designId !== "string" || !input.designId || input.designId.length > 100)) ||
    (input.designId === undefined) !== (input.expectedUpdatedAt === undefined) ||
    (input.expectedUpdatedAt !== undefined &&
      (!Number.isSafeInteger(input.expectedUpdatedAt) || Number(input.expectedUpdatedAt) < 0))
  )
    throw new Error("Invalid background apply request");
  if (!(await authorized())) throw new Error("Background authority unavailable");
  const previousGlobal = loadChatBackgroundPath();
  const previousProject = JSON.stringify(loadProjectChatBackgroundSettings(project));
  const expected =
    input.designId === undefined
      ? undefined
      : loadSavedThemes().find((entry) => entry.id === input.designId);
  if (
    input.designId !== undefined &&
    (!expected ||
      expected.updatedAt !== input.expectedUpdatedAt ||
      !expected.imageId ||
      expected.creation?.kind === "motion")
  )
    throw new Error("Saved background changed; read it before revising");
  const path = await invoke<string>("save_chat_background_html", { content: input.html });
  if (!(await authorized())) throw new Error("Background authority changed");
  const known = backgroundDesign(path, loadSavedThemes());
  const look = captureAppearanceSnapshot();
  const override = input.target === "project" ? loadProjectChatBackgroundSettings(project) : null;
  if (override && look.image) look.image = { ...look.image, ...override };
  const saved =
    !saveOnly && !expected && known
      ? known
      : await saveDesign(
          {
            kind: "scene",
            name: saveOnly ? input.title : (expected?.name ?? known?.name ?? input.title),
            prompt: expected?.creation?.prompt ?? known?.creation?.prompt ?? "",
            path,
            look: expected?.look ?? known?.look ?? look,
            saved: expected ?? known,
          },
          !!(expected ?? known),
          authorized,
        );
  if (!(await authorized())) throw new Error("Background authority changed");
  if (saveOnly)
    return {
      saved: true,
      applied: false,
      target: input.target,
      path,
      title: saved.name,
      designId: saved.id,
      updatedAt: saved.updatedAt,
    };
  if (
    input.target === "global"
      ? loadChatBackgroundPath() !== previousGlobal
      : JSON.stringify(loadProjectChatBackgroundSettings(project)) !== previousProject
  )
    throw new Error(
      "Background selection changed while preparing the scene; review the current selection before retrying",
    );
  if (input.target === "global") {
    rememberBackground([path, loadChatBackgroundPath()]);
    if (saveChatBackgroundPath(path) === false)
      throw new Error("Could not save background selection");
    applyChatBackground(path);
  } else {
    const previous = loadProjectChatBackgroundSettings(project);
    rememberBackground([path, previous?.path ?? null], project);
    saveProjectChatBackgroundSettings(
      project,
      {
        path,
        emptyOpacity: previous?.emptyOpacity ?? loadChatBackgroundEmptyOpacity(),
        sessionOpacity: previous?.sessionOpacity ?? loadChatBackgroundSessionOpacity(),
        scope: previous?.scope ?? loadChatBackgroundScope(),
        effect: previous?.effect ?? "none",
      },
      true,
    );
  }
  return {
    applied: true,
    saved: true,
    target: input.target,
    path,
    title: saved.name,
    designId: saved.id,
    updatedAt: saved.updatedAt,
  };
}

/** Explicitly save reusable source and preferences, without selecting it or adding history. */
export const saveConversationBackground = (
  input: Record<string, unknown>,
  project: string,
  authorized: () => Promise<boolean>,
) => applyConversationBackground(input, project, authorized, true);
