import { z } from "zod";
import { AssistantFoldersOps } from "./assistantFolders";

/** Read-only facts for the "Ready for 24/7" checklist that the Room snapshot does not carry.
 * Carried only by the owner-only `alwaysOn.get` operation; it is not part of the profile or snapshot. */
export const AssistantAlwaysOnSchema = z.strictObject({
  /** Phones registered for push on this Host. */
  pushPhones: z.number().int().min(0).max(1000),
  /** Of those, phones with Assistant updates turned on. */
  assistantPushPhones: z.number().int().min(0).max(1000),
});
export type AssistantAlwaysOn = z.infer<typeof AssistantAlwaysOnSchema>;

export const AssistantAlwaysOnGetSchema = z.strictObject({ op: z.literal("alwaysOn.get") });

/** Owner settings operations beyond the profile: chosen folders and the 24/7 readiness read. */
export const AssistantRoomSettingsOps = [
  ...AssistantFoldersOps,
  AssistantAlwaysOnGetSchema,
] as const;
