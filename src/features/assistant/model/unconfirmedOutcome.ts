/**
 * The one wording for "the Host may or may not have applied this change" (#309): the subject
 * "could not be confirmed", then an optional next step. Model-layer errors build their message
 * here so "not confirmed", "unconfirmed" and "uncertain" never drift apart; UI sentences that
 * go through `t()` keep whole-sentence keys with the same wording.
 */
export function unconfirmedMessage(subject: string, nextStep?: string) {
  return nextStep
    ? `${subject} could not be confirmed. ${nextStep}`
    : `${subject} could not be confirmed.`;
}

export function unconfirmedError(subject: string, nextStep?: string) {
  return new Error(unconfirmedMessage(subject, nextStep));
}
