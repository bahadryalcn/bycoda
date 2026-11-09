import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../../../connections/public/connections";
import { isLocalSyncMachine } from "../../../../connections/public/localSync";
import type { RemoteMachine } from "../../../../connections";
import { truncateGraphemes } from "../../../../../shared/lib/text/truncate";
import { parseThemeSuggestions, type ThemeSuggestion } from "../../../model/themeSuggestions";

export type ThemeSuggestionParams = {
  prompt: string;
  harness: string;
  model: string;
  modelSettings?: Record<string, string>;
  providerAccountId?: string;
};

/** Asks the local Host for suggestions and validates them again before they reach the UI. */
export async function requestThemeSuggestions(
  params: ThemeSuggestionParams,
): Promise<ThemeSuggestion[]> {
  const machines = await invoke<RemoteMachine[]>("remote_machines");
  const machine = machines?.find(isLocalSyncMachine);
  if (!machine) throw new Error("Local host unavailable");
  const result = await remoteRequest<unknown>(machine.id, "appearance.themeSuggestions", params);
  return parseThemeSuggestions(result);
}

export const THEME_SUGGESTION_FAILURE_DETAIL_MAX = 160;

/**
 * The short reason shown under "Theme generation failed": the Host's or transport's message as one
 * trimmed line, or "" when the failure carried none. Errors are text, never rendered as markup.
 */
export function themeSuggestionFailureDetail(error: unknown): string {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  const line = message.replace(/\s+/g, " ").trim();
  return line ? truncateGraphemes(line, THEME_SUGGESTION_FAILURE_DETAIL_MAX) : "";
}

export type BackgroundImageProvider = "codex" | "gemini";

/** Asks the local Host to draw one background image; resolves to the file it wrote. */
export async function requestBackgroundImage(params: {
  prompt: string;
  provider: BackgroundImageProvider;
}): Promise<string> {
  const machines = await invoke<RemoteMachine[]>("remote_machines");
  const machine = machines?.find(isLocalSyncMachine);
  if (!machine) throw new Error("Local host unavailable");
  const result = await remoteRequest<{ path?: unknown }>(
    machine.id,
    "appearance.backgroundImage",
    params,
  );
  if (typeof result?.path !== "string" || !result.path)
    throw new Error("The image provider returned no image.");
  return result.path;
}
