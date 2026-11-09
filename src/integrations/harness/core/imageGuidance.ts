import {
  IMAGE_MODEL_INFO,
  IMAGE_MODELS_KEY,
  decodeImageModels,
} from "../../../shared/model/host-contracts/image-models";

/**
 * Tells the model which image models the owner picked for this session and what
 * each can produce. Automatic keeps one line so the tool stays discoverable.
 */
export function imageGuidance(settings: Readonly<Record<string, string>> | undefined): string {
  const selected = decodeImageModels(settings?.[IMAGE_MODELS_KEY]);
  if (selected === undefined)
    return "Images: when the work needs an image asset, images.status lists the available image models with their formats and limits, and images.generate saves one into the workspace.";
  if (!selected.length) return "";
  const models = selected
    .map((id) => `${IMAGE_MODEL_INFO[id].name} [${id}]: ${IMAGE_MODEL_INFO[id].summary}`)
    .join("; ");
  return `Image models the owner selected for this session (the Host enforces them): ${models}. When the work needs an image, choose the selected model that fits and pass its bracketed id as images.generate provider; use no other image model. Write SVG or other vector and animated assets as code.`;
}
