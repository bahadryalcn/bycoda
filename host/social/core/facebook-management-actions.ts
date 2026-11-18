import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  FACEBOOK_MANAGEMENT_ACTIONS,
  type FacebookManagementAction,
  type FacebookManagementRequest,
} from "../../../src/features/social/model/facebookManagement";
import type {
  SocialAccount,
  SocialPermission,
  SocialThread,
} from "../../../src/features/social/model/social";
import { parseFacebookPagePatch } from "../../../src/integrations/social/adapters/facebook-page-edit";
import { facebookLiveId } from "../../../src/integrations/social/adapters/facebook-live";
import { exact, str } from "./social-helpers";
import type { SocialActionContext, SocialActionModule } from "./social-actions";

const confirmations: Record<FacebookManagementAction, string> = {
  "facebook.page.update": "UPDATE_FACEBOOK_PAGE",
  "facebook.post.edit": "EDIT_FACEBOOK_POST",
  "facebook.post.delete": "DELETE_FACEBOOK_POST",
  "facebook.comment.moderate": "MODERATE_FACEBOOK_COMMENT",
  "facebook.live.create": "CREATE_FACEBOOK_LIVE",
  "facebook.live.start": "START_FACEBOOK_LIVE",
  "facebook.live.end": "END_FACEBOOK_LIVE",
};

function permission(operation: FacebookManagementAction): SocialPermission {
  if (operation === "facebook.page.update") return "draft";
  if (operation === "facebook.comment.moderate") return "comment";
  return "publish";
}

function accountKey(accountId: string) {
  return `facebook.management.requests:${accountId}`;
}

async function requests(ctx: SocialActionContext, accountId: string) {
  const raw = await ctx.service.setting(accountKey(accountId));
  return (raw ? JSON.parse(raw) : []) as FacebookManagementRequest[];
}

async function put(
  ctx: SocialActionContext,
  accountId: string,
  items: FacebookManagementRequest[],
) {
  await ctx.service.setSetting(accountKey(accountId), JSON.stringify(items));
}

function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid Facebook request.");
  return raw as Record<string, unknown>;
}

async function normalize(
  ctx: SocialActionContext,
  account: SocialAccount,
  projectId: string,
  operation: FacebookManagementAction,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const details = record(raw);
  switch (operation) {
    case "facebook.page.update":
      exact(details, ["patch"]);
      return { patch: parseFacebookPagePatch(details.patch) };
    case "facebook.post.edit":
    case "facebook.post.delete": {
      const edit = operation === "facebook.post.edit";
      exact(details, edit ? ["postId", "text"] : ["postId"]);
      const postId = str(details.postId, "Page post", 120);
      if (!/^\d+_\d+$/.test(postId) || !postId.startsWith(`${account.platformId}_`))
        throw new Error("Choose a post owned by this Facebook Page.");
      return { postId, ...(edit ? { text: str(details.text, "post text") } : {}) };
    }
    case "facebook.comment.moderate": {
      exact(details, ["threadId", "action"]);
      const threadId = str(details.threadId, "thread");
      const thread = (await ctx.service.call(ctx.principal, "thread.read", {
        id: threadId,
      })) as SocialThread;
      if (
        thread.kind !== "comment" ||
        thread.accountId !== account.id ||
        thread.projectId !== projectId
      )
        throw new Error("Choose a comment from this Page and project.");
      const action = str(details.action, "comment action", 10);
      if (!["hide", "unhide", "delete", "like", "unlike"].includes(action))
        throw new Error("Invalid comment action.");
      return { threadId, action };
    }
    case "facebook.live.create":
      exact(details, ["title", "description"]);
      return {
        title: str(details.title, "title", 254),
        ...(details.description === undefined
          ? {}
          : { description: str(details.description, "description", 8000) }),
      };
    case "facebook.live.start":
    case "facebook.live.end":
      exact(details, ["liveId"]);
      return { liveId: facebookLiveId(details.liveId) };
  }
}

async function authorize(
  ctx: SocialActionContext,
  accountId: string,
  projectId: string,
  operation: FacebookManagementAction,
) {
  await ctx.service.project(ctx.principal, projectId);
  const account = await ctx.service.access(ctx.principal, accountId, permission(operation));
  if (
    account.platform !== "facebook" ||
    account.accountType !== "page" ||
    account.connection === "browser" ||
    !account.connected ||
    !account.accessApproved ||
    account.executorId !== ctx.facebookLive?.environmentId ||
    !account.grants[projectId]?.includes(permission(operation))
  )
    throw new Error("This project cannot request this Facebook Page operation.");
  return account;
}

export const facebookManagementActions: SocialActionModule = {
  "facebook.management.request": {
    readOnly: false,
    ownerOnly: false,
    tool: true,
    async run(ctx, input) {
      exact(input, ["accountId", "projectId", "operation", "details"]);
      const operation = FACEBOOK_MANAGEMENT_ACTIONS.find((action) => action === input.operation);
      if (!operation) throw new Error("Invalid Facebook management operation.");
      const accountId = str(input.accountId, "account");
      const projectId = str(input.projectId ?? ctx.principal.projectId, "project");
      const account = await authorize(ctx, accountId, projectId, operation);
      const details = await normalize(ctx, account, projectId, operation, input.details);
      return ctx.store.transaction(async () => {
        const items = await requests(ctx, accountId);
        const pending = items.find(
          (item) =>
            item.status === "pending" &&
            item.pageId === account.platformId &&
            item.projectId === projectId &&
            item.operation === operation &&
            isDeepStrictEqual(item.details, details),
        );
        if (pending) return pending;
        if (items.length >= 32)
          throw new Error("Review existing Facebook requests before adding more.");
        const item: FacebookManagementRequest = {
          id: randomUUID(),
          accountId,
          pageId: account.platformId,
          projectId,
          operation,
          details,
          createdAt: ctx.now(),
          status: "pending",
        };
        await put(ctx, accountId, [item, ...items]);
        return item;
      });
    },
  },
  "facebook.management.list": {
    readOnly: true,
    ownerOnly: true,
    async run(ctx, input) {
      exact(input, ["accountId"]);
      const account = await ctx.service.access(
        ctx.principal,
        str(input.accountId, "account"),
        "read",
      );
      return {
        requests: (await requests(ctx, account.id)).filter(
          (item) => item.pageId === account.platformId,
        ),
      };
    },
  },
  "facebook.management.dismiss": {
    readOnly: false,
    ownerOnly: true,
    async run(ctx, input) {
      exact(input, ["accountId", "id"]);
      const account = await ctx.service.access(
        ctx.principal,
        str(input.accountId, "account"),
        "read",
      );
      const requestId = str(input.id, "request");
      return ctx.store.transaction(async () => {
        const items = await requests(ctx, account.id);
        await put(
          ctx,
          account.id,
          items.filter((item) => item.id !== requestId || item.status === "submitted"),
        );
        return { accountId: account.id };
      });
    },
  },
  "facebook.management.approve": {
    readOnly: false,
    ownerOnly: true,
    async run(ctx, input) {
      exact(input, ["accountId", "reviewed"]);
      const accountId = str(input.accountId, "account");
      const reviewed = record(input.reviewed);
      const item = await ctx.store.transaction(async () => {
        const items = await requests(ctx, accountId);
        const current = items.find((row) => row.id === reviewed.id);
        if (!current || current.status !== "pending" || !isDeepStrictEqual(current, reviewed))
          throw new Error("Review the current Facebook request before applying it.");
        const account = await authorize(ctx, accountId, current.projectId, current.operation);
        if (account.platformId !== current.pageId)
          throw new Error("Facebook Page identity changed.");
        await normalize(ctx, account, current.projectId, current.operation, current.details);
        await put(
          ctx,
          accountId,
          items.map((row) => (row.id === current.id ? { ...row, status: "submitted" } : row)),
        );
        return current;
      });
      let status: FacebookManagementRequest["status"] = "review";
      try {
        const result = await ctx.service.call(ctx.principal, item.operation, {
          ...(item.operation === "facebook.comment.moderate" ? {} : { accountId }),
          ...item.details,
          confirm: confirmations[item.operation],
        });
        if (
          !(
            result &&
            typeof result === "object" &&
            (("status" in result && result.status === "partial") ||
              ("phase" in result &&
                ["creating", "starting", "ending"].includes(String(result.phase))))
          )
        )
          status = "completed";
        return { ...item, status };
      } finally {
        await ctx.store.transaction(async () => {
          const items = await requests(ctx, accountId);
          await put(
            ctx,
            accountId,
            items.map((row) => (row.id === item.id ? { ...row, status } : row)),
          );
        });
      }
    },
  },
};
