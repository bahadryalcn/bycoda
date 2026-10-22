import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { HARNESSES, type HarnessId } from "../../sessions/model/session";

const PRIMARY: HarnessId[] = [...HARNESSES];
const setting = createStoredSetting<HarnessId[]>({
  key: "bycoda.onboarding.providers.v1",
  fallback: PRIMARY,
  parse: (raw) => {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? [...new Set([...PRIMARY, ...HARNESSES.filter((id) => value.includes(id))])]
      : PRIMARY;
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
