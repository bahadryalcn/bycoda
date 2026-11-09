import { t } from "../../../shared/i18n";
import type { VoiceRuntimeConfig, VoiceSetupStatus } from "../model/localVoiceClient";

export type Failure = { message: string; detail: string };
/** Compare the frozen request, including omitted defaults, without current preferences leaking in. */
export function setupConfigKey(config: VoiceRuntimeConfig) {
  return JSON.stringify([
    config.natural !== false,
    config.natural === false ? "" : (config.engine ?? "supertonic"),
    config.natural === false ? "" : (config.voiceId ?? ""),
    config.device ?? "auto",
    config.python?.trim() ?? "",
    config.whisperPath?.trim() ?? "",
    config.ttsPath?.trim() ?? "",
  ]);
}
export function checkFailure(cause: unknown): Failure {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return {
    message:
      detail === "Disconnect voice before installing."
        ? t("Disconnect voice before installing.")
        : /not connected|timed? out|timeout/i.test(detail)
          ? t("This computer is unavailable. Try again.")
          : /Update bycoda Host/.test(detail)
            ? t("Update bycoda to set up voice.")
            : t("Couldn't check voice setup. Try again."),
    detail,
  };
}
export function stageLabel(stage: VoiceSetupStatus["stage"]) {
  switch (stage) {
    case "packages":
      return t("Installing voice support…");
    case "gpu":
      return t("Installing GPU support…");
    case "models":
      return t("Downloading voice files…");
    case "checking":
      return t("Finishing voice setup…");
    default:
      return t("Preparing voice setup…");
  }
}
