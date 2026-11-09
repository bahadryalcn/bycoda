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
  sanitizeBackgroundGradient,
  type BackgroundGradientSuggestion,
} from "../../src/features/settings/model/backgroundGradient";
import { registerBuiltinHarnesses } from "../../src/integrations/harness/core/register";
import {
  canRunHarnessTextPrompt,
  runHarnessTextPrompt,
} from "../../src/integrations/harness/core/registry";
import type { AppearanceBackgroundSuggestionsParamsSchema } from "../../src/shared/model/host-contracts/appearance";
import type { z } from "zod";

type Params = z.infer<typeof AppearanceBackgroundSuggestionsParamsSchema>;
export type BackgroundSuggestionRunner = (
  request: Parameters<typeof runHarnessTextPrompt>[0],
) => Promise<string>;

const TIMEOUT_MS = 90_000;

/** Prompt the model answers with one JSON object; the user's words are quoted data, not instructions. */
export function backgroundSuggestionPrompt(request: string): string {
  return [
    "You design one background gradient for a developer desktop app.",
    'Reply with only a JSON object: {"name": short name of at most 3 words, "type": "linear" | "radial" | "solid",',
    '"angle": integer 0-360, "stops": 2 or 3 colours as "#rrggbb" (soft and low-contrast, readable behind chat text)}.',
    `Gradient request, quoted as plain description: ${JSON.stringify(request)}`,
  ].join("\n");
}

/** Finds the first JSON object in a model reply, tolerating code fences and prose. */
export function extractBackgroundJson(output: string): unknown {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
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

/** One isolated text prompt on the chosen model; the gradient is validated before it returns. */
export async function generateBackgroundSuggestion(
  params: Params,
  run: BackgroundSuggestionRunner = defaultRunner,
): Promise<{ gradient: BackgroundGradientSuggestion }> {
  const harness = params.harness as HarnessId;
  // Register before the capability check: a fresh Host process knows no adapter yet.
  registerBuiltinHarnesses();
  if (!canRunHarnessTextPrompt(harness))
    throw new Error("Selected model does not support text actions. Choose a supported model.");
  const model = resolveModel(harness, params.model);
  const cwd = join(tmpdir(), "bycoda-background-suggestions");
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  const output = await run({
    harness,
    model: nativeModelId(model),
    modelSettings: mergeModelSettings(model, params.modelSettings),
    providerAccountId: params.providerAccountId,
    cwd,
    prompt: backgroundSuggestionPrompt(params.prompt),
    intent: "plan",
    ephemeral: true,
    timeoutMs: TIMEOUT_MS,
  });
  const gradient = sanitizeBackgroundGradient(extractBackgroundJson(output));
  if (!gradient) throw new Error("Could not generate a gradient. Try again.");
  return { gradient };
}
