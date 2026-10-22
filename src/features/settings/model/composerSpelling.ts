import { useSyncExternalStore } from "react";
import { storedFlag } from "../../../shared/lib/storedSetting";

const spelling = storedFlag("bycoda.composerSpelling", true, "bycoda:composer-spelling", true);
export const loadComposerSpelling = () => spelling.load() ?? true;
export const saveComposerSpelling = spelling.save;
export function useComposerSpelling() {
  return useSyncExternalStore(spelling.subscribe, loadComposerSpelling, () => true);
}
