import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import { exact } from "./core/social-helpers";
import type { BrowserRecipeContext } from "./social-browser-recipe";

const origin = "https://www.linkedin.com";
const profileMarker = "data-bycoda-li-profile-control";
const sections = {
  headline: {
    editor: /^\/edit\/intro\/?$/,
    headings: ["Edit intro", "Edit introduction", "Giriş bölümünü düzenle"],
    labels: ["Headline", "Başlık", "Profesyonel başlık"],
    limit: 220,
  },
  about: {
    editor: /^\/edit\/(?:about|forms\/summary\/new)\/?$/,
    headings: ["Edit about", "Hakkında bölümünü düzenle"],
    labels: ["About", "Hakkında"],
    limit: 2600,
  },
} as const;

export type LinkedInMemberProfileSection = keyof typeof sections;
export type LinkedInMemberProfileValue = { section: LinkedInMemberProfileSection; value: string };
export type LinkedInMemberProfileUpdate = LinkedInMemberProfileValue & { expectedValue: string };

function parseSection(section: unknown): LinkedInMemberProfileSection {
  if (section === "headline" || section === "about") return section;
  throw new SocialPlatformError("unsupported");
}

export function parseLinkedInMemberProfileUpdate(raw: unknown): LinkedInMemberProfileUpdate {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new SocialPlatformError("rejected");
  const input = raw as Record<string, unknown>;
  exact(input, ["section", "expectedValue", "value"]);
  const section = parseSection(input.section);
  const { expectedValue, value } = input;
  if (
    typeof expectedValue !== "string" ||
    typeof value !== "string" ||
    [expectedValue, value].some(
      (text) => text.includes("\0") || text.length > sections[section].limit,
    ) ||
    (section === "headline" && (!value.trim() || /[\r\n]/.test(value)))
  )
    throw new SocialPlatformError("rejected");
  return { section, expectedValue, value: value.replace(/\r\n?/g, "\n") };
}

async function requireOrdinaryPage(ctx: BrowserRecipeContext) {
  const challenge = await detectChallenge(ctx.page);
  if (challenge) throw needsHumanError(challenge);
}

function profilePath(ctx: BrowserRecipeContext) {
  const slug = /^web:linkedin:in:([\w-]{1,100})$/.exec(ctx.account.platformId)?.[1];
  if (
    !slug ||
    ctx.account.platform !== "linkedin" ||
    ctx.account.accountType !== "member" ||
    ctx.account.connection !== "browser"
  )
    throw new SocialPlatformError("denied");
  return `/in/${slug}`;
}

async function openEditor(ctx: BrowserRecipeContext, section: LinkedInMemberProfileSection) {
  const path = profilePath(ctx);
  const editor = sections[section].editor;
  await ctx.page.goto(`${origin}${path}/`);
  await requireOrdinaryPage(ctx);
  await ctx.verifyIdentity();
  // Navigate only to the member's own editor offered by the signed-in profile.
  const location = await ctx.waitFor<string>(
    String.raw`(() => {
    const path = ${JSON.stringify(path)};
    if (location.origin !== ${JSON.stringify(origin)} || location.pathname.replace(/\/$/, '') !== path) return;
    const result = new Set();
    for (const element of document.querySelectorAll('main a[href]')) {
      if (!element.getClientRects().length || element.closest('[hidden],[aria-hidden="true"]')) continue;
      const url = URL.parse(element.getAttribute('href'), location.origin);
      if (!url || url.origin !== location.origin || url.username || url.password || !url.pathname.startsWith(path + '/')) continue;
      if (${editor}.test(url.pathname.slice(path.length))) result.add(url.pathname);
    }
    if (result.size === 1) return [...result][0];
  })()`,
    10_000,
  );
  await requireOrdinaryPage(ctx);
  if (!location || !location.startsWith(`${path}/`) || !editor.test(location.slice(path.length)))
    throw new SocialPlatformError("unsupported");
  await ctx.verifyIdentity();
  await ctx.page.goto(`${origin}${location}`);
  return location.replace(/\/$/, "");
}

function editorProbe(path: string, section: LinkedInMemberProfileSection) {
  const { headings, labels } = sections[section];
  return String.raw`(() => {
    if (location.origin !== ${JSON.stringify(origin)} || location.pathname.replace(/\/$/, '') !== ${JSON.stringify(path)}) return;
    const visible = el => !!el.getClientRects().length && !el.closest('[hidden],[aria-hidden="true"]');
    const norm = value => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const dialogs = [...document.querySelectorAll('dialog[open],[role="dialog"]')].filter(visible);
    if (dialogs.length !== 1) return;
    const dialog = dialogs[0];
    const title = [...dialog.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(el =>
      visible(el) && ${JSON.stringify(headings.map((heading) => heading.toLowerCase()))}.includes(norm(el.textContent)));
    if (title.length !== 1) return;
    if ([...dialog.querySelectorAll('input[type="password"],input[autocomplete="one-time-code"]')].some(visible)) return;
    const labels = ${JSON.stringify(labels.map((label) => label.toLowerCase()))};
    const inputs = [...dialog.querySelectorAll('input[type="text"],input:not([type]),textarea')].filter(el =>
      visible(el) && !el.disabled && !el.readOnly && el.getAttribute('aria-readonly') !== 'true' &&
      [el.getAttribute('aria-label'), ...[...el.labels || []].map(label => label.textContent),
        ...(el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent)]
        .some(label => labels.includes(norm(label))));
    const saves = [...dialog.querySelectorAll('button')].filter(el =>
      visible(el) && ['save', 'kaydet'].includes(norm(el.textContent)));
    if (inputs.length !== 1 || saves.length !== 1) return;
    const marker = ${JSON.stringify(profileMarker)};
    document.querySelectorAll('[' + marker + ']').forEach(el => el.removeAttribute(marker));
    inputs[0].setAttribute(marker, 'field');
    saves[0].setAttribute(marker, 'save');
    return { value: inputs[0].value, editable: !saves[0].disabled && saves[0].getAttribute('aria-disabled') !== 'true' };
  })()`;
}

type Editor = { value: string; editable: boolean };

async function readEditor(
  ctx: BrowserRecipeContext,
  probe: string,
  wait: boolean,
): Promise<Editor> {
  await requireOrdinaryPage(ctx);
  await ctx.verifyIdentity();
  const editor = wait
    ? await ctx.waitFor<Editor>(probe, 10_000)
    : await ctx.page.evaluate<Editor | undefined>(probe);
  await requireOrdinaryPage(ctx);
  if (!editor || typeof editor.value !== "string" || typeof editor.editable !== "boolean")
    throw new SocialPlatformError("unsupported");
  return editor;
}

/** Read only the requested field. Values of other profile fields never leave the editor. */
export async function readLinkedInMemberProfile(
  ctx: BrowserRecipeContext,
  section: LinkedInMemberProfileSection,
): Promise<LinkedInMemberProfileValue> {
  parseSection(section);
  const path = await openEditor(ctx, section);
  return { section, value: (await readEditor(ctx, editorProbe(path, section), true)).value };
}

/** The caller authorizes the exact reviewed consequence immediately before the Save click. */
export async function updateLinkedInMemberProfile(
  ctx: BrowserRecipeContext,
  raw: unknown,
  beforeSubmit: () => Promise<void>,
): Promise<LinkedInMemberProfileValue> {
  const { section, expectedValue, value } = parseLinkedInMemberProfileUpdate(raw);
  const path = await openEditor(ctx, section);
  const probe = editorProbe(path, section);
  const before = await readEditor(ctx, probe, true);
  if (before.value !== expectedValue) throw new SocialPlatformError("denied");
  if (value === expectedValue) return { section, value };
  await ctx.page.fill(`[${profileMarker}="field"]`, value);
  const prepared = await readEditor(ctx, probe, false);
  if (prepared.value !== value || !prepared.editable) throw new SocialPlatformError("unsupported");
  await beforeSubmit();
  await requireOrdinaryPage(ctx);
  const ready = await ctx.page.evaluate<Editor | undefined>(probe);
  if (ready?.value !== value || !ready.editable) throw new SocialPlatformError("denied");
  ctx.markSubmitted?.();
  try {
    await ctx.page.click(`[${profileMarker}="save"]`);
    const closed = await ctx.waitFor<boolean>(
      String.raw`(() => {
      const path = location.pathname.replace(/\/$/, '');
      return location.origin === ${JSON.stringify(origin)} && (
        path === ${JSON.stringify(profilePath(ctx))} ||
        (path === ${JSON.stringify(path)} && ![...document.querySelectorAll('dialog[open],[role="dialog"]')].some(el => el.getClientRects().length && !el.closest('[hidden],[aria-hidden="true"]')))
      );
    })()`,
      10_000,
    );
    if (!closed || (await readLinkedInMemberProfile(ctx, section)).value !== value)
      throw new SocialPlatformError("unknown");
  } catch {
    throw new SocialPlatformError("unknown");
  }
  return { section, value };
}
