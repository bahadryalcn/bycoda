import { applyThemePreference, loadThemePreference, saveThemePreference } from "./appearance";
import {
  FILE_REF_KINDS,
  FILE_REF_TONES,
  type FileRefTone,
} from "../../../shared/lib/fileReferenceKind";
import {
  FILE_REF_STYLES,
  FILE_TONE_FIELDS,
  type FileToneField,
  loadAppearancePreferences,
  saveAppearancePreferences,
  TRANSCRIPT_ACTIONS,
  TRANSCRIPT_CARDS,
  TRANSCRIPT_SURFACES,
} from "./appearancePreferences";
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
/**
 * Remote names of the transcript reading surface. Each maps to its stored field and its legal
 * values; `chatMessages.assistantMessageOpacity` is the older alias of `surfaceOpacity`.
 */
const transcriptFields = {
  surface: { field: "transcriptSurface", options: TRANSCRIPT_SURFACES },
  surfaceOpacity: { field: "transcriptSurfaceOpacity", min: 0, max: 100 },
  surfaceBlur: { field: "transcriptSurfaceBlur", min: 0, max: 24 },
  bodyInk: { field: "transcriptBodyInk", min: 80, max: 100 },
  chromeInk: { field: "transcriptChromeInk", min: 50, max: 100 },
  cards: { field: "transcriptCards", options: TRANSCRIPT_CARDS },
  actions: { field: "transcriptActions", options: TRANSCRIPT_ACTIONS },
  /** colored | plain: whether file references in replies are tinted by kind. */
  fileRefs: { field: "transcriptFileRefs", options: FILE_REF_STYLES },
  /** `fileToneCode`, `fileToneMarkup`, ...: the theme tone of each file kind's chip. */
  ...Object.fromEntries(
    FILE_REF_KINDS.map((kind) => [
      FILE_TONE_FIELDS[kind],
      { field: FILE_TONE_FIELDS[kind], options: FILE_REF_TONES },
    ]),
  ),
} as Record<
  string,
  { field: string; options: readonly unknown[] } | { field: string; min: number; max: number }
>;
export function applicationPreferencesSnapshot() {
  const voice = loadVoiceSettings();
  const {
    controlDensity,
    userMessageOpacity,
    transcriptSurface,
    transcriptSurfaceOpacity,
    transcriptSurfaceBlur,
    transcriptBodyInk,
    transcriptChromeInk,
    transcriptCards,
    transcriptActions,
    transcriptFileRefs,
    messageColor,
    ...preferences
  } = loadAppearancePreferences();
  return {
    theme: loadThemePreference(),
    density: controlDensity,
    chatMessages: {
      userMessageOpacity,
      assistantMessageOpacity: transcriptSurfaceOpacity,
      messageColor,
    },
    transcript: {
      surface: transcriptSurface,
      surfaceOpacity: transcriptSurfaceOpacity,
      surfaceBlur: transcriptSurfaceBlur,
      bodyInk: transcriptBodyInk,
      chromeInk: transcriptChromeInk,
      cards: transcriptCards,
      actions: transcriptActions,
      fileRefs: transcriptFileRefs,
      ...(Object.fromEntries(
        FILE_REF_KINDS.map((kind) => [FILE_TONE_FIELDS[kind], preferences[FILE_TONE_FIELDS[kind]]]),
      ) as Record<FileToneField, FileRefTone>),
    },
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
  } else if (change.kind === "chatMessages") {
    if (!change.value || typeof change.value !== "object" || Array.isArray(change.value))
      throw new Error("Invalid chat message appearance.");
    const edits = Object.entries(change.value);
    if (!edits.length) throw new Error("Supply at least one chat message appearance field.");
    for (const [key, value] of edits) {
      if (key === "messageColor" && (value === "theme" || value === "neutral")) continue;
      if (
        (key === "userMessageOpacity" || key === "assistantMessageOpacity") &&
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 100
      )
        continue;
      throw new Error("Invalid chat message appearance field or value.");
    }
    const before = loadAppearancePreferences();
    const fields = edits.map(([key, value]) => [
      key === "assistantMessageOpacity" ? "transcriptSurfaceOpacity" : key,
      value,
    ]);
    saveAppearancePreferences({ ...before, ...Object.fromEntries(fields) }, before);
  } else if (change.kind === "transcript") {
    if (!change.value || typeof change.value !== "object" || Array.isArray(change.value))
      throw new Error("Invalid transcript appearance.");
    const edits = Object.entries(change.value);
    if (!edits.length) throw new Error("Supply at least one transcript appearance field.");
    const fields: Record<string, unknown> = {};
    for (const [key, value] of edits) {
      if (!Object.prototype.hasOwnProperty.call(transcriptFields, key))
        throw new Error("Invalid transcript appearance field or value.");
      const rule = transcriptFields[key]!;
      const valid =
        "options" in rule
          ? (rule.options as readonly unknown[]).includes(value)
          : typeof value === "number" &&
            Number.isInteger(value) &&
            value >= rule.min &&
            value <= rule.max;
      if (!valid) throw new Error("Invalid transcript appearance field or value.");
      fields[rule.field] = value;
    }
    const before = loadAppearancePreferences();
    saveAppearancePreferences({ ...before, ...fields }, before);
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
