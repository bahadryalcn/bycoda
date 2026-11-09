import type { SocialJob } from "../../src/features/social/model/social";
import { SocialPlatformError, type SocialSendResult } from "../../src/integrations/social/adapter";
import { META_RATE_LIMIT_CODES } from "../../src/integrations/social/meta-codes";
import type { BrowserPage } from "./social-browser";
import type { BrowserRecipeContext, BrowserIdentity } from "./social-browser-recipe";
import { detectChallenge, needsHumanError } from "./browser/challenge";

export type Value = Record<string, any>;
export const numeric = (value: unknown): value is string =>
  typeof value === "string" && /^\d{1,30}$/.test(value);
export const object = (value: unknown): value is Value =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const ownText = (job: SocialJob) =>
  [job.payload.text, job.payload.link].filter(Boolean).join("\n");

/** Meta prefixes some ordinary browser responses with an anti-XSSI guard. */
export function values(raw: string, read = false): Value[] {
  if (typeof raw !== "string" || raw.length > 8 * 1024 * 1024)
    throw new SocialPlatformError(read ? "unsupported" : "unknown");
  const body = raw.replace(/^\s*for\s*\(;;\);\s*/, "").trim();
  const result: Value[] = [];
  try {
    const value = JSON.parse(body);
    if (object(value)) result.push(value);
  } catch {
    for (const line of body.split("\n").slice(0, 100)) {
      try {
        const value = JSON.parse(line);
        if (object(value)) result.push(value);
      } catch {
        // A streamed response must contain a complete recognized JSON record below.
      }
    }
  }
  if (!result.length) throw new SocialPlatformError(read ? "unsupported" : "unknown");
  for (const value of result) {
    const errors = Array.isArray(value.errors) ? value.errors : [];
    if (
      !read &&
      (errors.length || value.status === "fail" || value.error) &&
      (value.data || value.media || value.comment || value.payload)
    )
      throw new SocialPlatformError("unknown");
    if (errors.some((entry: Value) => [190, 102, 1357004].includes(Number(entry.code))))
      throw new SocialPlatformError("expired");
    if (errors.some((entry: Value) => META_RATE_LIMIT_CODES.includes(Number(entry.code))))
      throw new SocialPlatformError("rate_limit", Date.now() + 60_000);
    if (errors.length || value.status === "fail" || value.error)
      throw new SocialPlatformError("rejected");
  }
  return result;
}

export function at(raw: unknown, now: number): number | undefined {
  let value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return;
  if (value > 100_000_000_000_000) value /= 1000;
  else if (value < 100_000_000_000) value *= 1000;
  return value <= now + 5 * 60_000 ? Math.trunc(value) : undefined;
}

export async function identity(
  page: BrowserPage,
  platform: "instagram" | "facebook",
): Promise<BrowserIdentity | undefined> {
  const cookies = await page.cookies([
    platform === "instagram" ? "https://www.instagram.com" : "https://www.facebook.com",
  ]);
  const single = (name: string) => {
    const found = cookies.filter((entry) => entry.name === name);
    return found.length === 1 ? found[0].value : undefined;
  };
  const current = await page.evaluate<{
    origin: string;
    path: string;
    authenticated: boolean;
    name?: string;
  }>(`(() => {
    const instagram = ${platform === "instagram"};
    const authenticated = instagram
      ? !!document.querySelector('a[href="/direct/inbox/"],a[href="/accounts/edit/"]')
      : !!document.querySelector('[role="banner"] [aria-label="Account"],[role="banner"] [aria-label="Account, your profile"],[role="banner"] [aria-label="Your profile"],[role="banner"] [aria-label="Hesabın"],[role="banner"] [aria-label="Profilin"]');
    return { origin: location.origin, path: location.pathname, authenticated };
  })()`);
  const origin =
    platform === "instagram" ? "https://www.instagram.com" : "https://www.facebook.com";
  if (
    current.origin !== origin ||
    !current.authenticated ||
    /\/(?:accounts\/login|accounts\/signup|challenge|checkpoint|login|recover)(?:\/|$)/.test(
      current.path,
    )
  )
    return;
  if (platform === "instagram") {
    const id = single("ds_user_id");
    if (!numeric(id) || !single("sessionid")) return;
    // This authenticated navigation/session evidence does not distinguish a personal account from a professional one.
    return { platformId: id, name: `Instagram ${id}` };
  }
  const user = single("c_user"),
    selected = single("i_user");
  if (!numeric(user) || !single("xs") || (selected !== undefined && !numeric(selected))) return;
  const actor = selected ?? user;
  return {
    platformId: actor,
    name: `Facebook ${actor}`,
    accountType: selected && selected !== user ? "page" : "member",
  };
}

/** Marks one visible semantic control, never the first of several matching controls. */
export async function mark(
  context: BrowserRecipeContext,
  selector: string,
  labels?: readonly string[],
  timeout = 15_000,
): Promise<string> {
  const name = "data-bycoda-meta-control";
  const matched = await context.waitFor<boolean>(
    `(() => {
    const labels = ${JSON.stringify(labels ?? [])};
    const elements = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(el =>
      (el.getClientRects().length || (el.tagName === 'INPUT' && el.type === 'file')) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
      (!labels.length || labels.includes((el.getAttribute('aria-label') || el.textContent || '').trim())));
    if (elements.length !== 1) return false;
    document.querySelectorAll('[${name}]').forEach(el => el.removeAttribute('${name}'));
    elements[0].setAttribute('${name}', 'true'); return true;
  })()`,
    timeout,
  );
  if (!matched) {
    // A checkpoint or login page replaces the expected control: hand it to the owner, never click through.
    const hit = await detectChallenge(context.page);
    if (hit) throw needsHumanError(hit);
    throw new SocialPlatformError("unsupported");
  }
  return `[${name}="true"]`;
}

export async function click(
  context: BrowserRecipeContext,
  selector: string,
  labels?: readonly string[],
) {
  await context.page.click(await mark(context, selector, labels));
}

export async function capture(
  context: BrowserRecipeContext,
  path: RegExp,
  action: () => Promise<void>,
  parse: (raw: string) => SocialSendResult,
  acceptBody?: (raw: string) => boolean,
): Promise<SocialSendResult> {
  await context.verifyIdentity();
  const watcher = context.page.watchResponse(path, acceptBody);
  try {
    try {
      context.markSubmitted?.();
      await action();
    } catch {
      throw new SocialPlatformError("unknown");
    }
    const body = await watcher.body(45_000);
    if (!body) throw new SocialPlatformError("unknown");
    let result: SocialSendResult;
    try {
      result = parse(body);
    } catch (error) {
      if (
        error instanceof SocialPlatformError &&
        ["rate_limit", "expired", "rejected", "denied"].includes(error.code)
      )
        throw error;
      throw new SocialPlatformError("unknown");
    }
    try {
      await context.verifyIdentity();
    } catch {
      throw new SocialPlatformError("unknown");
    }
    return result;
  } finally {
    watcher.stop();
  }
}

export async function readResponse(
  context: BrowserRecipeContext,
  url: string,
  path: RegExp,
  acceptBody?: (raw: string) => boolean,
): Promise<string> {
  const watcher = context.page.watchResponse(path, acceptBody);
  try {
    await context.page.goto(url);
    await context.verifyIdentity();
    const raw = await watcher.body(30_000);
    if (!raw) throw new SocialPlatformError("unsupported");
    await context.verifyIdentity();
    return raw;
  } finally {
    watcher.stop();
  }
}

export function containsData(
  raw: string,
  key: "story_create" | "comment_create" | "viewer",
): boolean {
  try {
    return values(raw, true).some((value) => object(value.data?.[key]));
  } catch {
    return false;
  }
}

export function validateText(job: SocialJob) {
  const text = ownText(job);
  if (text.length > 30_000 || text.includes("\0") || (!text.trim() && !job.payload.media.length))
    throw new SocialPlatformError("rejected");
  return text;
}

export function validateFiles(context: BrowserRecipeContext, job: SocialJob, required = false) {
  if (
    (required && !context.files.length) ||
    context.files.length !== job.payload.media.length ||
    context.files.length > 10 ||
    context.files.some(
      (entry, index) =>
        !entry.path ||
        entry.path.includes("\0") ||
        entry.kind === "document" ||
        entry.kind !== job.payload.media[index]?.kind,
    ) ||
    (context.files.some((entry) => entry.kind === "video") && context.files.length !== 1) ||
    job.payload.media.some((entry) => !entry.uploadId || !!entry.url)
  )
    throw new SocialPlatformError("unsupported");
}
