import { t } from "../../../shared/i18n";

/**
 * The voice engines report failures as English sentences (some are provider text). This maps the
 * engines' own sentences to their translations and passes any other text through unchanged.
 */
export function voiceEngineMessage(message: string): string {
  switch (message) {
    case "Microphone lost.":
      return t("Microphone lost.");
    case "Voice capture reached its limit. Finish this turn before continuing.":
      return t("Voice capture reached its limit. Finish this turn before continuing.");
    case "Voice connection is too slow. Start voice again.":
      return t("Voice connection is too slow. Start voice again.");
    case "Voice connection failed. Start voice again.":
      return t("Voice connection failed. Start voice again.");
    case "Voice connection permission denied.":
      return t("Voice connection permission denied.");
    case "Voice connection closed.":
      return t("Voice connection closed.");
    case "The voice request failed.":
      return t("The voice request failed.");
    case "Voice narration response identity was not confirmed.":
      return t("Voice narration response identity was not confirmed.");
    case "Semantic voice input identity could not be confirmed.":
      return t("Semantic voice input identity could not be confirmed.");
    case "Semantic voice input timed out.":
      return t("Semantic voice input timed out.");
    case "Semantic voice commit identity could not be confirmed.":
      return t("Semantic voice commit identity could not be confirmed.");
    case "Voice input cleanup was not confirmed. Start voice again.":
      return t("Voice input cleanup was not confirmed. Start voice again.");
    case "Semantic voice transcript identity could not be confirmed.":
      return t("Semantic voice transcript identity could not be confirmed.");
    case "Voice tool result delivery failed. Read its status before retrying.":
      return t("Voice tool result delivery failed. Read its status before retrying.");
    case "Voice response timed out. Start voice again.":
      return t("Voice response timed out. Start voice again.");
    case "Voice playback is suspended. Start voice again.":
      return t("Voice playback is suspended. Start voice again.");
    case "Invalid speech audio.":
      return t("Invalid speech audio.");
    case "Local voice disconnected. Start voice again.":
      return t("Local voice disconnected. Start voice again.");
    case "Speech recognition is busy. Please speak again.":
      return t("Speech recognition is busy. Please speak again.");
    case "Local speech recognition failed. Please speak again.":
      return t("Local speech recognition failed. Please speak again.");
    case "Local voice playback completion failed.":
      return t("Local voice playback completion failed.");
    case "Local voice playback failed.":
      return t("Local voice playback failed.");
    default:
      return message;
  }
}

/** The local model manager's own sentences, translated; undefined for anything else (raw Host text). */
export function knownLocalModelMessage(message: string): string | undefined {
  switch (message) {
    case "Invalid local transcription model.":
      return t("Invalid local transcription model.");
    case "Voice model directory is not a regular folder.":
      return t("Voice model directory is not a regular folder.");
    case "Voice model management is unavailable while the host is closing.":
      return t("Voice model management is unavailable while the host is closing.");
    case "Invalid model action.":
      return t("Invalid model action.");
    case "Disconnect voice before managing models.":
      return t("Disconnect voice before managing models.");
    case "Another model action is running.":
      return t("Another model action is running.");
    case "Model action cancelled.":
      return t("Model action cancelled.");
    case "Model action failed.":
      return t("Model action failed.");
    case "Download this model before testing it.":
      return t("Download this model before testing it.");
    case "Complete voice setup before managing models.":
      return t("Complete voice setup before managing models.");
    case "Model could not be loaded by the local recognizer.":
      return t("Model could not be loaded by the local recognizer.");
    case "Downloaded model is incomplete.":
      return t("Downloaded model is incomplete.");
    default:
      return undefined;
  }
}
