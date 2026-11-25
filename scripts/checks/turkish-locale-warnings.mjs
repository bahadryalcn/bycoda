const patterns = [
  ["placeholder-suffix", /\{p\d+\}['’]\p{L}/iu],
  [
    "sign-in-terminology",
    /(?<!\p{L})giriş\s+yap(?:ın|ınız|mak|madan|tığınız|tıktan|ıncaya|ma|mayın)?(?!\p{L})/iu,
  ],
  // Require a sentence ending to avoid short action labels.
  [
    "informal-imperative",
    /(?:(?:^|[.!?]\s+|[,;:]\s+)(?:lütfen\s+)?(?:sen\s+[\p{L}\s]+?|[\p{L}{}\d'’ -]*?))(?<!\p{L})(?:seç|ekle|aç|kapat|gönder|kaydet|başlat|durdur|bekle|tıkla|yaz|kur|git|dene|et|yap|sil|kopyala)(?=[.!?](?:\s|$))/iu,
  ],
];

export function turkishLocaleWarnings(value) {
  return patterns.filter(([, pattern]) => pattern.test(value)).map(([rule]) => rule);
}
