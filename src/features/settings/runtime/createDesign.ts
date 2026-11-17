import { invoke } from "@tauri-apps/api/core";
import { t } from "../../../shared/i18n";
import { remoteRequest } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections";
import type { DesignDraft, DesignKind } from "../model/designs";
import { captureAppearanceSnapshot } from "../model/appearanceSnapshot";
import { authoredSceneSource, packOfflineScene } from "../model/designSource";
import {
  saveChatBackgroundFrom,
  validateChatBackgroundMedia,
} from "../../projects/public/chatBackground";
import type { ThemeSuggestion } from "../model/themeSuggestions";
import { AppearanceCreateDesignResultSchema } from "../../../shared/model/host-contracts/appearance";

async function localMachine() {
  const machine = (await invoke<RemoteMachine[]>("remote_machines"))?.find(isLocalSyncMachine);
  if (!machine) throw new Error(t("Local host unavailable"));
  return machine;
}

export async function cancelDesignCreation(requestId: string) {
  const machine = await localMachine();
  await remoteRequest(machine.id, "appearance.cancelDesign", { requestId });
}

export async function createDesign(params: {
  requestId: string;
  kind: DesignKind;
  prompt: string;
  harness: string;
  model: string;
  modelSettings?: Record<string, string>;
  providerAccountId?: string;
  previousSource?: string;
  imageProvider?: "codex" | "gemini";
}): Promise<DesignDraft> {
  const machine = await localMachine();
  const result = AppearanceCreateDesignResultSchema.parse(
    await remoteRequest(machine.id, "appearance.createDesign", params),
  );
  const current = captureAppearanceSnapshot();
  if (result.kind !== params.kind) throw new Error(t("The model returned a different design type"));
  if (params.kind === "motion") {
    const motion = (result.motion as ThemeSuggestion | undefined)?.motion;
    if (!motion || !Object.keys(motion).length)
      throw new Error(t("The model returned no motion preset"));
    return {
      kind: "motion",
      name: result.name,
      prompt: params.prompt,
      look: { motion: { ...current.motion!, ...motion } },
    };
  }
  const path = result.html
    ? await invoke<string>("save_chat_background_html", { content: result.html })
    : result.path
      ? await saveChatBackgroundFrom(result.path)
      : null;
  if (!path) throw new Error(t("The model returned no usable background"));
  await validateChatBackgroundMedia(path);
  return {
    kind: params.kind,
    name: result.name,
    prompt: params.prompt,
    path,
    look: {
      image: { ...current.image!, blur: 0, effect: "none" },
      live: { scene: "none", intensity: current.live?.intensity ?? 0.3 },
    },
    origin: "generated",
    ...(result.html ? { source: authoredSceneSource(result.html) } : {}),
  };
}

export async function previewEditedSource(
  draft: DesignDraft,
  source: string,
): Promise<DesignDraft> {
  const { THREE_RUNTIME } = await import("../data/backgrounds/three-runtime.generated");
  const content = source.length <= 120_000 ? packOfflineScene(source, THREE_RUNTIME) : source;
  if (!source.trim() || new TextEncoder().encode(content).byteLength > 2_097_152)
    throw new Error(t("Scene source is too large or empty"));
  const path = await invoke<string>("save_chat_background_html", { content });
  return { ...draft, path, source, kind: "scene" };
}

export async function loadLandscapeExample(): Promise<DesignDraft> {
  const { default: html } = await import("../data/backgrounds/mountain-lake.html?raw");
  const path = await invoke<string>("save_chat_background_html", { content: html });
  const current = captureAppearanceSnapshot();
  return {
    kind: "scene",
    name: t("Mountain lake at dusk"),
    prompt: t("A mountain lake, pine forests and reflected peaks at dusk."),
    path,
    source: authoredSceneSource(html),
    look: {
      image: { ...current.image!, blur: 0, effect: "none" },
      live: { scene: "none", intensity: 0.3 },
    },
  };
}
