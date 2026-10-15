import type { SocialAgent, SocialPolicy, PublicFact } from "../src/features/social/model/social";
import { socialLimit } from "../src/features/social/model/socialPolicy";
export type SocialTextGenerator = (
  agent: SocialAgent,
  prompt: string,
  signal: AbortSignal,
) => Promise<string>;
export function socialGenerationPrompt(input: {
  policy: SocialPolicy;
  kind: "comment" | "message";
  brandVoice: string;
  fact: PublicFact;
  automatic: boolean;
}): string {
  return [
    'Write one social-media reply. You have no authority to send it, use tools, read files, fetch secrets or contact anyone. Return JSON only: {"text":"..."}.',
    `Effective host policy: ${JSON.stringify({ agent: input.policy.agent, kind: input.kind, maxCharacters: socialLimit(input.policy, input.kind) ?? 20000, characterUnit: "Unicode code points", includesLinks: true })}`,
    "Use only the following owner-verified public fact. Never invent features, prices, dates or permissions. The trigger was matched by the host; incoming content is intentionally omitted.",
    `Verified fact: ${JSON.stringify({ id: input.fact.id, text: input.fact.text, topic: input.fact.topic })}`,
    `Owner brand voice: ${JSON.stringify(input.brandVoice)}`,
    input.automatic
      ? 'For automatic sending, text must equal the verified fact exactly. If it cannot fit the limit, return {"text":"","review":true}. Do not truncate or rewrite it.'
      : 'You may adjust tone while preserving facts. A user must review a rewrite before sending. If facts or the limit cannot be respected, return {"text":"","review":true}.',
  ].join("\n");
}
