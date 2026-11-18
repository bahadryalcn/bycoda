import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  INSTAGRAM_MANAGEMENT_KINDS,
  type InstagramManagementKind,
  type InstagramManagementRequest,
} from "../../../src/features/social/model/instagramManagement";
import type { SocialPermission } from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type { SocialActionContext, SocialActionModule } from "../core/social-actions";
import { exact, str } from "../core/social-helpers";
import { instagramHandle } from "../social-browser-instagram-audience";
import { parseInstagramHighlightChange } from "../social-browser-instagram-highlights";
import { parseInstagramPostChange } from "../social-browser-instagram-posts";
import { parseInstagramProfilePatch } from "../social-browser-instagram-profile";

const MAX_REQUESTS = 32;

function key(accountId: string) {
  return `instagram.management.requests:${accountId}`;
}

function permission(kind: InstagramManagementKind): SocialPermission {
  if (kind.startsWith("post.")) return "publish";
  return kind === "dm.draft" ? "message" : "draft";
}

function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid Instagram request details.");
  return raw as Record<string, unknown>;
}

async function readRequests(ctx: SocialActionContext, accountId: string) {
  const raw = await ctx.service.setting(key(accountId));
  return (raw ? JSON.parse(raw) : []) as InstagramManagementRequest[];
}

/** The owner-facing parsers need their confirm tokens; the queue stores only the exact change. */
function normalize(kind: InstagramManagementKind, raw: unknown): Record<string, unknown> {
  const details = record(raw);
  switch (kind) {
    case "post.edit": {
      exact(details, ["postUrl", "caption"]);
      const change = parseInstagramPostChange({
        ...details,
        action: "caption",
        confirm: "EDIT_INSTAGRAM_CAPTION",
      });
      if (change.action !== "caption") throw new SocialPlatformError("rejected");
      return { postUrl: change.postUrl, caption: change.caption };
    }
    case "post.delete": {
      exact(details, ["postUrl"]);
      const change = parseInstagramPostChange({
        ...details,
        action: "delete",
        confirm: "DELETE_INSTAGRAM_POST",
      });
      return { postUrl: change.postUrl };
    }
    case "profile.update":
      exact(details, ["patch"]);
      return { patch: { ...parseInstagramProfilePatch(details.patch) } };
    case "highlight.create":
    case "highlight.edit":
    case "highlight.delete": {
      const action = kind.slice("highlight.".length);
      exact(
        details,
        action === "create"
          ? ["name", "storyIds"]
          : action === "edit"
            ? ["id", "expectedName", "name", "storyIds"]
            : ["id", "expectedName"],
      );
      const {
        confirm: _confirm,
        action: _action,
        ...change
      } = parseInstagramHighlightChange({
        ...details,
        action,
        confirm: `${action.toUpperCase()}_INSTAGRAM_HIGHLIGHT`,
      });
      return change;
    }
    case "dm.draft":
      exact(details, ["handle", "text"]);
      return { handle: instagramHandle(details.handle), text: str(details.text, "message", 1000) };
  }
}

async function account(
  ctx: SocialActionContext,
  accountId: unknown,
  kind: InstagramManagementKind,
) {
  const found = await ctx.service.access(
    ctx.principal,
    str(accountId, "account"),
    permission(kind),
  );
  if (
    found.platform !== "instagram" ||
    found.connection !== "browser" ||
    !found.connected ||
    !found.accessApproved ||
    found.paused
  )
    throw new SocialPlatformError("unsupported");
  return found;
}

export const instagramManagementRequests: SocialActionModule = {
  "instagram.management.request": {
    readOnly: false,
    ownerOnly: false,
    tool: true,
    async run(ctx, input) {
      exact(input, ["accountId", "kind", "details"]);
      const kind = INSTAGRAM_MANAGEMENT_KINDS.find((candidate) => candidate === input.kind);
      if (!kind) throw new Error("Invalid Instagram management request.");
      const target = await account(ctx, input.accountId, kind);
      const projectId = ctx.principal.projectId;
      if (projectId) await ctx.service.project(ctx.principal, projectId);
      if (ctx.principal.kind !== "owner" && (await ctx.service.setting("ai.stopped")) === "true")
        throw new Error("AI actions are stopped by the owner.");
      const details = normalize(kind, input.details);
      return ctx.store.transaction(async () => {
        const items = await readRequests(ctx, target.id);
        const existing = items.find(
          (item) =>
            item.platformAccountId === target.platformId &&
            item.projectId === projectId &&
            item.kind === kind &&
            isDeepStrictEqual(item.details, details),
        );
        if (existing) return existing;
        if (items.length >= MAX_REQUESTS)
          throw new Error("Review existing Instagram requests before adding more.");
        const item: InstagramManagementRequest = {
          id: randomUUID(),
          accountId: target.id,
          platformAccountId: target.platformId,
          projectId,
          kind,
          details,
          createdAt: ctx.now(),
        };
        await ctx.service.setSetting(key(target.id), JSON.stringify([item, ...items]));
        return item;
      });
    },
  },
  "instagram.management.list": {
    readOnly: true,
    ownerOnly: true,
    async run(ctx, input) {
      exact(input, ["accountId"]);
      const found = await ctx.service.access(
        ctx.principal,
        str(input.accountId, "account"),
        "read",
      );
      return {
        requests: (await readRequests(ctx, found.id)).filter(
          (item) => item.platformAccountId === found.platformId,
        ),
      };
    },
  },
  "instagram.management.dismiss": {
    readOnly: false,
    ownerOnly: true,
    async run(ctx, input) {
      exact(input, ["accountId", "id"]);
      const found = await ctx.service.access(
        ctx.principal,
        str(input.accountId, "account"),
        "read",
      );
      const id = str(input.id, "request");
      return ctx.store.transaction(async () => {
        const items = await readRequests(ctx, found.id);
        await ctx.service.setSetting(
          key(found.id),
          JSON.stringify(items.filter((item) => item.id !== id)),
        );
        return { accountId: found.id };
      });
    },
  },
  "instagram.earnings.read": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    async run(ctx, input) {
      exact(input, ["accountId"]);
      const found = await ctx.service.access(
        ctx.principal,
        str(input.accountId, "account"),
        "read",
      );
      if (found.platform !== "instagram" || found.connection !== "browser" || !found.connected)
        throw new SocialPlatformError("unsupported");
      if (!found.accessApproved || found.paused) throw new SocialPlatformError("denied");
      if (!ctx.instagramEarnings) throw new SocialPlatformError("unsupported");
      return await ctx.instagramEarnings(found.id);
    },
  },
};
