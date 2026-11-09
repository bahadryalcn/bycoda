import type { SocialClient } from "../../model/socialClient";
import type { AiPlan } from "../../model/socialActions";

export type AiPostDraft = { text: string; name?: string; link?: string };

/**
 * Asks the Host AI for one post. The Host returns a plan, not a send: the post's text is taken
 * from its `campaigns.create` step and loaded into the editor. Nothing is saved or scheduled here.
 */
export async function askAiForPost(
  client: Pick<SocialClient, "request">,
  input: { instruction: string; projectId: string },
): Promise<AiPostDraft | undefined> {
  const plan = await client.request<AiPlan>("ai.command", {
    text: input.instruction,
    projectId: input.projectId,
  });
  return draftFromAiPlan(plan);
}

/** Pure: the first `campaigns.create` variant of the plan, or undefined when the plan has none. */
export function draftFromAiPlan(plan: AiPlan): AiPostDraft | undefined {
  const step = plan.steps.find((item) => item.action === "campaigns.create");
  const input = step?.input as
    | { name?: unknown; variants?: { text?: unknown; link?: unknown }[] }
    | undefined;
  const variant = input?.variants?.[0];
  const text = typeof variant?.text === "string" ? variant.text.trim() : "";
  if (!text) return undefined;
  return {
    text,
    ...(typeof input?.name === "string" && input.name.trim() ? { name: input.name.trim() } : {}),
    ...(typeof variant?.link === "string" && variant.link.trim()
      ? { link: variant.link.trim() }
      : {}),
  };
}
