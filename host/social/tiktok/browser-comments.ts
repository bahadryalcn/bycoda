import type { SocialSendResult } from "../../../src/integrations/social/adapter";
import type { BrowserPollResult, BrowserRecipeContext } from "../social-browser-recipe";
import {
  type CommentRow,
  denied,
  rowsToInbound,
  unknown,
} from "../social-browser-publishing-shared";
import {
  guardTikTokEngagement,
  readTikTokSurface,
  requireTikTokBrowser,
  TIKTOK_CONTACT,
  TIKTOK_DOM,
  TIKTOK_ID,
  TIKTOK_WEB,
  tiktokEngagementControl,
} from "./browser-engagement";

const COMMENTS_PATH = "/tiktokstudio/comments";
const COMMENTS_URL = `${TIKTOK_WEB}${COMMENTS_PATH}`;

// shortcut: Studio DOM contracts are fixture-verified. Revalidate when an owner connects a live session.
const commentsDom = (owner: string) => String.raw`
  ${TIKTOK_DOM}
  if (location.pathname.replace(/\/$/, '') !== ${JSON.stringify(COMMENTS_PATH)}) return;
  const list = one('[data-e2e="studio-comment-list"],[data-e2e="comment-management-list"]');
  if (!list || list.getAttribute('aria-busy') === 'true') return;
  const postMatches = row => {
    const links = all('a[data-e2e="comment-post-link"][href]', row);
    if (links.length !== 1) return;
    const path = sameOrigin(links[0].getAttribute('href'))?.pathname || '';
    const post = /^\/@([\w.]{2,24})\/(?:video|photo)\/(\d{1,30})\/?$/.exec(path);
    if (post?.[1].toLowerCase() === ${JSON.stringify(owner)}) return post[2];
  };
  const person = row => one('a[data-e2e="comment-author"][href]', row);
  const peer = row => handle(person(row)?.getAttribute('href'));
  const rows = all('[data-comment-id]', list).filter(row => !row.closest('[role="dialog"]'));
  const empty = () => !!one('[data-e2e="studio-comments-empty"]', list);
`;

export async function tiktokStudioComments(ctx: BrowserRecipeContext): Promise<BrowserPollResult> {
  const owner = requireTikTokBrowser(ctx);
  await ctx.page.goto(COMMENTS_URL);
  await guardTikTokEngagement(ctx);
  const snapshot = await readTikTokSurface<{ rows: CommentRow[]; partial: boolean }>(
    ctx,
    String.raw`(() => {
    ${commentsDom(owner)}
    if (!rows.length && !empty()) return;
    const result = rows.slice(0, 100).map(row => {
      const comment = row.getAttribute('data-comment-id'), postId = postMatches(row), author = peer(row);
      const body = text(one('[data-e2e="comment-text"]', row));
      const when = at(one('time[datetime]', row));
      if (!id(comment) || !postId || !author || !body || !Number.isFinite(when) || when <= 0) return null;
      return { id: comment, postId, contactId: 'web:tiktok:' + author, name: text(person(row)) || author, text: body, at: when };
    });
    const valid = result.filter(Boolean);
    if (result.length && !valid.length) return;
    return { rows: valid, partial: valid.length !== rows.length || !!one('[data-e2e="comments-next-page"]') };
  })()`,
  );
  return {
    events: rowsToInbound(snapshot.rows, ctx.account),
    coverage: [{ channel: "comments", status: snapshot.partial ? "partial" : "read" }],
  };
}

export type TikTokCommentMutation = {
  postId: string;
  commentId: string;
  contactId: string;
  action: "like" | "hide" | "delete" | "pin";
};

const actions = {
  like: { control: '[data-e2e="comment-like"]', state: "aria-pressed" },
  hide: { control: '[data-e2e="comment-hide"]', state: "data-comment-hidden" },
  delete: { control: '[data-e2e="comment-delete"]', state: "data-comment-deleted" },
  pin: { control: '[data-e2e="comment-pin"]', state: "data-comment-pinned" },
} as const;

function mutationDom(owner: string, input: TikTokCommentMutation, peer: string) {
  const { control, state } = actions[input.action];
  return String.raw`
    ${commentsDom(owner)}
    const matches = rows.filter(row => row.getAttribute('data-comment-id') === ${JSON.stringify(input.commentId)});
    const target = matches.length === 1 ? matches[0] : null;
    if (target && (postMatches(target) !== ${JSON.stringify(input.postId)} || peer(target) !== ${JSON.stringify(peer)})) return;
    const control = target && one(${JSON.stringify(control)}, target);
    const applied = ${input.action === "like" ? "control" : "target"}?.getAttribute(${JSON.stringify(state)}) === 'true';
  `;
}

/** A mutation asks the Host for authority immediately before any committing click. */
export async function tiktokManageComment(
  ctx: BrowserRecipeContext,
  input: TikTokCommentMutation,
  authorize = ctx.beforeSubmit,
): Promise<SocialSendResult> {
  const owner = requireTikTokBrowser(ctx);
  const peer = TIKTOK_CONTACT.exec(input.contactId)?.[1];
  if (
    !authorize ||
    !peer ||
    !TIKTOK_ID.test(input.postId) ||
    !TIKTOK_ID.test(input.commentId) ||
    !Object.hasOwn(actions, input.action)
  )
    throw denied();
  const dom = mutationDom(owner, input, peer);
  const candidate = `(() => { ${dom} if (!target) return; return applied ? 'applied' : mark(control, 'comment-action') ? 'ready' : undefined; })()`;
  const receipt = { platformId: input.commentId };
  await ctx.page.goto(COMMENTS_URL);
  await guardTikTokEngagement(ctx);
  const status = await readTikTokSurface<"ready" | "applied">(ctx, candidate);
  if (status === "applied") return receipt;
  await authorize();
  await guardTikTokEngagement(ctx);
  if ((await ctx.page.evaluate<string | undefined>(candidate)) !== "ready") throw denied();
  try {
    ctx.markSubmitted?.();
    await ctx.page.click(tiktokEngagementControl("comment-action"));
    if (input.action === "delete") {
      await guardTikTokEngagement(ctx);
      const confirmation = String.raw`(() => {
        ${dom}
        const dialogs = all('[role="dialog"][data-e2e="comment-delete-dialog"]');
        if (!dialogs.length) return false;
        if (dialogs.length !== 1) return;
        const dialog = dialogs[0];
        if (!target || dialog.getAttribute('data-comment-id') !== ${JSON.stringify(input.commentId)}) return;
        return mark(one('[data-e2e="comment-delete-confirm"]', dialog), 'comment-confirm') || undefined;
      })()`;
      const confirm = await ctx.page.evaluate<boolean | undefined>(confirmation);
      if (confirm === undefined) throw unknown();
      if (confirm) {
        await authorize();
        await guardTikTokEngagement(ctx);
        if (!(await ctx.page.evaluate<boolean>(confirmation))) throw unknown();
        await ctx.page.click(tiktokEngagementControl("comment-confirm"));
      }
    }
    const evidence = String.raw`(() => {
      ${dom}
      return applied || (${input.action === "delete"} && matches.length === 0 &&
        !!one('[data-comment-deleted-id="${input.commentId}"]', list));
    })()`;
    await readTikTokSurface<boolean>(ctx, evidence);
    if (input.action !== "delete") {
      await ctx.page.goto(COMMENTS_URL);
      await readTikTokSurface<boolean>(ctx, evidence);
    }
    return receipt;
  } catch {
    throw unknown();
  }
}
