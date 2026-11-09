import type { SocialAccount, SocialMonitorChannel } from "../../src/features/social/model/social";
import { SocialPlatformError, type SocialInbound } from "../../src/integrations/social/adapter";
import { parseXBrowserInbox, parseXBrowserMentions } from "./social-browser-inbound";
import { challengeError } from "./browser/challenge";
import type { XBrowserDeps } from "./social-browser-x-page";

/**
 * Monitoring for X browser accounts: mentions, direct messages and reply comments. Channels follow
 * the recipe, not stored API scopes, so an older browser account still reads its messages.
 */
export async function pollX(
  deps: XBrowserDeps,
  account: SocialAccount,
  posts: string[],
  cursor?: string,
) {
  if (!deps.launcher) throw new SocialPlatformError("unsupported");
  const session = await deps.readSession(account.id);
  let success = false;
  const events: SocialInbound[] = [];
  const coverage: SocialMonitorChannel[] = [];
  try {
    await deps.identity(session.page, account);
    const channels = [
      {
        name: "mentions" as const,
        url: "https://x.com/notifications/mentions",
        path: /\/(NotificationsTimeline(?:Mentions)?|MentionsTimeline|mentions\.json)$/,
        parse: (body: string) => parseXBrowserMentions(body, account.platformId, posts, deps.now()),
      },
      {
        name: "messages" as const,
        url: "https://x.com/messages",
        path: /\/(inbox_initial_state|inbox_timeline|inbox_updates)\.json$/,
        parse: (body: string) => parseXBrowserInbox(body, account.platformId, deps.now()),
      },
    ];
    let supported = 0;
    for (const channel of channels) {
      const result: SocialMonitorChannel = {
        channel: channel.name,
        status: "unavailable",
        reason: "response_unavailable",
      };
      coverage.push(result);
      const capture = session.page.watchResponse(channel.path);
      try {
        await session.page.goto(channel.url);
        if (channel.name === "messages") {
          const path = await session.page.evaluate<string>("location.pathname");
          if (path === "/i/chat" || path.startsWith("/i/chat/")) {
            await deps.identity(session.page, account);
            result.reason = path.startsWith("/i/chat/pin/")
              ? "chat_setup_required"
              : "encrypted_chat_unsupported";
            continue;
          }
        }
        const body = await capture.body(20_000);
        await deps.identity(session.page, account);
        if (!body) {
          // A visible captcha or verification page is NEEDS_HUMAN, not an empty channel.
          const challenge = await challengeError(session.page, deps.directory);
          if (challenge) throw challenge;
          // Positive, route-specific empty-state evidence; absence of a response alone is not success.
          if (
            channel.name === "mentions" &&
            (await session.page.evaluate<boolean>(`(() => {
            return location.origin === "https://x.com" &&
              location.pathname === "/notifications/mentions" &&
              !!document.querySelector('a[role="tab"][aria-selected="true"][href="/notifications/mentions"]') &&
              document.querySelector('[data-testid="emptyState"] [data-testid="empty_state_header_text"]')?.textContent?.trim() === "Nothing to see here — yet" &&
              document.querySelector('[data-testid="emptyState"] [data-testid="empty_state_body_text"]')?.textContent?.trim() === "When someone mentions you, you’ll find it here." &&
              !document.querySelector('article[data-testid="tweet"]');
          })()`))
          ) {
            supported++;
            result.status = "read";
            delete result.reason;
          }
          continue;
        }
        try {
          events.push(...channel.parse(body));
          supported++;
          result.status = "read";
          delete result.reason;
        } catch (error) {
          if (!(error instanceof SocialPlatformError) || error.code !== "unsupported") throw error;
        }
      } finally {
        capture.stop();
      }
    }
    const targets = [...new Set(posts.filter((id) => /^\d{1,25}$/.test(id)))];
    let nextCursor: string | undefined;
    if (targets.length) {
      const start = /^\d{1,9}$/.test(cursor ?? "") ? Number(cursor) % targets.length : 0;
      const count = Math.min(2, targets.length);
      const comments: SocialMonitorChannel = { channel: "comments", status: "read" };
      coverage.push(comments);
      // Rotate saved posts across ticks. Never walk an unbounded number of threads in one poll.
      for (let index = 0; index < count; index++) {
        const post = targets[(start + index) % targets.length];
        const capture = session.page.watchResponse(/\/TweetDetail$/);
        try {
          await session.page.goto(`https://x.com/i/status/${post}`);
          const body = await capture.body(15_000);
          await deps.identity(session.page, account);
          if (!body) {
            comments.status = "unavailable";
            comments.reason = "response_unavailable";
            continue;
          }
          try {
            events.push(...parseXBrowserMentions(body, account.platformId, [post], deps.now()));
            supported++;
          } catch (error) {
            if (!(error instanceof SocialPlatformError) || error.code !== "unsupported")
              throw error;
            comments.status = "unavailable";
            comments.reason = "response_unavailable";
          }
        } finally {
          capture.stop();
        }
      }
      nextCursor = String((start + count) % targets.length);
    }
    if (!supported) throw new SocialPlatformError("unsupported");
    success = true;
    return {
      events: [...new Map(events.map((event) => [event.eventId, event])).values()],
      coverage,
      ...(nextCursor !== undefined ? { cursor: nextCursor } : {}),
    };
  } finally {
    await deps.releaseRead(account.id, session, success);
  }
}
