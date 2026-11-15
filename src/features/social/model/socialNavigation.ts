/** Window event that opens the Social surface, with the project folder it starts in (empty: keep the current one). */
export const SOCIAL_PANEL_EVENT = "bycoda:open-social-panel";

/** Screens a notification can open. */
export type SocialNotificationScreen = "command" | "accounts";

/** Window event that asks an open Social surface to show one of its screens. */
export const SOCIAL_SCREEN_EVENT = "bycoda:social-screen";

type SocialScreenRequest = { screen: SocialNotificationScreen; target?: unknown; at: number };
/** A request outlives the click for this long, so a surface that is still opening can take it. */
const REQUEST_TTL_MS = 10_000;
let pending: SocialScreenRequest | null = null;

/**
 * Notification clicks and history rows ask for a screen here, with the screen's own navigation
 * target (Accounts takes `{ accountId }`). The request is kept until a surface with a selected
 * computer takes it, so a click that also opens the surface is not lost.
 */
export function requestSocialScreen(screen: SocialNotificationScreen, target?: unknown) {
  pending = { screen, target, at: Date.now() };
  window.dispatchEvent(new Event(SOCIAL_SCREEN_EVENT));
}

/** The newest unexpired request, consumed once. */
export function takeSocialScreenRequest(): Omit<SocialScreenRequest, "at"> | null {
  const request = pending;
  pending = null;
  return request && Date.now() - request.at <= REQUEST_TTL_MS
    ? { screen: request.screen, target: request.target }
    : null;
}
