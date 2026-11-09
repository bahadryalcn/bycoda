import type { ChallengeHit } from "./browser/challenge";
import type { BrowserPage } from "./social-browser";

/**
 * Read-only probe for WhatsApp Web's link-device screen. It reports presence only: the QR image and the
 * page text are never returned, and nothing is scanned or clicked. A visible QR means the owner must link
 * the device in the live view, so the poll and send paths stop with NEEDS_HUMAN.
 */
const PROBE = String.raw`(() => {
  const visible = e => !!e && !e.hidden && e.getAttribute('aria-hidden') !== 'true' && !!e.getClientRects().length;
  const qr = [...document.querySelectorAll('canvas')].some(e => visible(e) &&
    (/qr/i.test(e.getAttribute('aria-label') || '') || !!e.closest('[data-ref]')));
  const copy = [...document.querySelectorAll('h1, h2, h3, div[role="heading"], div')].slice(0, 500).some(e => visible(e) &&
    !e.children.length && /^(?:Use WhatsApp on your computer|Scan the QR code|Link a device|Link with phone number|QR kodunu tarayın|Cihaz bağla|Telefon numarasıyla bağla)$/i.test((e.textContent || '').trim()));
  return { origin: location.origin, pathname: location.pathname, login: qr || copy };
})()`;

/** Returns a login hit (origin and path only) when the link-device screen is visible. */
export async function whatsappLinkScreen(page: BrowserPage): Promise<ChallengeHit | undefined> {
  const probe = await page
    .evaluate<{ origin: string; pathname: string; login: boolean } | undefined>(PROBE)
    .catch(() => undefined);
  if (!probe?.login) return undefined;
  return { kind: "login", url: `${probe.origin}${probe.pathname}` };
}
