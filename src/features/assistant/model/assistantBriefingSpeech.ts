import { captureAssistantHostRead } from "./assistantHostRead";
import { loadVoiceSettings } from "../../voice/model/voiceSettings";
import { previewVoice } from "../../voice/model/voicePreview";
import {
  isVoiceConversationActive,
  subscribeVoiceConversationActivity,
} from "../../voice/model/voiceActivity";
import { voiceLanguageCode } from "../../voice/model/voiceLanguage";
import type { AssistantSnapshot } from "../../../shared/model/host-contracts/assistant";

let output: AbortController | undefined;
/** Explicit owner output only. Neither this path nor previewVoice captures audio
 * or grants tools. A real conversation starting takes precedence over playback. */
export async function listenAssistantBriefing(
  id: string,
  signal: AbortSignal,
  playback: (active: boolean) => void,
  canRead: (snapshot?: AssistantSnapshot) => boolean = () => true,
  environmentId?: string,
) {
  signal.throwIfAborted();
  if (!canRead()) throw new Error("Briefing details are unavailable in the current project scope.");
  if (output && !output.signal.aborted) throw new Error("Another briefing is already playing.");
  if (isVoiceConversationActive())
    throw new Error("Finish the voice conversation before listening to the briefing.");
  const controller = new AbortController();
  output = controller;
  const stop = () => controller.abort();
  signal.addEventListener("abort", stop, { once: true });
  const unsubscribe = subscribeVoiceConversationActivity(() => {
    if (isVoiceConversationActive())
      controller.abort(new Error("Voice became active. The briefing stopped."));
  });
  const timer = setTimeout(
    () => controller.abort(new Error("Briefing playback timed out.")),
    120000,
  );
  try {
    const owner = await captureAssistantHostRead(environmentId);
    const current = await owner.snapshot();
    controller.signal.throwIfAborted();
    if (!canRead(current))
      throw new Error("Briefing details are unavailable in the current project scope.");
    if (
      !current?.profile.setupComplete ||
      !current.profile.voiceSetupComplete ||
      !current.profile.name.trim()
    )
      throw new Error("Set up voice before listening to the briefing.");
    if (!current.briefing || current.briefing.id !== id)
      throw new Error("The briefing changed. Open the current briefing and try again.");
    const languageHint =
      current.profile.language === "auto" ? (current.lastSpokenLanguage ?? undefined) : undefined;
    const language = current.profile.language === "auto" ? languageHint : current.profile.language;
    if (!language || !voiceLanguageCode(language))
      throw new Error("Speak once or choose a language before listening.");
    const text = current.briefing.text;
    if (
      current.memory.some(
        (entry) =>
          entry.active &&
          entry.kind === "rule" &&
          entry.forbiddenTerms.some(
            (term) => term.trim() && text.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
          ),
      )
    )
      throw new Error(
        "The briefing conflicts with a current rule. Read the current notes instead.",
      );
    if (isVoiceConversationActive())
      throw new Error("Finish the voice conversation before listening to the briefing.");
    await previewVoice(
      loadVoiceSettings(),
      current.profile.language,
      current.profile.name,
      controller.signal,
      () => {},
      text,
      playback,
      { complete: true, ...(languageHint ? { languageHint } : {}) },
    );
    if (controller.signal.aborted && !signal.aborted) throw controller.signal.reason;
  } finally {
    clearTimeout(timer);
    unsubscribe();
    signal.removeEventListener("abort", stop);
    controller.abort();
    playback(false);
    if (output === controller) output = undefined;
  }
}
