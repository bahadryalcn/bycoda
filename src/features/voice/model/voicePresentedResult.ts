import { z } from "zod";

const credentialLike =
  /\b(?:authorization\s*[:=]|bearer\s+\S|(?:[\w-]*api[_-]?key|access[_-]?token|secret|password)\s*[:=]|(?:sk|ghp|xox[baprs]|umami)[-_][\w-]{10,})|[\w+/=_-]{40,}/i;
const displayText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !credentialLike.test(value));

const content = z.union([
  z.strictObject({ kind: z.literal("notes"), items: z.array(displayText(240)).min(1).max(6) }),
  z.strictObject({
    kind: z.literal("comparison"),
    items: z
      .array(z.strictObject({ label: displayText(52), value: displayText(100) }))
      .min(2)
      .max(6),
  }),
  z.strictObject({
    kind: z.literal("chart"),
    items: z
      .array(z.strictObject({ label: displayText(40), value: z.number().min(0).max(1e12) }))
      .min(2)
      .max(8),
  }),
]);

export const VoicePresentedResultSchema = z.strictObject({
  title: displayText(90),
  summary: displayText(360),
  content: content.optional(),
});

export type VoicePresentedResult = z.infer<typeof VoicePresentedResultSchema>;

export const presentVoiceResultTool = {
  name: "workspace.live_work.present",
  description:
    "Show a concise result beside the active voice call when the owner asks to see a result, comparison, or chart. This opens the fullscreen call and its right drawer. Use facts from this turn only. Do not include commands, logs, credentials, private identifiers, or invented values.",
  parameters: z.toJSONSchema(VoicePresentedResultSchema),
};
