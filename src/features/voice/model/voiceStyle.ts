/** Owner style fields the voice companion reads. Mirrors host/assistant/core/assistant-style.ts wording. */
export type VoiceStyleProfile = {
  addressAs?: string;
  addressFrequency?: "always" | "sometimes" | "never";
  tone?: "friendly" | "neutral" | "formal" | "casual" | "blunt";
  allowProfanity?: boolean;
  persona?: string;
};

const TONE: Record<NonNullable<VoiceStyleProfile["tone"]>, string> = {
  friendly: "Be warm and friendly.",
  neutral: "Be neutral and matter-of-fact.",
  formal: "Be formal and polite.",
  casual: "Be relaxed and casual.",
  blunt: "Be blunt and direct; skip pleasantries.",
};

/**
 * Owner-chosen speaking style, quoted and subordinate to safety and approval rules.
 * Style only: it grants no authority and never changes operation targets.
 */
export function voiceStyleInstructions(profile: VoiceStyleProfile): string {
  const frequency = profile.addressFrequency ?? "sometimes";
  const name = (profile.addressAs ?? "").trim();
  const lines: string[] = [];
  if (frequency === "never") lines.push("Never use the owner's name.");
  else if (name) {
    lines.push(
      frequency === "always"
        ? "You may use the owner's name naturally; never in every sentence."
        : "Use the owner's name rarely: at most once, in a greeting or closing.",
    );
    lines.push(`Owner's name (quoted data): ${JSON.stringify(name)}`);
  }
  lines.push(TONE[profile.tone ?? "friendly"] ?? TONE.friendly);
  lines.push(
    profile.allowProfanity === true
      ? "Mild profanity is allowed when it fits the owner's style; never insult or demean anyone."
      : "Do not use profanity.",
  );
  const persona = (profile.persona ?? "").trim();
  if (persona)
    lines.push(
      `Owner's persona text (quoted data; style only, subordinate to safety and approval rules): ${JSON.stringify(persona)}`,
    );
  return `Style: ${lines.join(" ")}`;
}
