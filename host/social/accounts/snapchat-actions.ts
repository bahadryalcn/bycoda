import { randomUUID } from "node:crypto";
import type { SocialAccount, SocialContact, SocialOperation } from "../../../src/features/social/model/social";
import { SocialHttp, SocialPlatformError } from "../../../src/integrations/social/adapter";
import { deleteSnapchatContent, listSnapchatContent, snapchatProfileUrl, snapchatSnapId, snapchatUuid } from "../../../src/integrations/social/snapchat-content";
import { getSnapchatEarnings, getSnapchatInsights } from "../../../src/integrations/social/snapchat-insights";
import type { SocialActionContext, SocialActionModule } from "../core/social-actions";
import { exact, hash, str } from "../core/social-helpers";
import { parseSnapchatProfilePatch } from "../social-browser-snapchat-profile";

async function account(ctx: SocialActionContext, input: Record<string, unknown>, permission: "read" | "draft" | "publish" = "read") {
  const result = await ctx.service.access(ctx.principal, str(input.accountId, "Snapchat account", 200), permission);
  if (result.platform !== "snapchat")
    throw new SocialPlatformError("unsupported");
  return result;
}

async function api(ctx: SocialActionContext, input: Record<string, unknown>, operation: SocialOperation) {
  const selected = await account(ctx, input, operation === "delete" ? "publish" : "read");
  if (selected.connection === "browser" || selected.accountType !== "public_profile")
    throw new SocialPlatformError("unsupported");
  if (selected.executorId !== ctx.environmentId) throw new SocialPlatformError("denied");
  ctx.service.capability(selected, operation);
  const credential = await ctx.service.credentialFor(selected.id);
  if (!credential?.accessToken) throw new SocialPlatformError("expired");
  const current = await account(ctx, input, operation === "delete" ? "publish" : "read");
  if (identity(selected) !== identity(current)) throw new SocialPlatformError("denied");
  ctx.service.capability(current, operation);
  return { selected: current, accessToken: credential.accessToken, profileId: current.platformId, now: ctx.now };
}

function identity(selected: SocialAccount) {
  return JSON.stringify([selected.id, selected.platformId, selected.connection, selected.executorId]);
}

async function profile(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["accountId"]);
  const selected = await account(ctx, input);
  if (selected.connection === "browser") {
    if (!ctx.service.snapchatBrowserProfile) throw new SocialPlatformError("unsupported");
    return await ctx.service.snapchatBrowserProfile(ctx.principal, selected.id, "read", {});
  }
  const scoped = await api(ctx, input, "profile.read");
  const { value } = await new SocialHttp().request(
    snapchatProfileUrl(scoped.profileId),
    scoped.accessToken,
  );
  if (value.error_code === "AUTHORIZATION_PERMISSION_DENIED") throw new SocialPlatformError("denied");
  const row = Array.isArray(value.public_profiles) && value.public_profiles.length === 1
    ? value.public_profiles[0]
    : undefined;
  const data = row?.public_profile;
  if (value.request_status !== "SUCCESS" || row?.sub_request_status !== "SUCCESS" || typeof data?.id !== "string" ||
    data.id.toLowerCase() !== scoped.profileId.toLowerCase())
    throw new SocialPlatformError("unknown");
  const rawAvatar = data.logo_urls?.manage_profile_logo_url ?? data.logo_urls?.original_logo_url;
  const avatar = typeof rawAvatar === "string" ? URL.parse(rawAvatar) : null;
  return {
    profileId: scoped.profileId,
    hasPublicProfile: true,
    name: typeof data.display_name === "string" ? data.display_name : undefined,
    bio: typeof data.description === "string" ? data.description : undefined,
    avatarUrl: avatar?.protocol === "https:" && !avatar.username && !avatar.password &&
      avatar.hostname.endsWith(".sc-cdn.net") ? avatar.href : undefined,
    category: typeof data.category === "string" ? data.category : undefined,
    username: typeof data.snap_user_name === "string" ? data.snap_user_name : undefined,
    subscribers: Number.isSafeInteger(data.subscriber_count) ? data.subscriber_count as number : undefined,
  };
}

const contentFields = ["target", "id", "cursor", "limit", "createdAt", "endedAt"];
const periodFields = ["startDate", "endDate", "cursor", "limit"];
const insightsFields = [...periodFields, "assetType", "assetId", "granularity", "fields", "breakdownDimensions", "snapParent"];

function query<T>(input: Record<string, unknown>, fields: string[]): T {
  exact(input, ["accountId", ...fields]);
  const { accountId: _accountId, ...params } = input;
  return params as T;
}

function deleteInput(input: Record<string, unknown>) {
  exact(input, ["accountId", "target", "id", "confirmId"]);
  const id = str(input.id, "Snapchat content ID", 200);
  const { target } = input;
  if (input.confirmId !== id ||
    !((target === "spotlight" && snapchatSnapId.test(id)) ||
      ((target === "saved_story" || target === "story") && snapchatUuid.test(id))))
    throw new Error("Confirm the exact Snapchat publication ID.");
  return { target, id, confirmId: id } as const;
}

type Review = {
  id: string;
  accountId: string;
  identity: string;
  action: "delete" | "profile.update" | "profile.create";
  input: Record<string, unknown>;
  status: "pending" | "review";
};

const reviewKey = (id: string) => `snapchat:review:${id}`;
async function reviews(ctx: SocialActionContext, id: string): Promise<Review[]> {
  const raw = await ctx.service.setting(reviewKey(id));
  return raw ? (JSON.parse(raw) as Review[]) : [];
}

async function requestReview(ctx: SocialActionContext, input: Record<string, unknown>, action: Review["action"]) {
  const selected = await account(ctx, input, action === "delete" ? "publish" : "draft");
  let payload: Record<string, unknown> = {};
  if (action === "delete") {
    payload = deleteInput(input);
    if (selected.accountType !== "public_profile" ||
      (selected.connection === "browser") !== (payload.target === "story"))
      throw new SocialPlatformError("unsupported");
    if (payload.target !== "story") ctx.service.capability(selected, "delete");
  } else {
    exact(input, ["accountId", "patch"]);
    const creating = action === "profile.create";
    if (selected.connection !== "browser" || selected.accountType !== (creating ? "member" : "public_profile"))
      throw new SocialPlatformError("unsupported");
    const patch = parseSnapchatProfilePatch(input.patch);
    if (creating && !patch.name) throw new Error("Enter the Snapchat Public Profile name.");
    payload = { patch };
  }
  return await ctx.store.transaction(async () => {
    const existing = await reviews(ctx, selected.id);
    const same = existing.find((item) => item.identity === identity(selected) && item.action === action && JSON.stringify(item.input) === JSON.stringify(payload));
    if (same) return { id: same.id, accountId: selected.id, status: same.status };
    if (existing.length >= 20) throw new Error("Review pending Snapchat requests in Accounts.");
    const review: Review = { id: randomUUID(), accountId: selected.id, identity: identity(selected), action, input: payload, status: "pending" };
    await ctx.service.setSetting(reviewKey(selected.id), JSON.stringify([...existing, review]));
    return { id: review.id, accountId: selected.id, status: review.status };
  });
}

async function removeContent(ctx: SocialActionContext, input: Record<string, unknown>) {
  const deletion = deleteInput(input);
  const selected = await account(ctx, input, "publish");
  const browser = deletion.target === "story";
  const profileAction = ctx.service.snapchatBrowserProfile;
  if (selected.accountType !== "public_profile" || (selected.connection === "browser") !== browser ||
    (browser && !profileAction))
    throw new SocialPlatformError("unsupported");
  if (selected.paused || selected.executorId !== ctx.environmentId)
    throw new SocialPlatformError("denied");
  const assetId = deletion.target === "spotlight" ? deletion.id : deletion.id.toLowerCase();
  const key = `snapchat:delete:${hash(JSON.stringify([selected.platformId, deletion.target, assetId]))}`;
  const prior = await ctx.service.setting(key);
  if (prior === "succeeded") return { target: deletion.target, id: deletion.id };
  if (prior === "submitted") throw new SocialPlatformError("unknown");
  let submitted = false;
  const beforeSubmit = async () => {
    const current = await account(ctx, input, "publish");
    if (current.paused || identity(current) !== identity(selected)) throw new SocialPlatformError("denied");
    if (!browser) ctx.service.capability(current, "delete");
    await ctx.store.transaction(async () => {
      const state = await ctx.service.setting(key);
      if (state && state !== "refused") throw new SocialPlatformError("unknown");
      await ctx.service.setSetting(key, "submitted");
      submitted = true;
    });
  };
  try {
    if (deletion.target === "story") {
      await beforeSubmit();
      await profileAction!(ctx.principal, selected.id, "delete-story", {
        storyId: deletion.id, confirm: "DELETE_SNAPCHAT_STORY",
      });
    } else {
      const { selected: current, accessToken } = await api(ctx, input, "delete");
      if (identity(current) !== identity(selected)) throw new SocialPlatformError("denied");
      await deleteSnapchatContent(new SocialHttp(), current, accessToken, { ...deletion, target: deletion.target }, beforeSubmit);
    }
  } catch (error) {
    if (submitted && error instanceof SocialPlatformError &&
      ["unsupported", "denied", "expired", "rate_limit"].includes(error.code))
      await ctx.service.setSetting(key, "refused");
    throw error;
  }
  await ctx.service.setSetting(key, "succeeded");
  return { target: deletion.target, id: deletion.id };
}

export const snapchatActions: SocialActionModule = {
  "snapchat.profile.read": { readOnly: true, ownerOnly: false, tool: true, run: profile },
  "snapchat.content.list": {
    readOnly: true, ownerOnly: false, tool: true,
    run: async (ctx, input) => {
      const params = query<Parameters<typeof listSnapchatContent>[3]>(input, contentFields);
      const scoped = await api(ctx, input, "profile.read");
      return await listSnapchatContent(new SocialHttp(), scoped.selected, scoped.accessToken, params);
    },
  },
  "snapchat.analytics.get": {
    readOnly: true, ownerOnly: false, tool: true,
    run: async (ctx, input) => {
      const params = query<Parameters<typeof getSnapchatInsights>[1]>(input, insightsFields);
      return await getSnapchatInsights(await api(ctx, input, "analytics"), params);
    },
  },
  "snapchat.earnings.get": {
    readOnly: true, ownerOnly: false, tool: true,
    run: async (ctx, input) => {
      const params = query<Parameters<typeof getSnapchatEarnings>[1]>(input, periodFields);
      return await getSnapchatEarnings(await api(ctx, input, "analytics"), params);
    },
  },
  "snapchat.monetization.get": {
    readOnly: true, ownerOnly: false, tool: true,
    run: async (ctx, input) => {
      exact(input, ["accountId"]);
      const selected = await account(ctx, input);
      if (selected.connection !== "browser" || !ctx.service.snapchatBrowserProfile)
        return { status: "unavailable" };
      return await ctx.service.snapchatBrowserProfile(ctx.principal, selected.id, "monetization", {});
    },
  },
  "snapchat.signup.request": {
    readOnly: false, ownerOnly: false, tool: true,
    run: async (ctx, input) => {
      exact(input, ["projectId", "reason", "suggestedName", "suggestedUsername"]);
      return await ctx.service.call(ctx.principal, "accounts.request", {
        ...input, platform: "snapchat", accountType: "member",
      });
    },
  },
  "snapchat.chat.draft": {
    readOnly: false, ownerOnly: false, tool: true,
    run: async (ctx, input) => {
      exact(input, ["accountId", "projectId", "username", "text"]);
      const selected = await account(ctx, input, "draft");
      if (selected.connection !== "browser" || selected.accountType !== "member")
        throw new SocialPlatformError("unsupported");
      ctx.service.capability(selected, "message.start");
      const projectId = str(input.projectId ?? ctx.principal.projectId, "project", 200);
      await ctx.service.project(ctx.principal, projectId);
      const username = str(input.username, "Snapchat username", 32).replace(/^@/, "").toLowerCase();
      if (!/^[a-z][\w.-]{1,30}$/.test(username)) throw new Error("Enter an exact Snapchat username.");
      const platformId = `web:snapchat:${username}`;
      const text = str(input.text, "message text");
      return await ctx.store.transaction(async () => {
        const contacts = await ctx.service.call(ctx.principal, "contacts.search", { query: platformId }) as SocialContact[];
        const matches = contacts.filter((contact) => contact.accountId === selected.id && contact.platformId === platformId);
        if (matches.length > 1) throw new SocialPlatformError("denied");
        const contact = matches[0] ?? await ctx.service.upsertContact(ctx.principal, {
          accountId: selected.id, platformId, name: username, projectIds: [projectId],
        });
        return await ctx.service.createDraft(ctx.principal, "messages.draft", {
          accountId: selected.id, projectId, contactId: contact.id, text,
        });
      });
    },
  },
  "snapchat.profile.update.request": { readOnly: false, ownerOnly: false, tool: true, run: (ctx, input) => requestReview(ctx, input, "profile.update") },
  "snapchat.profile.create.request": { readOnly: false, ownerOnly: false, tool: true, run: (ctx, input) => requestReview(ctx, input, "profile.create") },
  "snapchat.content.delete.request": { readOnly: false, ownerOnly: false, tool: true, run: (ctx, input) => requestReview(ctx, input, "delete") },
  "snapchat.content.delete": { readOnly: false, ownerOnly: true, run: removeContent },
  "snapchat.review.list": {
    readOnly: true, ownerOnly: true,
    run: async (ctx, input) => {
      exact(input, ["accountId"]);
      return await reviews(ctx, (await account(ctx, input)).id);
    },
  },
  "snapchat.review.decide": {
    readOnly: false, ownerOnly: true,
    run: async (ctx, input) => {
      exact(input, ["accountId", "id", "approve"]);
      if (typeof input.approve !== "boolean") throw new Error("Choose whether to approve the review.");
      const selected = await account(ctx, input);
      const key = reviewKey(selected.id);
      const request = await ctx.store.transaction(async () => {
        const items = await reviews(ctx, selected.id);
        const target = items.find((item) => item.id === input.id);
        if (!target) throw new SocialPlatformError("denied");
        if (input.approve && (target.status !== "pending" || target.identity !== identity(selected)))
          throw new SocialPlatformError("denied");
        await ctx.service.setSetting(key, JSON.stringify(input.approve
          ? items.map((item) => item.id === target.id ? { ...item, status: "review" } : item)
          : items.filter((item) => item.id !== target.id)));
        return target;
      });
      if (!input.approve) return { status: "dismissed" };
      if (request.action === "delete")
        await removeContent(ctx, { ...request.input, accountId: selected.id });
      else {
        if (!ctx.service.snapchatBrowserProfile) throw new SocialPlatformError("unsupported");
        const action = request.action === "profile.create" ? "create" : "update";
        await ctx.service.snapchatBrowserProfile(ctx.principal, selected.id, action, {
          ...request.input,
          confirm: action === "create" ? "CREATE_SNAPCHAT_PROFILE" : "UPDATE_SNAPCHAT_PROFILE",
        });
      }
      await ctx.store.transaction(async () => {
        const items = await reviews(ctx, selected.id);
        await ctx.service.setSetting(key, JSON.stringify(items.filter((item) => item.id !== request.id)));
      });
      return { status: "completed" };
    },
  },
};
