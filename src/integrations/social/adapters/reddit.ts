import {
  SocialHttp,
  SocialPlatformError,
  type SocialAdapter,
  type SocialAccount,
  type SocialJob,
} from "../adapter";
import type { CaptureSource } from "../audience-types";
import { redditAudience } from "./reddit-audience";
import { redditInbox } from "./reddit-inbox";
import {
  redditCall,
  redditCreatedName,
  redditFullname,
  redditUsername,
  redditWriteErrors,
  reject,
} from "./reddit-api";
import {
  REDDIT_BODY_LIMIT,
  REDDIT_MESSAGE_SUBJECT_LIMIT,
  redditPayload,
  requireFlairIfNeeded,
  reserveContent,
  validateSubmission,
} from "./reddit-rules";

type BeforeSubmit = () => Promise<void>;

function assertText(body: string): void {
  if (!body.trim() || body.length > REDDIT_BODY_LIMIT) reject("reddit.body_length");
}

function assertNoMedia(job: SocialJob): void {
  if (job.payload.media.length > 0)
    throw new SocialPlatformError("unsupported", undefined, {
      reasonCode: "reddit.media_unsupported",
    });
}

/** Text and link post to exactly one subreddit. Flair and the one-subreddit rule are checked before the write. */
async function submitPost(
  http: SocialHttp,
  account: SocialAccount,
  job: SocialJob,
  token: string,
  beforeSubmit?: BeforeSubmit,
) {
  const submission = validateSubmission(job, redditPayload(job));
  await requireFlairIfNeeded(http, account, token, submission);
  await beforeSubmit?.();
  reserveContent(submission, Date.now());
  const { value } = await redditCall(http, account, token, "/api/submit", {
    form: {
      kind: submission.kind,
      sr: submission.subreddit,
      title: submission.title,
      ...(submission.kind === "self" ? { text: submission.text } : { url: submission.link ?? "" }),
      ...(submission.flairId ? { flair_id: submission.flairId } : {}),
    },
  });
  redditWriteErrors(value, Date.now());
  const data = value.json?.data;
  if (typeof data?.name !== "string" || !data.name.startsWith("t3_"))
    throw new SocialPlatformError("unknown");
  return {
    platformId: data.name as string,
    url: typeof data.url === "string" ? data.url : undefined,
  };
}

/** Private message to a username. Reddit returns no message id, so the job id stands in (shortcut). */
async function composeMessage(
  http: SocialHttp,
  account: SocialAccount,
  job: SocialJob,
  token: string,
  beforeSubmit?: BeforeSubmit,
) {
  assertNoMedia(job);
  const to = redditUsername(job.payload.recipientId);
  const subject = (redditPayload(job).subject ?? "Message").trim();
  if (!subject || subject.length > REDDIT_MESSAGE_SUBJECT_LIMIT) reject("reddit.subject_length");
  assertText(job.payload.text);
  await beforeSubmit?.();
  const { value } = await redditCall(http, account, token, "/api/compose", {
    form: { to, subject, text: job.payload.text },
  });
  redditWriteErrors(value, Date.now());
  return { platformId: job.id };
}

/** Comment on a post (kind comment) or reply to a comment or message (kind reply, or message with threadId). */
async function replyTo(
  http: SocialHttp,
  account: SocialAccount,
  job: SocialJob,
  token: string,
  beforeSubmit?: BeforeSubmit,
) {
  assertNoMedia(job);
  const parent =
    job.kind === "message"
      ? redditFullname(job.payload.threadId, ["t4"])
      : redditFullname(job.payload.postId, ["t1", "t3"]);
  assertText(job.payload.text);
  await beforeSubmit?.();
  const { value } = await redditCall(http, account, token, "/api/comment", {
    form: { parent, text: job.payload.text },
  });
  redditWriteErrors(value, Date.now());
  return { platformId: redditCreatedName(value, ["t1", "t4"]) };
}

/** Edits the account's own post or comment text. Not reachable until the adapter contract has an edit operation. */
export async function editRedditText(
  http: SocialHttp,
  account: SocialAccount,
  token: string,
  fullname: string,
  text: string,
): Promise<void> {
  const thing = redditFullname(fullname, ["t1", "t3"]);
  assertText(text);
  const { value } = await redditCall(http, account, token, "/api/editusertext", {
    form: { thing_id: thing, text },
  });
  redditWriteErrors(value, Date.now());
}

/** Reddit adapter. Operations not listed in capabilities/reddit.ts stay unsupported by the shared fallback. */
export function createRedditAdapter(http: SocialHttp = new SocialHttp()): SocialAdapter {
  return {
    send: (account, job, token, _media, _checkpoint, beforeSubmit) => {
      if (job.kind === "publish") return submitPost(http, account, job, token, beforeSubmit);
      if (job.kind === "message" && !job.payload.threadId)
        return composeMessage(http, account, job, token, beforeSubmit);
      return replyTo(http, account, job, token, beforeSubmit);
    },
    poll: async (account, token, _posts, cursor) => ({
      ...(await redditInbox(http, account, token, cursor)),
      coverage: [
        { channel: "messages", status: "read" },
        { channel: "mentions", status: "read" },
        { channel: "comments", status: "read" },
      ],
    }),
    async deletePost(account, token, platformId) {
      const thing = redditFullname(platformId, ["t1", "t3"]);
      const { value } = await redditCall(http, account, token, "/api/del", { form: { id: thing } });
      redditWriteErrors(value, Date.now());
    },
    collectAudience: (account, token, source: CaptureSource, cursor) =>
      redditAudience(http, account, token, source, cursor),
    async getProfile(account, token) {
      const { value } = await redditCall(http, account, token, "/api/v1/me");
      const name = redditUsername(value.name);
      return { name, username: name };
    },
    async healthCheck(account, token) {
      try {
        await redditCall(http, account, token, "/api/v1/me");
        return { ok: true };
      } catch (error) {
        return { ok: false, code: error instanceof SocialPlatformError ? error.code : "unknown" };
      }
    },
  };
}
