import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";

export type TranscriptionModel = { id: string; label: string };

/** OpenRouter's transcription catalog is separate from its default model list. */
export async function openRouterTranscriptionModels(
  request: typeof fetch = fetch,
): Promise<TranscriptionModel[]> {
  let response: Response;
  try {
    response = await request(
      "https://openrouter.ai/api/v1/models?output_modalities=transcription",
      {
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new Error("OpenRouter transcription models could not be loaded.");
  }
  if (!response.ok)
    throw new Error(`OpenRouter transcription models are unavailable (${response.status}).`);
  const body = (await response.json().catch(() => undefined)) as { data?: unknown } | undefined;
  if (!Array.isArray(body?.data))
    throw new Error("OpenRouter returned an invalid transcription catalog.");
  const models: TranscriptionModel[] = [];
  for (const entry of body.data) {
    if (!entry || typeof entry !== "object") continue;
    const { id, name } = entry as { id?: unknown; name?: unknown };
    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)
    )
      continue;
    if (models.some((model) => model.id === id)) continue;
    models.push({ id, label: typeof name === "string" && name.length <= 200 ? name : id });
  }
  return models;
}

/** Capture-only cache: UI discovery still calls the uncached function above. */
export function cachedTranscriptionModels(
  load: () => Promise<TranscriptionModel[]>,
  now: () => number = monotonicNow,
): () => Promise<TranscriptionModel[]> {
  let cached: { models: TranscriptionModel[]; at: number } | undefined;
  let pending: Promise<TranscriptionModel[]> | undefined;
  return () => {
    if (cached && elapsedSince(cached.at, now()) < 60_000) return Promise.resolve(cached.models);
    if (pending) return pending;
    cached = undefined;
    pending = Promise.resolve()
      .then(load)
      .then((models) => {
        cached = { models, at: now() };
        return models;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}

export const captureTranscriptionModels = cachedTranscriptionModels(openRouterTranscriptionModels);
