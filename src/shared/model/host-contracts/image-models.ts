/**
 * Image models the owner allows for a session. The value rides in
 * `Session.modelSettings` under a reserved key and never reaches a provider.
 * Unset means automatic (every available model); an empty list turns images off.
 */
export const IMAGE_MODELS_KEY = "imageModels";

export const IMAGE_MODEL_IDS = ["codex", "antigravity", "gemini", "comfyui", "openai-api"] as const;
export type ImageModelId = (typeof IMAGE_MODEL_IDS)[number];

/** Fixed capability facts shared by the picker, the runtime hint and the Host catalog. */
export const IMAGE_MODEL_INFO: Record<
  ImageModelId,
  { name: string; harness?: "codex" | "antigravity"; summary: string }
> = {
  codex: {
    name: "Codex ImageGen",
    harness: "codex",
    summary:
      "highest quality, use it for final or detailed assets; PNG images; Codex members also write SVG, animated GIF and sprite sheets as code",
  },
  antigravity: {
    name: "Nano Banana (Antigravity)",
    harness: "antigravity",
    summary:
      "simpler quality, use it for quick or simple images such as placeholders and plain icons; PNG images, transparent backgrounds on request; raster only, no SVG, GIF or animation",
  },
  gemini: { name: "Gemini image API", summary: "PNG images through the Host's Gemini API key" },
  comfyui: { name: "Local ComfyUI", summary: "PNG images from the owner's local workflow" },
  "openai-api": {
    name: "OpenAI Images API",
    summary: "PNG images through the Host's OpenAI API key (paid)",
  },
};

const isImageModelId = (value: unknown): value is ImageModelId =>
  typeof value === "string" && (IMAGE_MODEL_IDS as readonly string[]).includes(value);

/** Never throws. `undefined` is automatic; invalid entries are dropped. */
export function decodeImageModels(value: unknown): ImageModelId[] | undefined {
  if (typeof value !== "string" || !value || value.length > 1024) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  return IMAGE_MODEL_IDS.filter((id) =>
    parsed.some((entry) => entry === id && isImageModelId(entry)),
  );
}

/** `undefined` stores automatic by removing the key; a list (even empty) is explicit. */
export function encodeImageModels(ids: readonly string[] | undefined): string | undefined {
  if (ids === undefined) return undefined;
  return JSON.stringify(IMAGE_MODEL_IDS.filter((id) => ids.includes(id)));
}

/** Whether the session's selection permits this model. */
export function imageModelAllowed(settings: Record<string, string> | undefined, id: string) {
  const selected = decodeImageModels(settings?.[IMAGE_MODELS_KEY]);
  return selected === undefined || (selected as string[]).includes(id);
}
