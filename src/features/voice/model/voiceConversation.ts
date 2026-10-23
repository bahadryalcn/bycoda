import { buildVoicePrompt } from "./voicePrompt";
import { canRunHarnessTextPrompt, runHarnessTextPrompt } from "../../../integrations/harness";
import { nativeModelId } from "../../sessions/model/models";
import { sessionWorkCwd, type Session } from "../../sessions/model/session";
import {
  sessionProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { homeDir } from "../../../platform/tauri/fs";
import { t } from "../../../shared/i18n";
import { voiceContext } from "./voiceSession";

export type VoiceDecision = {
  action: "reply" | "submit" | "stop" | "silence";
  reply: string;
  text?: string;
};

export function immediateVoiceDecision(text: string, session: Session): VoiceDecision | undefined {
  const normalized = text.toLocaleLowerCase("tr").replace(/[.!?]/g, "").trim();
  if (/^(sus|sessiz|sustur|konuşmayı durdur|be quiet|silence)$/.test(normalized))
    return { action: "silence", reply: "" };
  if (/^(işi durdur|görevi durdur|çalışmayı durdur|stop (the )?(work|task|job))$/.test(normalized))
    return { action: "stop", reply: t("Stop requested.") };
  if (
    /^(ne durumdasın|durum ne|ne yapıyorsun|iş bitti mi|nereye geldin|durum|status|what is the status)$/.test(
      normalized,
    )
  ) {
    const context = voiceContext(session);
    const last = context.messages
      .filter((message) => message.role === "assistant")
      .slice(-1)[0]?.text;
    return {
      action: "reply",
      reply: `${context.busy ? t("Agent working") : t("No agent turn is running.")}${last ? ` ${last.slice(0, 450)}` : ""}`,
    };
  }
  return undefined;
}

export function parseVoiceDecision(output: string, transcript: string): VoiceDecision {
  const source = output
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const result = JSON.parse(source) as Record<string, unknown>;
    if (result.action === "submit") {
      // The recognizer's exact user words authorize work. Never execute model-invented instructions.
      return { action: "submit", text: transcript, reply: "" };
    }
    if (result.action === "reply" && typeof result.reply === "string" && result.reply.trim())
      return { action: "reply", reply: result.reply.slice(0, 1200) };
  } catch {
    /* Invalid output can never start work. */
  }
  throw new Error(
    "The voice reply could not be read. Please speak again or use the session composer.",
  );
}

/** Isolated, read-only companion request using the session's existing signed-in provider. */
export async function converseWithSession(
  session: Session,
  transcript: string,
  history: { role: string; text: string }[],
  signal: AbortSignal,
): Promise<VoiceDecision> {
  const immediate = immediateVoiceDecision(transcript, session);
  if (immediate) return immediate;
  if (!canRunHarnessTextPrompt(session.harness))
    throw new Error(
      "This session's provider does not support side conversations. Select a supported signed-in provider.",
    );
  const cwd = isRemoteProjectPath(session.cwd) ? await homeDir() : sessionWorkCwd(session);
  const result = await runHarnessTextPrompt({
    harness: session.harness,
    cwd,
    providerAccountId: supportsProviderAccounts(session.harness)
      ? sessionProviderAccountId(session.harness, session)
      : undefined,
    model: nativeModelId(session.model),
    modelSettings: session.modelSettings,
    ephemeral: true,
    timeoutMs: 30_000,
    signal,
    prompt: buildVoicePrompt(voiceContext(session), transcript, history),
  });
  signal.throwIfAborted();
  return parseVoiceDecision(result, transcript);
}
