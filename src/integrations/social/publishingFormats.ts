import type { CampaignVariant, SocialAccount } from "../../features/social/model/social";

/** Default X post weighting: normalized Unicode, emoji clusters and fixed URL weight.
 * Longer-post entitlements are deliberately not inferred from account connection. */
export function xPostWeight(text: string): number {
  const normalized = text.normalize("NFC").replace(/https?:\/\/[^\s]+/giu, "x".repeat(23));
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locale: string,
        options: { granularity: "grapheme" },
      ) => { segment(text: string): Iterable<{ segment: string }> };
    }
  ).Segmenter;
  const segments = Segmenter
    ? new Segmenter("en", { granularity: "grapheme" }).segment(normalized)
    : Array.from(normalized, (segment) => ({ segment }));
  let weight = 0;
  for (const { segment } of segments) {
    if (/\p{Extended_Pictographic}|[\u{1f1e6}-\u{1f1ff}]/u.test(segment)) {
      weight += 2;
      continue;
    }
    for (const char of segment) {
      const c = char.codePointAt(0)!;
      weight +=
        c <= 0x10ff ||
        (c >= 0x2000 && c <= 0x200d) ||
        (c >= 0x2010 && c <= 0x201f) ||
        (c >= 0x2032 && c <= 0x2037)
          ? 1
          : 2;
    }
  }
  return weight;
}
export function validatePublishingText(account: SocialAccount, variant: CampaignVariant) {
  const text = [variant.text, variant.link].filter(Boolean).join("\n");
  if (account.platform === "x" && xPostWeight(text) > 280)
    throw new Error(
      "X content exceeds the supported standard post length, including weighted links and emoji.",
    );
}
