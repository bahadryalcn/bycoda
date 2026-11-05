import { describe, expect, it } from "vitest";
import {
  shouldSilentlyAcknowledgeVoice,
  shouldWaitForVoice,
} from "../src/features/voice/model/voiceSpeechPolicy";
import { voiceSearchClauses } from "../src/features/voice/model/voiceFeatureLexicon";
import {
  mayDeliverVoiceBriefing,
  type VoiceBriefingDelivery,
} from "../src/features/voice/model/voiceBriefing";
import type { AssistantProfile } from "../src/shared/model/host-contracts/assistant";
import en from "../src/shared/i18n/locales/en.json";
import tr from "../src/shared/i18n/locales/tr.json";
import de from "../src/shared/i18n/locales/de.json";
import es from "../src/shared/i18n/locales/es.json";
import fr from "../src/shared/i18n/locales/fr.json";
import ja from "../src/shared/i18n/locales/ja.json";
import pt from "../src/shared/i18n/locales/pt.json";
import zh from "../src/shared/i18n/locales/zh-CN.json";

// Sanitized, hand-authored decision cases; no provider or tool is invoked.
describe("voice decision regression corpus", () => {
  const delivered = "İşlem tamamlandı.";
  it.each([
    ["tamam", true],
    ["Anladım!", true],
    ["Teşekkür ederim", true],
    ["sağ olun", true],
    ["hı hı", true],
    ["evet anladım", true],
    ["okay", true],
    ["got it", true],
    ["thanks", true],
    ["merci", true],
    ["tamam ekipleri aç", false],
    ["hayır, ekipleri", false],
    ["evet, oluştur", false],
    ["tamam ama görevleri göster", false],
    ["dur", false],
    ["hayır", false],
    ["bir saniye, görevleri aç", false],
    ["anladım, devam et", false],
    ["teşekkürler, notları oku", false],
    ["", false],
  ])("delivered response: %s has silent acknowledgement %s", (transcript, expected) => {
    expect(shouldSilentlyAcknowledgeVoice({ transcript, lastDeliveredAssistant: delivered })).toBe(
      expected,
    );
  });
  it.each([
    [{ pendingQuestion: true }, "tamam"],
    [{ pendingChoice: true }, "tamam"],
    [{ pendingQuestion: true }, "evet anladım"],
    [{ pendingChoice: true }, "okay"],
    [{ lastDeliveredAssistant: null }, "tamam"],
    [{ lastDeliveredAssistant: " " }, "thanks"],
  ])("keeps a pending choice or missing delivery routable: %s / %s", (state, transcript) => {
    expect(
      shouldSilentlyAcknowledgeVoice({ lastDeliveredAssistant: delivered, ...state, transcript }),
    ).toBe(false);
  });
  it.each([
    ["bir saniye", true],
    ["Bir dakika düşünüyorum", true],
    ["let me think", true],
    ["one moment", true],
    ["bir saniye ekipleri aç", false],
    ["düşünüyorum ama aç", false],
    ["tamam", false],
    ["hayır, ekipleri", false],
    ["stop", false],
    ["", false],
  ])("thinking pause %s: %s", (transcript, expected) => {
    expect(shouldWaitForVoice(transcript)).toBe(expected);
  });
  it.each([
    ["ekipleri", "crews"],
    ["ekiplerim", "crews"],
    ["ekipteki", "crews"],
    ["takımlar", "crews"],
    ["görevler", "tasks"],
    ["notlar", "notes"],
    ["projeler", "projects"],
    ["gelen kutusu", "inbox"],
    ["sunucular", "servers"],
    ["ayarlar", "settings"],
    ["クルー", "crews"],
    ["小队", "crews"],
    ["tâches", "tasks"],
    ["proyectos", "projects"],
  ])("search phrase %s maps to %s", (query, feature) => {
    expect(voiceSearchClauses(query).some((clause) => clause.feature === feature)).toBe(true);
  });
  it.each(["Kree", "ekipman", "görevdaş", "sunuculuk"])(
    'does not promote unrelated name "%s" to a feature',
    (query) => {
      expect(voiceSearchClauses(query).some((clause) => clause.feature)).toBe(false);
    },
  );
  it.each([en, tr, de, es, fr, ja, pt, zh])("recognizes supported locale UI labels", (locale) => {
    const labels = {
      Crew: "crews",
      Crews: "crews",
      Tasks: "tasks",
      Notes: "notes",
      Projects: "projects",
      Inbox: "inbox",
      Archive: "archive",
      Settings: "settings",
      Servers: "servers",
      Search: "search",
    } as const;
    for (const [key, feature] of Object.entries(labels)) {
      const label = locale[key as keyof typeof labels];
      expect(
        voiceSearchClauses(label).some((clause) => clause.feature === feature),
        `${key}: ${label}`,
      ).toBe(true);
    }
  });
});

const profile = { proactiveSpeech: "return", quietStart: 22, quietEnd: 8 } as AssistantProfile;
const eligible: VoiceBriefingDelivery = {
  profile,
  presence: "active",
  status: "ready",
  hold: false,
  hour: 10,
  now: 100_000,
  briefing: { id: "return-demo", createdAt: 99_000 },
  reason: "return",
  returnAt: 98_000,
  returnBriefingId: "return-demo",
  meaningful: true,
  conversationBusy: false,
  delivery: "pending",
};
describe("briefing decision regression corpus", () => {
  it.each([
    ["fresh identified return", {}, true],
    ["daily snapshot", { returnBriefingId: "daily" }, false],
    ["no observed return", { returnAt: undefined }, false],
    ["stale return", { now: 500_000 }, false],
    ["future snapshot", { briefing: { id: "return-demo", createdAt: 101_000 } }, false],
    ["empty snapshot", { meaningful: false }, false],
    ["busy conversation", { conversationBusy: true }, false],
    ["already delivered", { delivery: "delivered" }, false],
    ["interrupted delivery", { delivery: "interrupted" }, false],
    ["unknown delivery", { delivery: "unknown" }, false],
    ["unknown presence", { presence: "unknown" }, false],
    ["held", { hold: true }, false],
    ["quiet hours", { hour: 23 }, false],
    ["disabled", { profile: { ...profile, proactiveSpeech: "never" } }, false],
    [
      "important event enabled",
      { reason: "important", profile: { ...profile, proactiveSpeech: "important" } },
      true,
    ],
    ["important event disabled", { reason: "important" }, false],
  ] as Array<[string, Partial<VoiceBriefingDelivery>, boolean]>)(
    "%s",
    (_name, changes, expected) => {
      expect(mayDeliverVoiceBriefing({ ...eligible, ...changes })).toBe(expected);
    },
  );
});
