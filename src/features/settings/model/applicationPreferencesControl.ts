import { applyThemePreference, loadThemePreference, saveThemePreference } from "./appearance";
import { loadAppearancePreferences, saveAppearancePreferences } from "./appearancePreferences";
import {
  getLanguagePreference,
  setLanguagePreference,
  LANGUAGE_STORAGE_KEY,
} from "../../../shared/i18n/core";
import { isLanguagePreference } from "../../../shared/i18n/languages";
import { loadVoiceSettings, saveVoiceSettings } from "../../voice/model/voiceSettings";

const voiceFields = [
  "visual",
  "compact",
  "manualTurnEnd",
  "turnEndSilence",
  "holdAnnouncements",
  "allowBargeIn",
  "idleSleepMinutes",
  "natural",
  "mode",
  "engine",
  "device",
] as const;
export function applicationPreferencesSnapshot() {
  const voice = loadVoiceSettings();
  return {
    theme: loadThemePreference(),
    density: loadAppearancePreferences().controlDensity,
    language: getLanguagePreference(),
    voice: Object.fromEntries(voiceFields.map((key) => [key, voice[key] ?? null])),
  };
}
/** Preferences only: never acquires a microphone, changes credentials or installs runtimes. */
export async function applyApplicationPreference(
  change: Record<string, unknown>,
  valid: () => boolean,
) {
  if (!valid()) throw new Error("Preference source is no longer available.");
  if (Object.keys(change).some((key) => !["kind", "value"].includes(key)))
    throw new Error("Unsupported application preference field.");
  if (change.kind === "theme") {
    if (change.value !== "light" && change.value !== "dark" && change.value !== "system")
      throw new Error("Invalid theme.");
    if (!saveThemePreference(change.value)) throw new Error("Theme was not durably saved.");
    applyThemePreference(change.value);
  } else if (change.kind === "density") {
    if (change.value !== "compact" && change.value !== "comfortable" && change.value !== "touch")
      throw new Error("Invalid density.");
    const before = loadAppearancePreferences();
    saveAppearancePreferences({ ...before, controlDensity: change.value }, before);
  } else if (change.kind === "language") {
    if (!isLanguagePreference(change.value)) throw new Error("Invalid language.");
    await setLanguagePreference(change.value, valid);
    if (localStorage.getItem(LANGUAGE_STORAGE_KEY) !== change.value)
      throw new Error("Language was not durably saved.");
  } else if (change.kind === "voice") {
    if (!change.value || typeof change.value !== "object" || Array.isArray(change.value))
      throw new Error("Invalid voice settings.");
    const patch = change.value as Record<string, unknown>;
    if (
      !Object.keys(patch).length ||
      Object.keys(patch).some((key) => !voiceFields.includes(key as (typeof voiceFields)[number]))
    )
      throw new Error(
        "Unsupported voice preference. Microphone access, enabling, paths and credentials require their own Settings controls.",
      );
    const options: Record<string, readonly unknown[]> = {
      visual: ["mark", "wave", "dots", "orb"],
      mode: ["local", "grok", "openai"],
      engine: ["supertonic", "voxcpm2", "elevenlabs"],
      device: ["auto", "cpu", "gpu"],
    };
    for (const [key, value] of Object.entries(patch)) {
      if (
        options[key]
          ? !options[key].includes(value)
          : key === "turnEndSilence"
            ? typeof value !== "number" || !Number.isFinite(value) || value < 0.5 || value > 5
            : key === "idleSleepMinutes"
              ? !Number.isInteger(value) || Number(value) < 0 || Number(value) > 120
              : typeof value !== "boolean"
      )
        throw new Error(`Invalid voice preference: ${key}.`);
    }
    const before = loadVoiceSettings();
    saveVoiceSettings({
      ...before,
      ...patch,
      ...(patch.manualTurnEnd !== undefined
        ? { manualTurnEndRevision: (before.manualTurnEndRevision ?? 0) + 1 }
        : {}),
    });
    const persisted = JSON.parse(localStorage.getItem("bycoda.voice") ?? "{}");
    if (Object.entries(patch).some(([key, value]) => persisted[key] !== value))
      throw new Error("Voice preferences were not durably saved.");
  } else throw new Error("Unsupported application preference.");
  if (!valid()) throw new Error("Preference source changed during save; inspect current settings.");
}
