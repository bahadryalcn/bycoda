import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createStore } from "../../../shared/lib/store";
import { loadSavedThemes, referencedImageIds } from "./savedThemes";

/** One stored background image. `generated` images were AI-drawn; `added` ones were picked or dropped. */
export type BackgroundLibraryImage = {
  id: string;
  path: string;
  createdMs: number;
  bytes: number;
  source: "generated" | "added";
  prompt: string | null;
};

/** What an applied image is recorded as in the library. */
export type BackgroundLibraryMeta = {
  source?: "generated" | "added";
  prompt?: string;
};

/** Webview URL of a library image, for thumbnails. */
export const libraryImageSrc = (image: BackgroundLibraryImage) => convertFileSrc(image.path);

const CURRENT_ID_KEY = "bycoda.chatBackgroundLibraryId.v1";
const changes = createStore();

export async function listBackgroundLibrary(): Promise<BackgroundLibraryImage[]> {
  const images = await invoke<BackgroundLibraryImage[] | undefined>("list_background_library");
  return Array.isArray(images) ? images : [];
}

/**
 * Keeps a copy of the image in the library (the same bytes always give the same id). Eviction never
 * removes an image that a saved theme uses.
 */
export async function addBackgroundLibraryImage(
  sourcePath: string,
  meta: BackgroundLibraryMeta = {},
): Promise<BackgroundLibraryImage> {
  const image = await invoke<BackgroundLibraryImage>("add_background_library_image", {
    sourcePath,
    source: meta.source ?? "added",
    prompt: meta.prompt ?? null,
    protectedIds: [...referencedImageIds(loadSavedThemes())],
  });
  changes.notify();
  return image;
}

export async function deleteBackgroundLibraryImage(id: string): Promise<void> {
  await invoke<void>("delete_background_library_image", { id });
  if (loadCurrentLibraryImageId() === id) saveCurrentLibraryImageId(null);
  changes.notify();
}

/** The library image the chat background was last applied from; `null` once it is cleared. */
export function loadCurrentLibraryImageId(): string | null {
  try {
    return localStorage.getItem(CURRENT_ID_KEY);
  } catch {
    return null;
  }
}

export function saveCurrentLibraryImageId(id: string | null): void {
  try {
    if (id) localStorage.setItem(CURRENT_ID_KEY, id);
    else localStorage.removeItem(CURRENT_ID_KEY);
  } catch {
    // The marker only highlights the current image; the background itself is stored elsewhere.
  }
  changes.notify();
}

export const subscribeBackgroundLibrary = changes.subscribe;

/**
 * The library id of the image behind the chat background. An image applied before the library
 * existed is added now (the same bytes dedupe), so a saved theme can refer to it.
 */
export async function ensureCurrentLibraryImage(
  chatBackgroundPath: string,
): Promise<BackgroundLibraryImage> {
  const id = loadCurrentLibraryImageId();
  if (id) {
    const known = (await listBackgroundLibrary()).find((image) => image.id === id);
    if (known) return known;
  }
  const image = await addBackgroundLibraryImage(chatBackgroundPath);
  saveCurrentLibraryImageId(image.id);
  return image;
}

/** Library images, newest first, refreshed whenever one is added, deleted or applied. */
export function useBackgroundLibrary(): {
  images: BackgroundLibraryImage[];
  currentId: string | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  retry: () => void;
} {
  const [state, setState] = useState<{
    images: BackgroundLibraryImage[];
    loaded: boolean;
    loading: boolean;
    error: string | null;
  }>({
    images: [],
    loaded: false,
    loading: true,
    error: null,
  });
  const request = useRef(0);
  const currentId = useSyncExternalStore(subscribeBackgroundLibrary, loadCurrentLibraryImageId);
  const refresh = useCallback(() => {
    const currentRequest = ++request.current;
    setState((current) => ({ ...current, loading: true }));
    listBackgroundLibrary().then(
      (images) => {
        if (request.current === currentRequest)
          setState({ images, loaded: true, loading: false, error: null });
      },
      (cause: unknown) => {
        if (request.current === currentRequest)
          setState((current) => ({
            ...current,
            loaded: true,
            loading: false,
            error: cause instanceof Error ? cause.message : String(cause),
          }));
      },
    );
  }, []);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Subscribe to native library changes while mounted; teardown fences pending reads.
  useEffect(() => {
    refresh();
    const unsubscribe = subscribeBackgroundLibrary(refresh);
    return () => {
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- This numeric request fence is not a DOM ref; teardown invalidates all reads.
      ++request.current;
      unsubscribe();
    };
  }, [refresh]);
  return { ...state, currentId, retry: refresh };
}
