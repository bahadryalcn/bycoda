import { requestAssistantAvatarData } from "./assistantBuilderClient";

/** Data URLs of generated portraits, loaded once per id for the life of the window. */
const loads = new Map<string, Promise<string>>();

/**
 * The data URL for one generated avatar id. A failed read is forgotten so a later render retries;
 * a success is kept, because the Host stores a generated portrait under its id for good.
 */
export function loadGeneratedAvatar(id: string): Promise<string> {
  const known = loads.get(id);
  if (known) return known;
  const load = requestAssistantAvatarData(id).catch((error: unknown) => {
    loads.delete(id);
    throw error;
  });
  loads.set(id, load);
  return load;
}

/** Test seam: forget every cached portrait. */
export function clearGeneratedAvatarCache() {
  loads.clear();
}
