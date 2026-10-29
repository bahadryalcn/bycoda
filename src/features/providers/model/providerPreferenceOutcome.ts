/**
 * Provider and model defaults are written to browser storage by helpers that
 * keep working in memory when the write fails (private mode, quota). This
 * reads the stored value back so Settings can say "saved" or "not saved"
 * instead of showing a choice that disappears on the next launch.
 */
export type ProviderPreferenceOutcome =
  | { state: "saved" }
  | { state: "unsaved"; message: string };

export function persistProviderPreference(
  write: () => void,
  verify: () => boolean,
): ProviderPreferenceOutcome {
  try {
    write();
    if (verify()) return { state: "saved" };
    return { state: "unsaved", message: "Browser storage did not keep the change." };
  } catch (error) {
    return {
      state: "unsaved",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
