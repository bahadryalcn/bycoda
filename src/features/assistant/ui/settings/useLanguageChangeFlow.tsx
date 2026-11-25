import { useState, type ReactNode } from "react";
import { t } from "../../../../shared/i18n";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import { loadVoiceSettings } from "../../../voice/model/voiceSettings";
import {
  languageChange,
  languageDisplayName,
  type LanguageBoundItem,
  type LanguageChange,
  type VoiceLanguageSettings,
} from "../../model/languageBoundSettings";
import type { LanguageReview } from "../AssistantProfileFields";
import { LanguageChangeDialog } from "./LanguageChangeDialog";

const PROFILE_KEYS = ["persona", "addressAs"] as const;

type Review = {
  change: LanguageChange;
  /** Profile values at the change; a field stops being flagged once the owner edits it. */
  recorded: Partial<Record<(typeof PROFILE_KEYS)[number], string>>;
};

/**
 * Warns before the spoken language changes while language-bound settings exist. The language is
 * applied only after the owner picks "review myself" or "create again with AI"; Cancel keeps it.
 * Applying edits the caller's draft, so the normal Save stays the one place that persists it.
 */
export function useLanguageChangeFlow({
  draft,
  lastSpoken,
  applyLanguage,
  startBuilder,
  readVoice = loadVoiceSettings,
}: {
  draft: AssistantProfilePatch;
  lastSpoken: string | null | undefined;
  applyLanguage: (language: string) => void;
  /** Opens the AI builder on the already-updated draft, asking it to rewrite in `language`. */
  startBuilder: (request: string) => void;
  readVoice?: () => VoiceLanguageSettings;
}): {
  /** Handles a profile patch; returns true when the patch was held for the owner's decision. */
  intercept: (patch: AssistantProfilePatch) => boolean;
  review: LanguageReview | undefined;
  clearReview: () => void;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<LanguageChange | null>(null);
  const [review, setReview] = useState<Review | null>(null);

  function intercept(patch: AssistantProfilePatch) {
    if (patch.language === undefined || patch.language === (draft.language ?? "auto")) return false;
    const change = languageChange({
      previous: draft.language,
      next: patch.language,
      lastSpoken,
      profile: draft,
      voice: readVoice(),
    });
    if (change.items.length === 0) return false;
    setPending(change);
    return true;
  }

  function accept(change: LanguageChange) {
    applyLanguage(change.to);
    setReview({ change, recorded: { persona: draft.persona, addressAs: draft.addressAs } });
    setPending(null);
  }

  const shown = review ? reviewFor(review, draft) : undefined;
  return {
    intercept,
    review: shown,
    clearReview: () => setReview(null),
    dialog: pending && (
      <LanguageChangeDialog
        change={pending}
        onCancel={() => setPending(null)}
        onReview={() => accept(pending)}
        onRewrite={() => {
          accept(pending);
          startBuilder(
            t("Rewrite my persona and how you address me in {p0}. Keep the same character.", {
              p0: languageDisplayName(pending.to),
            }),
          );
        }}
      />
    ),
  };
}

function reviewFor({ change, recorded }: Review, draft: AssistantProfilePatch) {
  const keys = new Set<string>(
    change.items
      .map((item: LanguageBoundItem) => item.key)
      .filter(
        (key): key is (typeof PROFILE_KEYS)[number] =>
          (PROFILE_KEYS as readonly string[]).includes(key) &&
          draft[key as (typeof PROFILE_KEYS)[number]] ===
            recorded[key as (typeof PROFILE_KEYS)[number]],
      ),
  );
  const other = change.items
    .filter((item) => !(PROFILE_KEYS as readonly string[]).includes(item.key))
    .map((item) => item.label);
  if (keys.size === 0 && other.length === 0) return undefined;
  const to = languageDisplayName(change.to);
  return {
    keys,
    text: change.from
      ? t("Written for {p0}. Check that it fits {p1}.", {
          p0: languageDisplayName(change.from),
          p1: to,
        })
      : t("Written for another language. Check that it fits {p0}.", { p0: to }),
    extraText:
      other.length > 0
        ? t("Also check these voice settings: {p0}.", { p0: other.join(", ") })
        : undefined,
  } satisfies LanguageReview;
}
