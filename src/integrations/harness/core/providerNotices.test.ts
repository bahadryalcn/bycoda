import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import { compactedText, compactingText } from "../../../features/sessions/model/compactionStatus";
import { reportAcpStopReason } from "./acpStopReason";
import {
  compactionFailedText,
  messageStoppedBeforeSentText,
  savedConversationUnavailableText,
  turnFinishedFollowUpText,
} from "./providerNotices";
import { grokAuthError } from "../providers/grok/grokProtocol";
import { hermesStartupError, hermesStderrAuthError } from "../providers/hermes/hermesProtocol";
import type { HarnessEvent } from "./types";

afterEach(async () => setLanguagePreference("en"));

it("keeps English wording and the event shape in English", () => {
  expect(messageStoppedBeforeSentText()).toBe("The message was stopped before it was sent.");
  expect(savedConversationUnavailableText()).toBe(
    "The saved provider conversation is unavailable. Starting a new session; the app will restore conversation context.",
  );
  expect(compactionFailedText()).toBe("Could not compact context");
  expect(compactionFailedText("quota")).toBe("Could not compact context: quota");
  expect(compactingText()).toBe("Compacting context…");
  expect(compactedText()).toBe("Compacted context");
  expect(turnFinishedFollowUpText()).toBe(
    "The previous turn has finished. Send this follow-up as a new message.",
  );
});

it("translates shared adapter notices and keeps provider diagnostics verbatim", async () => {
  await setLanguagePreference("tr");
  expect(messageStoppedBeforeSentText()).toBe("Mesaj gönderilmeden önce durduruldu.");
  expect(savedConversationUnavailableText()).not.toMatch(/saved provider conversation/);
  expect(compactingText()).toBe("Bağlam sıkıştırılıyor…");
  expect(compactedText()).toBe("Bağlam sıkıştırıldı");
  // The reason is provider text: it fills a slot and is never a catalog key.
  expect(compactionFailedText("Context {p0} overflow")).toBe(
    "Bağlam sıkıştırılamadı: Context {p0} overflow",
  );

  const events: HarnessEvent[] = [];
  expect(reportAcpStopReason({ stopReason: "max_tokens" }, (event) => events.push(event))).toBe(
    true,
  );
  expect(events).toEqual([
    {
      type: "session.error",
      message: expect.stringMatching(/^Üretim durdu \(max_tokens\)\. .*token sınırına/),
    },
  ]);

  // Original diagnostic first, translated sign-in help appended after it.
  const hermes = hermesStartupError(new Error("authentication failed: HTTP 401")).message;
  expect(hermes.startsWith("authentication failed: HTTP 401\n\n")).toBe(true);
  expect(hermes).toContain("`hermes acp --check`");
  expect(hermes).not.toContain("Configure Hermes");
  expect(hermesStderrAuthError("Error: not authenticated")).toBe(
    "Error: not authenticated\n\nHermes'i `hermes model` ile yapılandırın, ardından `hermes acp --check` ile doğrulayın.",
  );
  expect(grokAuthError(new Error("login required: code 7")).message).toBe(
    "login required: code 7\n\nGrok Build'de oturum açılmamış. Bir terminalde `grok login` çalıştırın veya XAI_API_KEY değerini ayarlayın.",
  );
  expect(grokAuthError(new Error("spawn ENOENT")).message).toBe(
    "Grok Build başlatılamadı. spawn ENOENT",
  );
});

// Every literal `t("…")` in the adapter status/error surface of #1372 has a
// translation with the same placeholders in all seven non-English catalogs.
const LOCALES = ["tr", "de", "fr", "es", "pt", "zh-CN", "ja"] as const;
const SURFACE = [
  "./acpStopReason.ts",
  "./providerNotices.ts",
  "../../../features/sessions/model/compactionStatus.ts",
  "../providers/antigravity/antigravity.ts",
  "../providers/antigravity/antigravityStream.ts",
  "../providers/antigravity/antigravityStreamProtocol.ts",
  "../providers/claude/claude.ts",
  "../providers/codex/codex.ts",
  "../providers/codex/codexProtocol.ts",
  "../providers/fx/fx.ts",
  "../providers/generic-acp/genericAcpAdapter.ts",
  "../providers/grok/grokProtocol.ts",
  "../providers/hermes/hermes.ts",
  "../providers/hermes/hermesProtocol.ts",
  "../providers/pi/piFamily.ts",
];
const slots = (text: string) => (text.match(/\{p\d+\}/g) ?? []).sort().join(",");
const readText = (relative: string, base: string) =>
  readFileSync(fileURLToPath(new URL(relative, base)), "utf8");

it("has every adapter notice key in all locale catalogs with matching slots", () => {
  const keys = new Set<string>();
  for (const file of SURFACE) {
    const code = readText(file, import.meta.url);
    for (const match of code.matchAll(/\bt\(\s*("(?:[^"\\\n]|\\.)*")/g))
      keys.add(JSON.parse(match[1]) as string);
  }
  expect(keys.size).toBeGreaterThanOrEqual(37);
  const catalogs = ["en", ...LOCALES].map((locale) => ({
    locale,
    catalog: JSON.parse(
      readText(`../../../shared/i18n/locales/${locale}.json`, import.meta.url),
    ) as Record<string, string>,
  }));
  const issues: string[] = [];
  for (const key of keys)
    for (const { locale, catalog } of catalogs) {
      const value = catalog[key];
      if (typeof value !== "string" || !value.trim()) issues.push(`${locale}: missing ${key}`);
      else if (slots(value) !== slots(key)) issues.push(`${locale}: slots ${key}`);
    }
  expect(issues).toEqual([]);
});
