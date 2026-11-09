/** Conservative whole-utterance policy. Unknown speech always reaches the normal route. */
export function shouldWaitForVoice(transcript: string): boolean {
  const text = transcript
    .toLocaleLowerCase("tr")
    .normalize("NFC")
    .replace(/[.,!?…]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  return /^(dur|bekle|bir saniye|bir dakika|düşünüyorum|bir saniye düşünüyorum|bir dakika düşünüyorum|hold on|wait|one moment|one second|wait a moment|let me think)$/.test(
    text,
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
  return /^(tamam|anladım|teşekkürler|teşekkür ederim|sağ ol|sağ olun|hı hı|hıhı|evet anladım|okay|ok|got it|understood|thanks|thank you|uh huh|mm hmm|d'accord|merci|entendido|gracias|verstanden|danke)$/.test(
    text,
  );
}
