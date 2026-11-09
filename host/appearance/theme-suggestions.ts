import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mergeModelSettings,
  nativeModelId,
  resolveModel,
} from "../../src/features/sessions/model/models";
import type { HarnessId } from "../../src/features/sessions/model/session";
import {
  parseThemeSuggestions,
  type ThemeSuggestion,
} from "../../src/features/settings/model/themeSuggestions";
import {
  CODE_FONT_CATALOG,
  INTERFACE_FONT_CATALOG,
} from "../../src/features/settings/model/fontCatalog";
import { describeThemeFieldGroups } from "../../src/features/settings/model/themeSuggestionFields";
import { registerBuiltinHarnesses } from "../../src/integrations/harness/core/register";
import {
  canRunHarnessTextPrompt,
  runHarnessTextPrompt,
} from "../../src/integrations/harness/core/registry";
import type { AppearanceThemeSuggestionsParamsSchema } from "../../src/shared/model/host-contracts/appearance";
import type { z } from "zod";

type Params = z.infer<typeof AppearanceThemeSuggestionsParamsSchema>;
export type ThemeSuggestionRunner = (
  request: Parameters<typeof runHarnessTextPrompt>[0],
) => Promise<string>;

const TIMEOUT_MS = 90_000;

/** Prompt the model answers with JSON only; the user's words are quoted data, not instructions. */
export function themeSuggestionPrompt(request: string): string {
  const fonts = (catalog: readonly { id: string }[]) =>
    catalog.map((entry) => JSON.stringify(entry.id)).join(", ");
  return [
    "You design complete appearance themes for a developer desktop app.",
    "Reply with only a JSON array of exactly 3 objects. Required fields:",
    '"name": short name of at most 3 words, "hue": integer 0-360 (surface tint),',
    '"saturation": integer 0-60 (muted), "accent": "#rrggbb" (vivid, readable as a button fill).',
    "Optional fields. Design the whole look, not only colours: for each theme set every field that",
    "fits its mood (fonts, code theme, terminal, density, live scene, background effect, glass,",
    "crew and motion). Leave a field out only when nothing about the theme points either way.",
    "Keep text readable.",
    '"scheme": "light" | "dark"; "darkLightness": integer 0-30 (dark canvas lightness);',
    '"canvas": "pure" (true black/white) | "tinted";',
    '"gradient": {"name": string, "type": "linear" | "radial" | "solid", "angle": integer 0-360,',
    '"stops": 2 or 3 soft, low-contrast "#rrggbb" colours readable behind chat text};',
    `"interfaceFont": one of ${fonts(INTERFACE_FONT_CATALOG)};`,
    `"codeFont": one of ${fonts(CODE_FONT_CATALOG)};`,
    '"codeTheme": "github" | "dracula"; "density": "compact" | "comfortable" | "touch";',
    "Grouped objects, each holding only the keys it needs (percent values are plain integers):",
    ...describeThemeFieldGroups().map((line) => `${line};`),
    "What the values mean:",
    '- motion.crewTheme is the animated agent crew drawn above the workspace: "classic" a tea',
    '  crew in monochrome code art, "star-wars" Star Wars characters, "lotr" The Lord of the Rings',
    '  (Middle-earth, Gandalf, Frodo, Sauron, Mordor, elves, hobbits), "matrix" The Matrix (Neo,',
    "  Morpheus, Agent Smith, green code). When the request names or evokes one of these worlds,",
    '  set crewTheme to it and "showCrew": true; set "decorative": true so it can animate.',
    "- background.liveScene is an animated layer behind chat panes: threads = fine flowing lines;",
    "  silk = soft satin folds; dark-veil = quiet veil of light; soft-aurora = aurora light;",
    "  floating-lines = floating ribbons; neural-tree = glowing neural branches; latent-face =",
    "  silhouette of falling code; code-visage = dark figure before falling code; serene-face =",
    "  calm softly lit face; thought-weaver = digital loom weaving threads; ascii-mask = mask in an",
    "  ASCII gradient; dot-grid = rippling dot grid; code-rain = falling characters (Matrix-like).",
    "  Pick the scene that best matches the mood; liveIntensity 20-50 keeps it subtle.",
    "- background.newThreadEffect stylises the background image in new threads: dither (retro",
    "  pixel dither), ascii (rendered as ASCII art), halftone (print dots), scanlines (CRT lines),",
    "  gradient-blur (soft blur fade), none (original picture).",
    "- background glass: bodyGlass/windowGlass make panes translucent over the background.",
    '- "image" tunes the background image: "scope" "empty" shows it only in new threads; keep',
    '  "sessionOpacity" low and add "blur" when the picture is busy.',
    `"imagePrompt": always include: one sentence describing a wallpaper scene in the theme's`,
    "mood and colours (it may be dramatic or iconic), without text or logos.",
    `Theme request, quoted as plain description: ${JSON.stringify(request)}`,
  ].join("\n");
}

/** Finds the first JSON object or array in a model reply, tolerating code fences and prose. */
export function extractThemeJson(output: string): unknown {
  const start = output.search(/[[{]/);
  const end = Math.max(output.lastIndexOf("]"), output.lastIndexOf("}"));
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(output.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

async function defaultRunner(request: Parameters<typeof runHarnessTextPrompt>[0]) {
  return runHarnessTextPrompt(request);
}

/** One isolated text prompt on the chosen model; every entry is validated before it returns. */
export async function generateThemeSuggestions(
  params: Params,
  run: ThemeSuggestionRunner = defaultRunner,
): Promise<{ suggestions: ThemeSuggestion[] }> {
  const harness = params.harness as HarnessId;
  // The Host registers no adapter at startup, so the capability check must come after registration.
  registerBuiltinHarnesses();
  if (!canRunHarnessTextPrompt(harness))
    throw new Error("Selected model does not support text actions. Choose a supported model.");
  const model = resolveModel(harness, params.model);
  const cwd = join(tmpdir(), "bycoda-theme-suggestions");
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  const request = {
    harness,
    model: nativeModelId(model),
    modelSettings: mergeModelSettings(model, params.modelSettings),
    providerAccountId: params.providerAccountId,
    cwd,
    prompt: themeSuggestionPrompt(params.prompt),
    intent: "plan" as const,
    ephemeral: true,
    timeoutMs: TIMEOUT_MS,
  };
  // Models occasionally answer with prose or a cut-off array; one more attempt usually lands.
  let last = "";
  for (let attempt = 0; attempt < THEME_ATTEMPTS; attempt++) {
    last = await run(request);
    const suggestions = parseThemeSuggestions(extractThemeJson(last));
    if (suggestions.length > 0) return { suggestions };
  }
  throw new Error(describeUnusableReply(last));
}

const THEME_ATTEMPTS = 2;

/** Why a reply yielded no theme, with a short quote so the owner can see what the model did. */
export function describeUnusableReply(output: string): string {
  const quote = output.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!quote) return "The model returned an empty reply. Try again.";
  if (extractThemeJson(output) === null)
    return `The model did not reply with JSON themes. Try again. Reply started: "${quote}"`;
  return `The model's themes were missing required fields. Try again. Reply started: "${quote}"`;
}
