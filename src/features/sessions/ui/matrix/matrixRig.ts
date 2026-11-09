import { decodeCharacterRig, type CharacterRig } from "../characterRig";
import { MATRIX_IDS, type MatrixIdentity } from "./matrixCrew";

const rigs = new Map<MatrixIdentity, CharacterRig>();
let loading: Promise<void> | undefined;
// Bundled imports work with the desktop's restricted connect-src policy as well as Vite.
const sources = import.meta.glob<string>("/public/crew/matrix/*.svg", {
  query: "?raw",
  import: "default",
});

/** Decode one character; a failed character does not poison the cache for later retries. */
export async function loadMatrixRig(id: MatrixIdentity): Promise<CharacterRig> {
  const cached = rigs.get(id);
  if (cached) return cached;
  const loadSource = sources[`/public/crew/matrix/${id}.svg`];
  if (!loadSource) throw new Error(`Cannot load ${id} artwork`);
  const rig = await decodeCharacterRig(id, await loadSource());
  rigs.set(id, rig);
  return rig;
}

export function loadMatrixCrew(): Promise<void> {
  loading ??= Promise.all(MATRIX_IDS.map(loadMatrixRig))
    .then(() => undefined)
    .catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
  return loading;
}

export const matrixRig = (id: MatrixIdentity) => rigs.get(id);
