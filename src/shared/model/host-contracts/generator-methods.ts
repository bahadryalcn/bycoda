import type { z } from "zod";
import type { HostRpcMethodDefinition } from "./methods";
import { appearanceMethods } from "./appearance-methods";
import {
  AssistantAvatarGenerateParamsSchema,
  AssistantAvatarGenerateResultSchema,
  AssistantAvatarReadParamsSchema,
  AssistantAvatarReadResultSchema,
  AssistantProfileInterviewParamsSchema,
  AssistantProfileInterviewResultSchema,
} from "./assistant-builder";

/**
 * Host commands that run one isolated model or image generation call: Appearance themes and the
 * assistant profile builder. Never retried, so a slow generation cannot double-spend.
 */
export function generatorMethods(
  control: (paramsSchema: z.ZodType, resultSchema: z.ZodType) => HostRpcMethodDefinition,
) {
  return {
    ...appearanceMethods(control),
    "assistant.builder.interview": {
      ...control(AssistantProfileInterviewParamsSchema, AssistantProfileInterviewResultSchema),
      responseTimeoutMs: 100_000,
    },
    // Native image generation is slower than a text prompt; the adapter itself stops at 180 s.
    "assistant.builder.avatarGenerate": {
      ...control(AssistantAvatarGenerateParamsSchema, AssistantAvatarGenerateResultSchema),
      responseTimeoutMs: 240_000,
    },
    "assistant.builder.avatarRead": {
      ...control(AssistantAvatarReadParamsSchema, AssistantAvatarReadResultSchema),
      responseTimeoutMs: 30_000,
    },
  };
}
