import { z } from "zod";
import { SessionProviderSchema } from "./session-commands";

/** A text-only model chosen in Settings; the Host runs one isolated prompt with it. */
export const AppearanceThemeSuggestionsParamsSchema = z.strictObject({
  prompt: z.string().min(1).max(500),
  harness: SessionProviderSchema,
  model: z.string().min(1).max(200),
  modelSettings: z.record(z.string(), z.string()).optional(),
  /** bycoda provider account profile; absent means the provider's own default login. */
  providerAccountId: z.string().min(1).max(80).optional(),
});

const HexColorSchema = z.string().min(7).max(7);

export const AppearanceBackgroundSuggestionSchema = z.strictObject({
  name: z.string().max(40),
  stops: z.array(HexColorSchema).min(2).max(3),
  angle: z.number().min(0).max(360),
  type: z.enum(["linear", "radial", "solid"]),
});

/**
 * One group of optional settings (typography, interface, background, image, motion). The keys and
 * limits (including at most 24 keys per group) live in the settings model, which
 * `parseThemeSuggestions` applies on the Host and in the desktop; the wire schema only bounds the
 * shape because wire schemas cannot carry custom refinements.
 */
const AppearanceThemeFieldGroupSchema = z.record(
  z.string().max(40),
  z.union([z.string().max(100), z.number(), z.boolean()]),
);

/** Tint and accent always; every other Appearance field is optional and left alone when absent. */
export const AppearanceThemeSuggestionSchema = z.strictObject({
  name: z.string().min(1).max(40),
  hue: z.number().min(0).max(360),
  saturation: z.number().min(0).max(60),
  accent: HexColorSchema,
  scheme: z.enum(["light", "dark"]).optional(),
  darkLightness: z.number().min(0).max(30).optional(),
  canvas: z.enum(["pure", "tinted"]).optional(),
  gradient: AppearanceBackgroundSuggestionSchema.optional(),
  interfaceFont: z.string().min(1).max(60).optional(),
  codeFont: z.string().min(1).max(60).optional(),
  codeTheme: z.enum(["github", "dracula"]).optional(),
  density: z.enum(["compact", "comfortable", "touch"]).optional(),
  chatWidth: z.enum(["comfortable", "wide", "full"]).optional(),
  typography: AppearanceThemeFieldGroupSchema.optional(),
  interface: AppearanceThemeFieldGroupSchema.optional(),
  background: AppearanceThemeFieldGroupSchema.optional(),
  image: AppearanceThemeFieldGroupSchema.optional(),
  motion: AppearanceThemeFieldGroupSchema.optional(),
  imagePrompt: z.string().min(1).max(400).optional(),
});

export const AppearanceThemeSuggestionsResultSchema = z.strictObject({
  suggestions: z.array(AppearanceThemeSuggestionSchema).max(3),
});

/** A text-only model writes one gradient for the workspace background; the Host validates it too. */
export const AppearanceBackgroundSuggestionsParamsSchema = AppearanceThemeSuggestionsParamsSchema;

export const AppearanceBackgroundSuggestionsResultSchema = z.strictObject({
  gradient: AppearanceBackgroundSuggestionSchema,
});

/**
 * One background image drawn by the provider's native image generation (Codex ImageGen, or Gemini
 * when the Host has an image model configured). The Host returns a validated file it wrote; the
 * desktop copies it into its own background store.
 */
export const AppearanceBackgroundImageParamsSchema = z.strictObject({
  prompt: z.string().min(1).max(600),
  provider: z.enum(["codex", "gemini"]),
});

export const AppearanceBackgroundImageResultSchema = z.strictObject({
  path: z.string().min(1).max(4096),
});
