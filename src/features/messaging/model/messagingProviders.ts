import { MESSAGING_PROVIDER_LABELS } from "./messageThreads";
import type { MessagingProvider } from "./messagingTypes";

/**
 * Providers users can connect. Discord and Microsoft Teams are paused; add them back here to
 * offer them again. Accounts saved earlier keep working in Messages either way.
 */
export const ENABLED_MESSAGING_PROVIDERS: readonly MessagingProvider[] = ["email", "slack"];

export const isMessagingProviderEnabled = (provider: string): boolean =>
  (ENABLED_MESSAGING_PROVIDERS as readonly string[]).includes(provider);

/** A known messaging provider that is not offered right now; other ids are not messaging. */
export const isPausedMessagingProvider = (id: string): boolean =>
  Object.prototype.hasOwnProperty.call(MESSAGING_PROVIDER_LABELS, id) &&
  !isMessagingProviderEnabled(id);
