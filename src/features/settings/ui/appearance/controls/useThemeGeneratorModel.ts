import { useEffect } from "react";
import { resolveHelperModel } from "../../../../model-routing/public/helpers";
import {
  defaultTextActionChoice,
  type TranslationChoice,
} from "../../../../sessions/public/translationPreferences";
import { readGeneratorValue, useGeneratorState } from "./themeGeneratorSession";

/** A retained one-off choice, seeded from the role once without replacing owner edits. */
export function useThemeGeneratorModel() {
  const [choice, setChoice] = useGeneratorState("choice", defaultTextActionChoice);
  const [initialized, setInitialized] = useGeneratorState("roleInitialized", false);
  // Synchronize the initial model with the Host role; closing Settings cancels only this seed.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- synchronizes the retained generator session with the Host role without replacing owner edits
  useEffect(() => {
    if (initialized) return;
    let active = true;
    void resolveHelperModel("text.themeGenerator")
      .then((target) => {
        if (!active || readGeneratorValue("roleInitialized", false)) return;
        if (target) setChoice(target);
        setInitialized(true);
      })
      .catch(() => {
        if (active) setInitialized(true);
      });
    return () => {
      active = false;
    };
  }, [initialized, setChoice, setInitialized]);
  return [
    choice,
    (next: TranslationChoice) => {
      setInitialized(true);
      setChoice(next);
    },
  ] as const;
}
