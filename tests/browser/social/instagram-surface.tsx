import { useState } from "react";
import type {
  Capability,
  SocialAccount,
  SocialThread,
} from "../../../src/features/social/model/social";
import type { SocialClient } from "../../../src/features/social/model/socialClient";
import { InstagramAccountTools } from "../../../src/features/social/ui/accounts/platform/InstagramAccountTools";
import type { PlatformDraft } from "../../../src/features/social/ui/content/contentDraft";
import { MetaFields } from "../../../src/features/social/ui/content/platform-fields/MetaFields";
import { InstagramCommentActions } from "../../../src/features/social/ui/inbox/InstagramCommentActions";
import { ReplyBox } from "../../../src/features/social/ui/inbox/ReplyBox";
import { useLocale } from "../../../src/shared/i18n";

const account = {
  id: "fixture-instagram",
  platform: "instagram",
  platformId: "101",
  name: "Studio Instagram",
  accountType: "professional",
  instagramAccountType: "BUSINESS",
  connection: "oauth",
  connected: true,
  accessApproved: true,
  grants: { demo: ["read", "draft", "message", "reply", "publish"] },
} as SocialAccount;
const capabilities = ["analytics", "webhook", "message.start"].map(
  (operation) => ({ operation, status: "available" }) as Capability,
);
const comment: SocialThread = {
  id: "comment",
  accountId: account.id,
  platformThreadId: "102",
  platformPostId: "103",
  kind: "comment",
  projectId: "demo",
  contactId: "104",
  lastInboundAt: 1,
  events: [
    {
      id: "105",
      platformId: "102",
      text: "When is the next live stream?",
      at: 1,
      direction: "inbound",
    },
  ],
};
const dm: SocialThread = { ...comment, id: "dm", kind: "message" };
const client = {
  async request(action: string, input?: Record<string, unknown>) {
    if (action === "inbox.replyOptions")
      return {
        canReply: true,
        instagram:
          input?.threadId === "dm"
            ? { attachment: true, localAttachment: true }
            : { privateReply: true },
      };
    if (action === "instagram.comments.requests.list")
      return {
        requests: [
          {
            id: "fixture-moderation-request",
            accountId: account.id,
            platformAccountId: account.platformId,
            projectId: comment.projectId,
            threadId: comment.id,
            eventId: comment.events[0].id,
            commentId: comment.events[0].platformId,
            commentText: comment.events[0].text,
            commentDigest: "synthetic-review-digest",
            action: "hide",
            status: "pending",
            createdAt: Date.UTC(2026, 10, 16),
          },
        ],
      };
    if (action === "instagram.insights")
      return {
        metrics: {
          views: { value: 3240 },
          reach: { value: 1600 },
          accounts_engaged: { value: 72 },
        },
        unavailable: ["profile_links_taps"],
      };
    if (action === "instagram.mentions")
      return {
        mentions: [{ mediaId: "12345", at: Date.UTC(2026, 10, 16) }],
        coverage: "webhook_only",
      };
    throw new Error(`Unexpected fixture action ${action}`);
  },
  async snapshot() {
    return { accounts: [account], profiles: [] };
  },
  async browserProfileRead() {
    return {
      name: "Studio Creators",
      username: "studio.creators",
      website: "https://example.com",
      bio: "Stories from the studio.",
      location: "",
    };
  },
  async browserInstagramEarnings() {
    return {
      values: [
        { kind: "estimated", amount: "€321.40" },
        { kind: "pending", amount: "€174.20" },
      ],
      observedAt: Date.UTC(2026, 10, 16),
    };
  },
  async browserInstagramHighlights() {
    return { items: [{ id: "321", name: "Studio Stories" }], partial: true };
  },
  async browserInstagramLive() {
    return { state: "awaiting_stream", windowOpen: true, credentialsStored: true, canStart: false };
  },
} as unknown as SocialClient;

export function InstagramSurface({ surface }: { surface: string }) {
  useLocale();
  const [value, setValue] = useState<PlatformDraft>({
    instagram: { ...(surface === "story" ? { format: "story" } : {}), isAiGenerated: true },
  });
  return (
    <main className="bycoda-arc p-4" data-instagram-surface={surface}>
      {surface === "story" || surface === "publishing" ? (
        <MetaFields
          account={account}
          disabled={false}
          value={value}
          onChange={setValue}
          media={[
            {
              localId: "example",
              name: "Studio portrait",
              media: { kind: "image", url: "https://example.com/studio.jpg" },
            },
          ]}
        />
      ) : surface === "inbox" ? (
        <>
          <InstagramCommentActions client={client} account={account} thread={comment} />
          <ReplyBox client={client} thread={comment} />
          <ReplyBox client={client} thread={dm} />
        </>
      ) : (
        <InstagramAccountTools
          client={client}
          account={surface === "browser" ? { ...account, connection: "browser" } : account}
          capabilities={
            surface === "browser"
              ? capabilities.filter((item) => item.operation === "message.start")
              : capabilities
          }
          disabled={false}
          projects={[{ id: "demo", name: "Demo", cwd: "/demo" }]}
        />
      )}
    </main>
  );
}
