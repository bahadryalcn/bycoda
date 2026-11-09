import type {
  ImageCapability,
  ImageProvider,
  ProgramConfig,
} from "../../src/features/social/model/socialProgram";

export type ImageRequest = {
  progress?: (percent: number) => void | Promise<void>;
  prompt: string;
  model?: string;
  aspectRatio: ProgramConfig["image"]["aspectRatio"];
  signal: AbortSignal;
  checkpoint: (providerJobId: string) => void | Promise<void>;
  providerJobId?: string;
  id: string;
};
export type ImageResult = { bytes: Uint8Array; model: string };
export type SocialImageAdapter = {
  capability: () => Promise<ImageCapability>;
  generate: (input: ImageRequest) => Promise<ImageResult>;
};
export type SocialImageAdapters = Partial<
  Record<Exclude<ImageProvider, "automatic">, SocialImageAdapter>
>;
export class ImageGenerationError extends Error {
  constructor(
    readonly kind: "unavailable" | "transient" | "refused" | "uncertain" | "invalid",
    message: string,
  ) {
    super(message);
  }
}
export function validateGeneratedImage(raw: Uint8Array): {
  width: number;
  height: number;
} {
  const bytes = Buffer.from(raw);
  let width = 0,
    height = 0;
  if (bytes.length < 24 || bytes.length > 5 * 1024 * 1024)
    throw new ImageGenerationError("invalid", "Generated image must be a PNG/JPEG up to 5 MiB.");
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.subarray(12, 16).toString() === "IHDR"
  ) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let at = 2; at + 8 < bytes.length;) {
      if (bytes[at] !== 0xff) {
        at++;
        continue;
      }
      const marker = bytes[at + 1];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      const length = bytes.readUInt16BE(at + 2);
      if (length < 2 || at + 2 + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        height = bytes.readUInt16BE(at + 5);
        width = bytes.readUInt16BE(at + 7);
        break;
      }
      at += 2 + length;
    }
  }
  if (!width || !height || width > 8192 || height > 8192 || width * height > 40000000)
    throw new ImageGenerationError(
      "invalid",
      "Generated image dimensions are invalid or exceed supported limits.",
    );
  return { width, height };
}
