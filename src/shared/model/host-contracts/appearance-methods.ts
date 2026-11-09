import type { z } from "zod";
import type { HostRpcMethodDefinition } from "./methods";
import {
  AppearanceBackgroundImageParamsSchema,
  AppearanceBackgroundImageResultSchema,
  AppearanceBackgroundSuggestionsParamsSchema,
  AppearanceBackgroundSuggestionsResultSchema,
  AppearanceThemeSuggestionsParamsSchema,
  AppearanceThemeSuggestionsResultSchema,
} from "./appearance";

/**
 * Appearance Host commands: one isolated model call each. Never retried, so a slow generation
 * cannot double-spend; the caller passes its control-method builder in.
 */
export function appearanceMethods(
  control: (paramsSchema: z.ZodType, resultSchema: z.ZodType) => HostRpcMethodDefinition,
) {
  return {
    "appearance.themeSuggestions": {
      ...control(AppearanceThemeSuggestionsParamsSchema, AppearanceThemeSuggestionsResultSchema),
      responseTimeoutMs: 100_000,
    },
    "appearance.backgroundSuggestions": {
      ...control(
        AppearanceBackgroundSuggestionsParamsSchema,
        AppearanceBackgroundSuggestionsResultSchema,
      ),
      responseTimeoutMs: 100_000,
    },
    // Native image generation is slower than a text prompt; the adapter itself stops at 180 s.
    "appearance.backgroundImage": {
      ...control(AppearanceBackgroundImageParamsSchema, AppearanceBackgroundImageResultSchema),
      responseTimeoutMs: 240_000,
    },
  };
}
