import { decodeCharacterRig, type CharacterRig } from "../characterRig";
import { LOTR_IDS, type LotrIdentity } from "./lotrCrew";

const rigs = new Map<LotrIdentity, CharacterRig>();
let loading: Promise<void> | undefined;
// Bundled imports work with the desktop's restricted connect-src policy as well as Vite.
const sources = import.meta.glob<string>("/public/crew/lotr/*.svg", {
  query: "?raw",
  import: "default",
});

/** Decode one character; a failed character does not poison the cache for later retries. */
export async function loadLotrRig(id: LotrIdentity): Promise<CharacterRig> {
  const cached = rigs.get(id);
  if (cached) return cached;
  const loadSource = sources[`/public/crew/lotr/${id}.svg`];
  if (!loadSource) throw new Error(`Cannot load ${id} artwork`);
  const rig = await decodeCharacterRig(id, await loadSource());
  rigs.set(id, rig);
  return rig;
}

export function loadLotrCrew(): Promise<void> {
  loading ??= Promise.all(LOTR_IDS.map(loadLotrRig))
    .then(() => undefined)
    .catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
  return loading;
}

export const lotrRig = (id: LotrIdentity) => rigs.get(id);
