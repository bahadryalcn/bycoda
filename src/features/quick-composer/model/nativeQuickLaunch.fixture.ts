/** Synthetic transport replies for renderer tests; not Native proof. */
export function quickNativeReply(command: string, args?: unknown, state = "queued") {
  const scope = {
    windowEpoch: "d52e6bea-790c-4e8c-a0f1-b899b530837e",
    storeInstance: "44e97154-9798-47f9-8be5-b13b142db27f",
  };
  if (command === "quick_composer_launch_scope")
    return { version: 1, scope, nextSequence: 1, qualified: false };
  if (command === "quick_composer_submit_intent" || command === "quick_composer_submit_status") {
    const data = args as { submission?: Record<string, unknown>; query?: Record<string, unknown> };
    const value = data.submission ?? data.query!;
    return {
      version: 1,
      scope: value.scope,
      sequence: value.sequence,
      intentId: value.intentId,
      requestDigest: "a".repeat(64),
      deliveryId: "35dc17ce-4b2a-4734-b46e-d72809b40958",
      state,
      qualified: false,
    };
  }
  return undefined;
}
