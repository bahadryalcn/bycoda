import type {
  AssistantMemory,
  AssistantRequest,
  AssistantResponse,
} from "../../../shared/model/host-contracts/assistant";
import { loadVoiceMemory } from "./voiceMemory";
import { loadVoiceSettings, saveVoiceSettings } from "./voiceSettings";
type Request = (input: AssistantRequest) => Promise<AssistantResponse>;
type Save = Extract<AssistantRequest, { op: "memory.save" }>;
export type VoiceOwnerRule = {
  readonly text: string;
  readonly quote: string;
  readonly forbiddenTerms: readonly string[];
  readonly manualTurnEnd: boolean;
};
const captured = new WeakSet<object>();
const KEY = "bycoda.voice.owner-rule-pending.v1";
const dontInterrupt = /(?:don['’]?t|do not|never) interrupt(?: me)?|sözümü kesme|lafımı kesme/iu;
/** Called only with an accepted current microphone transcript, never model/tool text. */
export function captureVoiceOwnerRule(utterance: string): VoiceOwnerRule | undefined {
  if (!utterance.trim() || utterance.length > 1000) return;
  if (
    /[?？]\s*$/.test(utterance) ||
    /(?:worker|tool|session|assistant|agent|log).{0,30}(?:said|says|wrote|output|contains|suggest|asked)|(?:ajan|araç|oturum|işçi).{0,25}(?:dedi|yazdı|çıktı|söylüyor)/iu.test(
      utterance,
    )
  )
    return;
  const manual = dontInterrupt.test(utterance);
  const lasting =
    /\b(?:from now on|always|never|don't do that again|do not do that again|remember (?:this|that) (?:rule|instruction))\b|bundan sonra|bir daha|bunu kural olarak|şunu kural olarak|her zaman|asla/iu.test(
      utterance,
    );
  if (!manual && !lasting) return;
  // Requests combining a persistent correction with unrelated work stay with the normal
  // conversation path; a generated paraphrase cannot become an explicit owner rule.
  if (
    /\b(?:then|also|and)\b.*\b(?:fix|build|implement|delete|publish)\b|(?:sonra|ayrıca|\bve\b).*(?:düzelt|geliştir|yayımla|dosya|proje)/iu.test(
      utterance,
    )
  )
    return;
  const forbidden: string[] = [];
  const deny =
    utterance
      .trim()
      .match(
        /^(?:bana\s+)?(?:asla|bir daha)\s+["“'‘]?([\p{L}\p{N}-]{1,80})["”'’]?\s+(?:deme|söyleme)[.!]?$/iu,
      ) ??
    utterance
      .trim()
      .match(
        /^(?:never|do not|don['’]?t)\s+(?:say|mention)\s+["“'‘]?([\p{L}\p{N}-]{1,80})["”'’]?(?:\s+to me)?(?:\s+again)?[.!]?$/iu,
      );
  if (deny && !/^(that|this|it|bunu|şunu|onu|bana|beni|benim)$/iu.test(deny[1]))
    forbidden.push(deny[1]);
  const intent = Object.freeze({
    text: utterance.trim(),
    quote: utterance,
    forbiddenTerms: Object.freeze(forbidden),
    manualTurnEnd: manual,
  });
  captured.add(intent);
  return intent;
}
type Pending = { intent: VoiceOwnerRule; request?: Save; manualRevision: number };
type SaveResult = { saved: boolean; id?: string; manualTurnEnd?: boolean; error?: string };
/** The original owner quote/payload survives uncertain Host saves and renderer reloads. */
export class VoiceOwnerRuleWrites {
  private pending: Pending[] = [];
  private saving?: Promise<{
    saved: boolean;
    id?: string;
    manualTurnEnd?: boolean;
    error?: string;
  }>;
  constructor(private request: Request) {
    try {
      const values: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (Array.isArray(values))
        for (const raw of values.slice(0, 10)) {
          if (!raw || typeof raw !== "object" || typeof raw.quote !== "string") continue;
          const intent = captureVoiceOwnerRule(raw.quote);
          if (!intent) continue;
          const value: Pending = {
            intent,
            manualRevision: Number.isSafeInteger(raw.manualRevision) ? raw.manualRevision : 0,
          };
          const prior = raw.request;
          if (
            prior?.op === "memory.save" &&
            prior.kind === "rule" &&
            prior.source === "spoken" &&
            prior.text === intent.text &&
            prior.quote === intent.quote &&
            prior.scope === "all" &&
            prior.active === true
          )
            value.request = {
              op: "memory.save",
              kind: "rule",
              source: "spoken",
              text: intent.text,
              quote: intent.quote,
              scope: "all",
              active: true,
              forbiddenTerms: [...intent.forbiddenTerms],
              ...(typeof prior.id === "string" && Number.isSafeInteger(prior.expectedVersion)
                ? { id: prior.id, expectedVersion: prior.expectedVersion }
                : {}),
            };
          this.pending.push(value);
        }
    } catch {
      /* Damaged local draft grants no owner authority. */
    }
  }
  get hasPending() {
    return this.pending.length > 0;
  }
  private persist() {
    localStorage.setItem(
      KEY,
      JSON.stringify(
        this.pending.map((value) => ({
          quote: value.intent.quote,
          request: value.request,
          manualRevision: value.manualRevision,
        })),
      ),
    );
  }
  capture(intent: VoiceOwnerRule): SaveResult | Promise<SaveResult> {
    if (!captured.has(intent)) throw new Error("Only accepted owner speech can create a rule.");
    if (!loadVoiceMemory().enabled)
      return { saved: false, error: "Memory is turned off in Settings." };
    if (!this.pending.some((value) => value.intent.quote === intent.quote)) {
      if (this.pending.length >= 10)
        return {
          saved: false,
          error: "Rule saves are pending. Retry them before adding another rule.",
        };
      this.pending.push({ intent, manualRevision: loadVoiceSettings().manualTurnEndRevision ?? 0 });
      this.persist();
    }
    return this.retry();
  }
  retry(): Promise<{ saved: boolean; id?: string; manualTurnEnd?: boolean; error?: string }> {
    if (this.saving) return this.saving;
    this.saving = (async () => {
      if (!loadVoiceMemory().enabled)
        return { saved: false, error: "Memory is turned off in Settings." };
      let result: { saved: boolean; id?: string; manualTurnEnd?: boolean; error?: string } = {
        saved: false,
      };
      while (this.pending.length) {
        const value = this.pending[0],
          intent = value.intent;
        const response = await this.request({
          op: "memory.search",
          query: intent.text.slice(0, 200),
          limit: 100,
        });
        const existing = response.entries?.find(
          (entry) => entry.kind === "rule" && entry.scope === "all" && entry.text === intent.text,
        );
        const matches = (memory: AssistantMemory | undefined) =>
          memory?.active === true &&
          memory.source === "spoken" &&
          memory.text === intent.text &&
          memory.quote === intent.quote &&
          JSON.stringify(memory.forbiddenTerms ?? []) === JSON.stringify(intent.forbiddenTerms);
        let memory = matches(existing) ? existing : undefined;
        if (!memory) {
          if (
            value.request?.id &&
            (!existing ||
              existing.id !== value.request.id ||
              existing.version !== value.request.expectedVersion)
          )
            throw new Error("The saved rule changed. Review it in Memory before retrying.");
          value.request ??= {
            op: "memory.save",
            kind: "rule",
            source: "spoken",
            text: intent.text,
            quote: intent.quote,
            scope: "all",
            active: true,
            forbiddenTerms: [...intent.forbiddenTerms],
            ...(existing ? { id: existing.id, expectedVersion: existing.version } : {}),
          };
          this.persist();
          memory = (await this.request(structuredClone(value.request))).memory;
        }
        if (!matches(memory))
          throw new Error("The rule save could not be verified. Review Memory and retry.");
        // Behavioral settings change only after an authoritative acknowledgement/readback.
        if (intent.manualTurnEnd && loadVoiceMemory().enabled) {
          const settings = loadVoiceSettings();
          saveVoiceSettings({
            ...settings,
            ...((settings.manualTurnEndRevision ?? 0) === value.manualRevision
              ? { manualTurnEnd: true }
              : {}),
            holdAnnouncements: true,
          });
        }
        this.pending.shift();
        this.persist();
        result = {
          saved: true,
          id: memory!.id,
          manualTurnEnd: loadVoiceSettings().manualTurnEnd === true,
        };
      }
      return result;
    })().finally(() => {
      this.saving = undefined;
    });
    return this.saving;
  }
}
