import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { HARNESSES, type HarnessId } from "../../sessions/model/session";

const setting = createStoredSetting<HarnessId[]>({
  // v1 included every provider automatically; it cannot represent explicit choices.
  key: "bycoda.onboarding.providers.v2",
  fallback: [],
  parse: (raw) => {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? HARNESSES.filter((id) => value.includes(id)) : [];
  },
  serialize: JSON.stringify,
});

export const loadOnboardingProviders = setting.load;
/** Remember setup choices separately from provider authentication and model visibility. */
export function addOnboardingProviders(ids: readonly HarnessId[]): HarnessId[] {
  const next = [...new Set([...setting.load(), ...HARNESSES.filter((id) => ids.includes(id))])];
  setting.save(next);
  return next;
}
