import { buildVoicePrompt } from "./voicePrompt";
import {
  canRunHarnessTextPrompt,
  runHarnessTextPrompt,
  warmupHarnessText,
  type HarnessEvent,
} from "../../../integrations/harness";
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
import { voiceWorkText } from "./voiceWork";

export type VoiceDecision = {
  action: "reply" | "submit" | "stop" | "silence" | "remember" | "forget";
  reply: string;
  /** Work brief for submit, note text for remember. */
  text?: string;
  /** Memory note id for forget. */
  id?: string;
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

const REPLY_LIMIT = 1200;

/** Removes markup that a voice would read aloud literally. */
export function speakable(text: string): string {
  return text
    .replace(/[`*_#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words whose trailing period does not end a sentence (Turkish and English). */
const ABBREVIATION =
  /(?:^|[\s(])(?:vb|vs|örn|bkz|yak|sn|dr|prof|doç|av|mr|mrs|ms|st|etc|e\.g|i\.e|no|nr|[a-zçğıöşü])\.$/i;

function sentenceEnd(text: string, from: number): number {
  for (let index = from; index < text.length; index++) {
    const char = text[index];
    if (char === "\n") return index + 1;
    if (!".!?…".includes(char)) continue;
    let end = index + 1;
    while (end < text.length && `.!?…"'”’)`.includes(text[end])) end++;
    // Needs following whitespace: keeps "3.5", "v2.1" and file names together.
    if (end >= text.length || !/\s/.test(text[end])) {
      index = end - 1;
      continue;
    }
    const before = text.slice(0, index + 1);
    if (char === "." && (ABBREVIATION.test(before) || /(?:^|\s)\d+\.$/.test(before))) continue;
    return end;
  }
  return -1;
}

/** Splits streamed reply text into sentences that can be spoken as they complete. */
export class SentenceStream {
  private buffer = "";
  private scanned = 0;
  push(text: string): string[] {
    this.buffer += text;
    return this.take(false);
  }
  /** Returns whatever remains, including an unterminated last sentence. */
  end(): string[] {
    return this.take(true);
  }
  private take(final: boolean): string[] {
    const sentences: string[] = [];
    for (let cut = sentenceEnd(this.buffer, this.scanned); cut >= 0;) {
      const sentence = speakable(this.buffer.slice(0, cut));
      this.buffer = this.buffer.slice(cut);
      if (sentence) sentences.push(sentence);
      cut = sentenceEnd(this.buffer, 0);
    }
    // A trailing terminator may still be followed by more of the same token.
    this.scanned = Math.max(0, this.buffer.length - 2);
    if (final) {
      const rest = speakable(this.buffer);
      this.buffer = "";
      this.scanned = 0;
      if (rest) sentences.push(rest);
    }
    return sentences;
  }
}

export function parseVoiceDecision(output: string, transcript: string): VoiceDecision {
  const source = output
    .trim()
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  // Legacy providers may still return a bare marker. Never accept trailing work.
  if (/^SUBMIT[.!]?$/i.test(source))
    return { action: "submit", text: voiceWorkText(transcript), reply: "" };
  const spoken = /^REPLY:\s*/i.exec(source);
  if (spoken) {
    const reply = speakable(source.slice(spoken[0].length));
    if (reply) return { action: "reply", reply: reply.slice(0, REPLY_LIMIT) };
  }
  try {
    const result: unknown = JSON.parse(source);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    const value = result as Record<string, unknown>;
    if (
      value.action === "submit" &&
      Object.keys(value).every((key) => key === "action" || key === "text")
    )
      return {
        action: "submit",
        // Missing text is the legacy JSON marker; malformed text must fail closed.
        text: voiceWorkText(
          Object.prototype.hasOwnProperty.call(value, "text") ? value.text : transcript,
        ),
        reply: "",
      };
    const exact = (...keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
    const spokenReply = typeof value.reply === "string" ? speakable(value.reply) : "";
    if (
      value.action === "remember" &&
      typeof value.text === "string" &&
      exact("action", "text", "reply")
    )
      return { action: "remember", text: value.text, reply: spokenReply.slice(0, REPLY_LIMIT) };
    if (value.action === "forget" && typeof value.id === "string" && exact("action", "id", "reply"))
      return { action: "forget", id: value.id, reply: spokenReply.slice(0, REPLY_LIMIT) };
    if (value.action === "reply" && typeof value.reply === "string" && value.reply.trim())
      return { action: "reply", reply: value.reply.slice(0, REPLY_LIMIT) };
  } catch {
    /* Invalid output can never start work. */
  }
  throw new Error(
    "The voice reply could not be read. Please speak again or use the session composer.",
  );
}

/** Follows provider text deltas and hands over complete reply sentences. Only a
 * `REPLY:` answer streams; `SUBMIT` and anything unexpected wait for the result. */
export function replySentences(onSentence: (sentence: string) => void) {
  let head = "";
  let mode: "pending" | "reply" | "other" = "pending";
  let spoken = 0;
  const stream = new SentenceStream();
  const emit = (sentences: string[]) => {
    for (const sentence of sentences) {
      if (spoken >= REPLY_LIMIT) return;
      const part = sentence.slice(0, REPLY_LIMIT - spoken);
      spoken += part.length + 1;
      onSentence(part);
    }
  };
  return {
    push(delta: string) {
      if (mode === "reply") return emit(stream.push(delta));
      if (mode === "other") return;
      head += delta;
      const start = head.trimStart();
      const prefix = /^REPLY:\s*/i.exec(start);
      if (prefix) {
        mode = "reply";
        emit(stream.push(start.slice(prefix[0].length)));
      } else if (!"REPLY:".startsWith(start.slice(0, 6).toUpperCase())) mode = "other";
    },
    /** Flushes the last sentence; returns whether anything was spoken. */
    end() {
      if (mode === "reply") emit(stream.end());
      return spoken > 0;
    },
  };
}

/** Spoken replies favor latency: keep the session's model but drop extended
 * thinking and lower any reasoning effort it sets. */
export function voiceModelSettings(
  settings?: Record<string, string>,
): Record<string, string> | undefined {
  if (!settings) return undefined;
  const { thinking: _thinking, ...rest } = settings;
  return {
    ...rest,
    ...(rest.effort ? { effort: "low" } : {}),
    ...(rest.reasoningEffort ? { reasoningEffort: "low" } : {}),
  };
}

async function voiceRequest(session: Session) {
  return {
    harness: session.harness,
    cwd: isRemoteProjectPath(session.cwd) ? await homeDir() : sessionWorkCwd(session),
    providerAccountId: supportsProviderAccounts(session.harness)
      ? sessionProviderAccountId(session.harness, session)
      : undefined,
    model: nativeModelId(session.model),
    modelSettings: voiceModelSettings(session.modelSettings),
  };
}

/** Starts the side-reply process ahead of speech. A cold provider start costs
 * about ten seconds; each reply consumes the warm process, so call this again
 * after every reply. Failures only mean the next reply starts cold. */
export async function warmVoiceReply(session: Session): Promise<void> {
  if (!canRunHarnessTextPrompt(session.harness)) return;
  const { harness, cwd, ...options } = await voiceRequest(session);
  await warmupHarnessText(harness, cwd, options).catch(() => undefined);
}

/** Isolated, read-only companion request using the session's existing signed-in provider.
 * `onSentence` receives a spoken reply sentence by sentence while the provider writes it. */
export async function converseWithSession(
  session: Session,
  transcript: string,
  history: { role: string; text: string }[],
  signal: AbortSignal,
  onSentence?: (sentence: string) => void,
  persona = "",
): Promise<VoiceDecision> {
  const immediate = immediateVoiceDecision(transcript, session);
  if (immediate) return immediate;
  if (!canRunHarnessTextPrompt(session.harness))
    throw new Error(
      "This session's provider does not support side conversations. Select a supported signed-in provider.",
    );
  const sentences = onSentence
    ? replySentences((sentence) => {
        if (!signal.aborted) onSentence(sentence);
      })
    : undefined;
  const result = await runHarnessTextPrompt({
    ...(await voiceRequest(session)),
    ephemeral: true,
    timeoutMs: 30_000,
    signal,
    prompt: buildVoicePrompt(voiceContext(session), transcript, history, persona),
    ...(sentences
      ? {
          onEvent: (event: HarnessEvent) => {
            if (event.type === "message.delta" && !signal.aborted) sentences.push(event.text);
          },
        }
      : {}),
  });
  signal.throwIfAborted();
  const decision = parseVoiceDecision(result, transcript);
  if (decision.action === "reply") sentences?.end();
  return decision;
}
