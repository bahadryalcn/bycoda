import { invoke } from "@tauri-apps/api/core";

export type GeneratedImageAsset = { path: string; mimeType: string; size: number };

/** Provider artifacts belong to the process owner, independent of Explorer routing/UI. */
export function saveGeneratedImage(input: {
  data: string;
  name: string;
}): Promise<GeneratedImageAsset> {
  return invoke("save_generated_image", input);
}
export function deleteGeneratedImages(paths: string[]): Promise<void> {
  return invoke("delete_generated_images", { paths });
}
