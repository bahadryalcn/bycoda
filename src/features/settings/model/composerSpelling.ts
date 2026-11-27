import { useSyncExternalStore } from "react";
import { storedFlag } from "../../../shared/lib/storedSetting";

export const COMPOSER_SPELLING_DEFAULT = true;
const spelling = storedFlag(
  "bycoda.composerSpelling",
  COMPOSER_SPELLING_DEFAULT,
  "bycoda:composer-spelling",
  true,
);
export const loadComposerSpelling = () => spelling.load() ?? COMPOSER_SPELLING_DEFAULT;
export const saveComposerSpelling = spelling.save;
export function useComposerSpelling() {
  return useSyncExternalStore(
    spelling.subscribe,
    loadComposerSpelling,
    () => COMPOSER_SPELLING_DEFAULT,
  );
}
