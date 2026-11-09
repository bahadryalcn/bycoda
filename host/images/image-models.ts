import { homedir } from "node:os";
import { discoverAntigravityModels } from "../../src/integrations/harness/providers/antigravity/antigravityCatalog";
import type { SocialImageAdapters } from "../social/social-images";

/** How an agent reaches the model: the Host tool, or a member's own built-in tool. */
export type ImageModelAccess = "images.generate" | "antigravity-member";
export type ImageModel = {
  id: string;
  name: string;
  provider: "codex" | "antigravity" | "gemini" | "openai-api" | "comfyui";
  access: ImageModelAccess;
  available: boolean;
  reason: string;
  /** File formats the model itself returns. */
  outputs: string[];
  strengths: string[];
  limits: string[];
};

const RASTER_ONLY = "Raster only: no SVG, GIF or animation.";

/** Fixed facts per provider; availability always comes from a live check. */
const DESCRIPTORS = {
  codex: {
    name: "Codex ImageGen",
    strengths: [
      "Highest image quality: use it for final or detailed assets.",
      "Text-to-image illustrations, icons, sprites, backgrounds and UI art.",
      "Codex members also write SVG, animated GIF and sprite sheets as code with their own tools.",
    ],
    limits: [
      "images.generate returns one PNG; vector or animated assets come from a Codex member's code.",
    ],
  },
  antigravity: {
    name: "Nano Banana (Antigravity generate_image)",
    strengths: [
      "Simpler quality: use it for quick or simple images such as placeholders and plain icons.",
      "Text-to-image illustrations, logos and icons; transparent backgrounds on request.",
    ],
    limits: [
      RASTER_ONLY,
      "Only an Antigravity crew member or session can call its built-in generate_image tool and save the file.",
    ],
  },
  gemini: {
    name: "Gemini image API",
    strengths: ["Text-to-image through the Host's Gemini API key."],
    limits: [RASTER_ONLY],
  },
  "openai-api": {
    name: "OpenAI Images API",
    strengths: ["Text-to-image through the Host's OpenAI API key."],
    limits: [RASTER_ONLY, "Paid API: used only when chosen explicitly."],
  },
  comfyui: {
    name: "Local ComfyUI workflow",
    strengths: ["Runs the owner's saved local workflow without a cloud call."],
    limits: [RASTER_ONLY],
  },
} as const;

let antigravityCache: { at: number; value: Promise<string | undefined> } | undefined;
/** The first model the signed-in Antigravity CLI lists, used to run its generate_image tool. */
export function antigravityImageModel(now = Date.now()): Promise<string | undefined> {
  if (antigravityCache && now - antigravityCache.at < 10 * 60_000) return antigravityCache.value;
  const value = discoverAntigravityModels(homedir()).then(
    (models) => models[0]?.id,
    () => undefined,
  );
  antigravityCache = { at: now, value };
  return value;
}

/** The signed-in CLI lists its models; this is the evidence its generate_image tool can run.
 * shortcut: model discovery, not a test image; upgrade when agy exposes a tool capability read. */
export async function antigravityImagesAvailable(): Promise<boolean> {
  return (await antigravityImageModel()) !== undefined;
}

/** Lists every image model this Host can reach, with live availability. */
export async function listImageModels(
  adapters: SocialImageAdapters,
  antigravity: () => Promise<boolean> = () => antigravityImagesAvailable(),
): Promise<ImageModel[]> {
  const hosted = await Promise.all(
    (["codex", "gemini", "comfyui", "openai-api"] as const).map(async (provider) => {
      const adapter = adapters[provider];
      const capability = adapter
        ? await adapter.capability().catch(() => undefined)
        : { available: false, reason: "Not configured on this Host.", models: [] as string[] };
      const descriptor = DESCRIPTORS[provider];
      const models = capability?.models.length ? capability.models : [""];
      return models.map((model): ImageModel => ({
        id: model && provider !== "codex" ? `${provider}:${model}` : provider,
        name: model && provider !== "codex" ? `${descriptor.name} (${model})` : descriptor.name,
        provider,
        access: "images.generate",
        available: !!capability?.available,
        reason: capability?.reason ?? "Capability check failed.",
        outputs: ["png"],
        strengths: [...descriptor.strengths],
        limits: [...descriptor.limits],
      }));
    }),
  );
  const native = await antigravity().catch(() => false);
  return [
    ...hosted.flat(),
    {
      id: "antigravity",
      name: DESCRIPTORS.antigravity.name,
      provider: "antigravity",
      access: "antigravity-member",
      available: native,
      reason: native ? "" : "Antigravity CLI is not installed or not signed in on this Host.",
      outputs: ["png"],
      strengths: [...DESCRIPTORS.antigravity.strengths],
      limits: [...DESCRIPTORS.antigravity.limits],
    },
  ];
}
