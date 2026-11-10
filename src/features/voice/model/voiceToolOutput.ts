import { truncateGraphemes } from "../../../shared/lib/text/truncate";

const MAX_IMAGE_DATA = 6_000_000;
const SMALL_VALUE = 240;
const SMALL_TOTAL = 2_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
export const IMAGE_DELIVERED = "[image delivered to you as a separate image message]";
export const IMAGE_OMITTED = "[image omitted]";
export const IMAGE_UNSUPPORTED = "This voice provider cannot inspect images.";

type Port = ((dataUrl: string) => { accepted: boolean; error?: string }) | undefined;
type Rec = Record<string, unknown>;

const record = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isImage(value: unknown): value is Rec & { mimeType: string; data: string } {
  return (
    record(value) &&
    (value.mimeType === "image/png" || value.mimeType === "image/jpeg") &&
    typeof value.data === "string" &&
    value.data.length > 0 &&
    value.data.length <= MAX_IMAGE_DATA &&
    BASE64.test(value.data)
  );
}

/**
 * Hands the first screenshot or browser frame in a tool result to the image port and
 * removes every raw base64 payload from the result the model reads as text.
 */
export function deliverToolImages(result: unknown, image: Port): unknown {
  if (!record(result)) return result;
  const top = isImage(result);
  const nested = isImage(result.screenshot);
  if (!top && !nested) return result;
  const holder = top ? result : (result.screenshot as Rec & { mimeType: string; data: string });
  const sent = image?.(`data:${holder.mimeType};base64,${holder.data}`);
  const delivered = sent?.accepted === true;
  const marker = delivered ? IMAGE_DELIVERED : IMAGE_OMITTED;
  const out: Rec = {
    ...result,
    imageDelivered: delivered,
    ...(delivered ? {} : { imageError: sent?.error ?? IMAGE_UNSUPPORTED }),
  };
  if (top) out.data = marker;
  // Only one image per call is delivered; any other payload is dropped, never left as text.
  if (nested)
    out.screenshot = { ...(result.screenshot as Rec), data: top ? IMAGE_OMITTED : marker };
  return out;
}

/** Keeps oversized output valid JSON: small top-level facts stay, the rest is a preview. */
export function boundToolOutput(serialized: string, max: number, previewMax = 8_000): string {
  if (serialized.length <= max) return serialized;
  const next = "Request a filtered page or bounded detail. Omitted data is unknown.";
  let kept: Rec = {};
  let rest: unknown = serialized;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (record(parsed)) {
      let total = 0;
      const large: Rec = {};
      for (const [key, value] of Object.entries(parsed)) {
        const size = JSON.stringify(value)?.length ?? 0;
        if (
          size <= SMALL_VALUE &&
          total + size <= SMALL_TOTAL &&
          !["truncated", "originalLength", "preview", "next"].includes(key)
        ) {
          kept[key] = value;
          total += size;
        } else large[key] = value;
      }
      rest = large;
    }
  } catch {
    kept = {};
  }
  const preview = truncateGraphemes(
    typeof rest === "string" ? rest : JSON.stringify(rest),
    previewMax,
  );
  return JSON.stringify({
    ...kept,
    truncated: true,
    originalLength: serialized.length,
    preview,
    next,
  });
}
