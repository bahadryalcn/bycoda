import type { VoiceSettings } from "../../../src/features/voice/model/voiceSettings";
import { projectKey } from "../../../src/shared/lib/paths";

export const dictationDataOptions = [
  { value: "demo", label: "Demo data" },
  { value: "worst", label: "Worst case" },
  { value: "empty", label: "Empty" },
  { value: "one", label: "One" },
  { value: "huge", label: "500 terms" },
];

/** Synthetic persisted values enter through the same settings boundary as production. */
export function dictationSettingsData(kind: string): Partial<VoiceSettings> {
  const worst = [
    {
      term: "Krankenhausinformationssystem-Schnittstellenkompatibilität",
      aliases: ["hospital information system interface compatibility", "KIS-Schnittstelle"],
      projectId: projectKey(
        "G:/Projects/International clinical terminology and interoperability research",
      ),
    },
    { term: "Jo", aliases: [] },
    {
      term: "株式会社東京メディカルテクノロジー",
      aliases: ["Tokyo Medical Technology", "東京メディカル"],
    },
    {
      term: "HL7 FHIR ObservationDefinition.interpretation",
      aliases: [
        "fire observation definition interpretation",
        "FHIR observation definition interpretation",
      ],
    },
  ];
  const dictionary =
    kind === "empty"
      ? []
      : kind === "one"
        ? [worst[1]]
        : kind === "worst"
          ? worst
          : kind === "huge"
            ? Array.from({ length: 500 }, (_, index) => ({
                term: `ClinicalTerm_${index + 1}`,
                aliases: [`clinical term ${index + 1}`],
              }))
            : [
                { term: "Bycoda", aliases: ["by coda"] },
                { term: "FHIR", aliases: ["fire"] },
              ];
  return {
    dictationEnabled: true,
    dictationEngine: "openrouter",
    dictationModels: { openrouter: "openai/gpt-4o-mini-transcribe" },
    dictationDictionary: dictionary,
    dictationCleanup: {
      enabled: kind !== "empty",
      model: "",
      correctionCue: "scratch that",
      translateToEnglish: false,
      instructions:
        kind === "worst"
          ? "Preserve medicine names, dates, clinical abbreviations and multilingual names. Correct punctuation without changing meaning. Keep HL7 FHIR field names exactly as dictated."
          : "Fix punctuation and keep my wording.",
    },
  };
}
