import {
  saveGeneratedImage,
  deleteGeneratedImages,
  type GeneratedImageAsset,
} from "../../../platform/tauri/fs";

type Storage = {
  save(input: { data: string; name: string }): Promise<GeneratedImageAsset>;
  delete(paths: string[]): Promise<void>;
};

let storage: Storage = {
  save: saveGeneratedImage,
  delete: deleteGeneratedImages,
};

export function configureGeneratedImageStorage(next: Storage): void {
  storage = next;
}

export const saveHarnessGeneratedImage = (input: { data: string; name: string }) =>
  storage.save(input);
export const deleteHarnessGeneratedImages = (paths: string[]) => storage.delete(paths);
