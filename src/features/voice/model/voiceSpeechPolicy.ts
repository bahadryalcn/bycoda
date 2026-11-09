/** Conservative whole-utterance policy. Unknown speech always reaches the normal route. */
export function shouldWaitForVoice(transcript: string): boolean {
  const text = transcript
    .toLocaleLowerCase("tr")
    .normalize("NFC")
    .replace(/[.,!?…]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  return /^(dur|bekle|bir saniye|bir dakika|(?:bir (?:saniye|dakika) dur)|(?:dur bir (?:saniye|dakika))|biraz bekle|dur bakayım|düşünüyorum|bir saniye düşünüyorum|bir dakika düşünüyorum|hold on|wait|one moment|one second|wait a moment|wait a (?:sec|second|minute)|hold on a (?:sec|second|minute|moment)|let me think)$/.test(
    text,
  );
}

const OFFER_TR =
  /istersen|isterseniz|ister misin|ister misiniz|[ae]y[ıi]m m[ıiuü]|[ae]bilir[iı]m|yapay[ıi]m|başlatay[ıi]m|başlat[ıi]r[ıi]m|yapar[ıi]m/u;
const OFFER_EN =
  /\bif you(?:['’]d)? (?:want|like|wish)\b|\bshall i\b|\bshould i\b|\bwant me to\b|\bwould you like\b|\bdo you want\b|\bi (?:can|could)\b/u;
/** An answer that ends in an offer turns a bare "ok" into a yes the model must see. */
function endsInOffer(text: string): boolean {
  const tail = text.slice(-240);
  return (
    OFFER_TR.test(tail.toLocaleLowerCase("tr").normalize("NFC")) ||
    OFFER_EN.test(tail.toLowerCase().normalize("NFC"))
  );
}

export function shouldSilentlyAcknowledgeVoice(input: {
  transcript: string;
  lastDeliveredAssistant?: string | null;
  pendingQuestion?: boolean;
  pendingChoice?: boolean;
  speaking?: boolean;
}): boolean {
  if (/[?？]/u.test(input.transcript)) return false;
  const text = input.transcript
    .toLocaleLowerCase("tr")
    .normalize("NFC")
    .replace(/^[\s.,!?…]+|[\s.,!?…]+$/gu, "")
    .replace(/\s+/g, " ");
  if (input.pendingQuestion || input.pendingChoice) return false;
  // A listening signal during the first answer also preserves the speaker's
  // floor; bare confirmations need a completed prior answer.
  if (input.speaking && /^(hı hı|hıhı|uh huh|mm hmm)$/.test(text)) return true;
  if (!input.lastDeliveredAssistant?.trim()) return false;
  if (endsInOffer(input.lastDeliveredAssistant)) return false;
  return /^(tamam|anladım|teşekkürler|teşekkür ederim|sağ ol|sağ olun|hı hı|hıhı|evet anladım|okay|ok|got it|understood|thanks|thank you|uh huh|mm hmm|d'accord|merci|entendido|gracias|verstanden|danke)$/.test(
    text,
  );
}
