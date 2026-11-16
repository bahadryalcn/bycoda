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
      (key) => !["target", "offset", "limit", "expectedPath"].includes(key),
    ) ||
    !["global", "project"].includes(String(input.target)) ||
    !Number.isSafeInteger(offset) ||
    Number(offset) < 0 ||
    Number(offset) > 512000 ||
    !Number.isSafeInteger(limit) ||
    Number(limit) < 1 ||
    Number(limit) > 32000 ||
    (input.expectedPath !== undefined &&
      (typeof input.expectedPath !== "string" || input.expectedPath.length > 4096))
  )
    throw new Error("Invalid background read request");
  if (!(await authorized())) throw new Error("Background authority unavailable");
  const selection = () => {
    const override =
      input.target === "project" ? loadProjectChatBackgroundSettings(projectKey(project)) : null;
    return {
      target: override ? "project" : "global",
      path: override?.path ?? loadChatBackgroundPath(),
      scope: override?.scope ?? loadChatBackgroundScope(),
    };
  };
  const current = selection();
  if (input.expectedPath !== undefined && input.expectedPath !== current.path)
    throw new Error("Background selection changed; restart the source read");
  if (!current.path) return { selected: false, ...current };
  const kind = chatBackgroundKind(current.path);
  if (kind !== "html") return { selected: true, ...current, kind };
  const html = await invoke<string>("read_chat_background_html", { path: current.path });
  if (!(await authorized()) || JSON.stringify(selection()) !== JSON.stringify(current))
    throw new Error("Background authority or selection changed");
  const end = Number(offset) + Number(limit);
  return {
    selected: true,
    ...current,
    kind,
    html: html.slice(Number(offset), end),
    offset,
    nextOffset: end < html.length ? end : null,
    totalCharacters: html.length,
  };
}

/** The caller owns authenticated session/lock checks; recheck before the durable mutation. */
export async function applyConversationBackground(
  input: Record<string, unknown>,
  project: string,
  authorized: () => Promise<boolean>,
) {
  project = projectKey(project);
  if (
    Object.keys(input).some((key) => !["html", "title", "target", "confirmed"].includes(key)) ||
    input.confirmed !== true ||
    !["global", "project"].includes(String(input.target)) ||
    typeof input.html !== "string" ||
    !input.html.trim() ||
    input.html.length > 512_000 ||
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.title.length > 160
  )
    throw new Error("Invalid background apply request");
  if (!(await authorized())) throw new Error("Background authority unavailable");
  const previousGlobal = loadChatBackgroundPath();
  const previousProject = JSON.stringify(loadProjectChatBackgroundSettings(project));
  const path = await invoke<string>("save_chat_background_html", { content: input.html });
  if (!(await authorized())) throw new Error("Background authority changed");
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
  return { applied: true, target: input.target, path, title: input.title };
}
