import type { BrowserPage } from "../social-browser";
import type { ScreenSummary } from "./types";

/** A visible button the decision layer may pick. `selector` is never sent to a model. */
export type ScreenCandidate = { id: string; label: string; selector: string };
export type ScreenSnapshot = { summary: ScreenSummary; candidates: ScreenCandidate[] };

const MAX_ITEMS = 30;
const MAX_CANDIDATES = 20;
const MAX_TEXT = 120;

/**
 * Read-only DOM probe. It returns visible labels, headings and error text, plus a structural CSS path
 * for each safe button. It never reads field values, cookies, storage or query strings, and never
 * clicks, types, fills or submits.
 */
const PROBE = String.raw`(() => {
  const visible = el => !!el && !el.hidden && el.getAttribute('aria-hidden') !== 'true' && !!el.getClientRects().length;
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, ${MAX_TEXT});
  const pathOf = el => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      const index = Array.prototype.indexOf.call(node.parentElement.children, node) + 1;
      parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + index + ')');
    }
    return 'html > ' + parts.join(' > ');
  };
  const labelOf = el => clean(el.getAttribute('aria-label') || el.value || el.textContent);
  const controls = [...document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"],a[role="button"]')].filter(visible);
  const inForm = el => !!el.closest('form');
  const submits = el => el.getAttribute('type') === 'submit' || (el.tagName === 'INPUT' && el.type === 'submit') || (el.tagName === 'BUTTON' && !el.getAttribute('type') && inForm(el));
  const candidates = controls
    .filter(el => el.tagName !== 'A' && !submits(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true')
    .map(el => ({ label: labelOf(el), selector: pathOf(el) }))
    .filter(item => item.label.length > 0 && item.label.length <= 80)
    .slice(0, ${MAX_CANDIDATES});
  const texts = (selector, mapper) => [...document.querySelectorAll(selector)].filter(visible).map(mapper).filter(Boolean).slice(0, ${MAX_ITEMS});
  const fieldLabel = el => clean(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || (el.type === 'password' ? 'password' : ''));
  const textOf = el => clean(el.textContent);
  return {
    url: location.origin + location.pathname,
    title: clean(document.title),
    buttons: texts('button,[role="button"],input[type="button"],input[type="submit"],a[role="button"]', labelOf),
    fields: texts('input:not([type=hidden]):not([type=button]):not([type=submit]),textarea,select', fieldLabel),
    headings: texts('h1,h2,h3,[role="heading"]', textOf),
    errors: texts('[role="alert"],[aria-live="assertive"]', textOf),
    candidates,
  };
})()`;

type Probe = ScreenSummary & { candidates: { label: string; selector: string }[] };

const EMPTY: ScreenSummary = {
  url: "",
  title: "",
  buttons: [],
  fields: [],
  headings: [],
  errors: [],
};

/** Structural paths from the probe are the only selectors this module accepts back. */
export function isSafeCandidateSelector(selector: string): boolean {
  return selector.length <= 500 && /^html > [A-Za-z0-9 >:()_.#-]+$/.test(selector);
}

export async function summarizeScreen(page: BrowserPage): Promise<ScreenSnapshot> {
  const probe = await page.evaluate<Probe | undefined>(PROBE);
  if (!probe) return { summary: EMPTY, candidates: [] };
  const { candidates, ...summary } = probe;
  return {
    summary: {
      url: String(summary.url ?? ""),
      title: String(summary.title ?? ""),
      buttons: summary.buttons ?? [],
      fields: summary.fields ?? [],
      headings: summary.headings ?? [],
      errors: summary.errors ?? [],
    },
    candidates: (candidates ?? [])
      .filter((item) => isSafeCandidateSelector(item.selector))
      .map((item, index) => ({ id: `c${index + 1}`, label: item.label, selector: item.selector })),
  };
}
