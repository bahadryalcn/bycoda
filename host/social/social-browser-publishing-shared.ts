import type { SocialAccount, SocialJob } from "../../src/features/social/model/social";
import { type SocialInbound, SocialPlatformError } from "../../src/integrations/social/adapter";
import type { BrowserRecipeContext } from "./social-browser-recipe";
export const unsupported = () => new SocialPlatformError("unsupported");
export const unknown = () => new SocialPlatformError("unknown");
export const denied = () => new SocialPlatformError("denied");
export const json = JSON.stringify;
export const content = (job: SocialJob) =>
  [job.payload.text, job.payload.link].filter(Boolean).join("\n");

/** Mark only a unique control. Ambiguous matches must never pick the first Post/Send button. */
export async function control(
  ctx: BrowserRecipeContext,
  selector: string,
  token: string,
  labels?: readonly string[],
  hidden = false,
): Promise<string> {
  const marked = await ctx.waitFor<boolean>(
    String.raw`(() => {
    const labels = ${json(labels ?? [])};
    const matches = [...document.querySelectorAll(${json(selector)})].filter(el =>
      (${hidden} || (el.getClientRects().length && !el.hidden)) &&
      !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
      (!labels.length || labels.includes((el.getAttribute('aria-label') || el.textContent || '').trim())));
    if (matches.length !== 1) return false;
    document.querySelectorAll('[data-bycoda-web-control]').forEach(el => el.removeAttribute('data-bycoda-web-control'));
    matches[0].setAttribute('data-bycoda-web-control', ${json(token)}); return true;
  })()`,
    20_000,
  );
  if (!marked) throw unsupported();
  return `[data-bycoda-web-control=${json(token)}]`;
}

export async function click(
  ctx: BrowserRecipeContext,
  selector: string,
  token: string,
  labels?: readonly string[],
) {
  const target = await control(ctx, selector, token, labels);
  await ctx.verifyIdentity();
  await ctx.page.click(target);
}

export async function fill(
  ctx: BrowserRecipeContext,
  selector: string,
  token: string,
  value: string,
  replaceGenerated = false,
) {
  const target = await control(ctx, selector, token);
  await ctx.verifyIdentity();
  const existing = await ctx.page.evaluate<string | undefined>(
    String.raw`(() => {const el=document.querySelector(${json(target)});return el?String(el.value??el.textContent??''):undefined;})()`,
  );
  if (existing === undefined || (!replaceGenerated && existing.trim() && existing !== value))
    throw denied();
  await ctx.page.fill(target, value);
}

export async function files(ctx: BrowserRecipeContext, selector: string) {
  const target = await control(ctx, selector, "media", undefined, true);
  await ctx.verifyIdentity();
  await ctx.page.setFiles(
    target,
    ctx.files.map((item) => item.path),
  );
}

export function inputId(value: string | undefined, expression: RegExp): string {
  if (!value || !expression.test(value)) throw denied();
  return value;
}

export function readJson(raw: string): Record<string, any> | undefined {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function submitResponse(
  ctx: BrowserRecipeContext,
  path: RegExp,
  parse: (raw: string) => string | undefined,
  selector: string,
  token: string,
  labels?: readonly string[],
): Promise<string> {
  const target = await control(ctx, selector, token, labels);
  const watcher = ctx.page.watchResponse(path, (raw) => !!parse(raw));
  let submitted = false;
  try {
    await ctx.verifyIdentity();
    // Never retry a click: even an exception can occur after the browser dispatched it.
    submitted = true;
    ctx.markSubmitted?.();
    await ctx.page.click(target);
    const raw = await watcher.body(30_000);
    const id = raw && parse(raw);
    if (!id) throw unknown();
    await ctx.verifyIdentity();
    return id;
  } catch (error) {
    if (submitted) throw unknown();
    throw error;
  } finally {
    watcher.stop();
  }
}

export type CommentRow = {
  id: string;
  postId: string;
  contactId: string;
  name: string;
  text: string;
  at: number;
  parent?: string;
};
export function rowsToInbound(rows: CommentRow[], account: SocialAccount): SocialInbound[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (
        !row ||
        !row.id ||
        !row.postId ||
        !row.contactId ||
        !row.text ||
        !Number.isFinite(row.at) ||
        row.at <= 0 ||
        row.contactId === account.platformId ||
        seen.has(row.id)
      )
        return false;
      seen.add(row.id);
      return true;
    })
    .slice(0, 100)
    .map((row) => ({
      eventId: row.id,
      threadId: row.id,
      postId: row.postId,
      contactId: row.contactId,
      contactName: row.name,
      text: row.text,
      kind: "comment",
      at: row.at,
    }));
}
