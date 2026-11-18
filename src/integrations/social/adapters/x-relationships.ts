import { SocialPlatformError, type SocialAccount, type SocialHttp } from "../adapter";
import { xCall } from "./x";
import { isXResourceId, xResourceId } from "./x-identifiers";

type ListFields = { name?: string; description?: string; private?: boolean };

export type XRelationshipAction =
  | { kind: "follow" | "mute" | "block"; userId: string; enabled: boolean }
  | { kind: "addListMember" | "removeListMember"; listId: string; userId: string }
  | ({ kind: "createList"; name: string } & ListFields)
  | ({ kind: "updateList"; listId: string } & ListFields)
  | { kind: "deleteList"; listId: string };

type XRelationshipResult =
  | { userId: string; enabled: boolean; pending?: true }
  | { listId: string; userId: string; member: boolean }
  | { listId: string; name: string }
  | { listId: string; updated: true }
  | { listId: string; deleted: true };

const BASE = "https://api.x.com/2";
const userActions = {
  follow: { collection: "following", result: "following" },
  mute: { collection: "muting", result: "muting" },
  block: { collection: "blocking", result: "blocking" },
} as const;

function writeJson(method: "POST" | "PUT", body: object): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function listFields({ name, description, private: isPrivate }: ListFields): ListFields {
  if (name !== undefined && (typeof name !== "string" || !name.trim() || [...name].length > 25))
    throw new SocialPlatformError("rejected");
  if (
    description !== undefined &&
    (typeof description !== "string" || [...description].length > 100)
  )
    throw new SocialPlatformError("rejected");
  if (isPrivate !== undefined && typeof isPrivate !== "boolean")
    throw new SocialPlatformError("rejected");
  return { name, description, private: isPrivate };
}

/** The caller owns approval and pacing. X restricts block and unblock to Enterprise. */
export async function runXRelationship(
  http: SocialHttp,
  account: SocialAccount,
  token: string,
  action: XRelationshipAction,
): Promise<XRelationshipResult> {
  switch (action.kind) {
    case "follow":
    case "mute":
    case "block": {
      const ownerId = xResourceId(account.platformId);
      const userId = xResourceId(action.userId);
      const { enabled } = action;
      if (userId === ownerId || typeof enabled !== "boolean")
        throw new SocialPlatformError("rejected");
      if (action.kind === "block" && account.xApiProduct !== "enterprise")
        throw new SocialPlatformError("unsupported");
      const { collection, result } = userActions[action.kind];
      const url = `${BASE}/users/${ownerId}/${collection}`;
      const { value } = enabled
        ? await xCall(http, account, url, token, writeJson("POST", { target_user_id: userId }))
        : await xCall(http, account, `${url}/${userId}`, token, { method: "DELETE" });
      if (
        action.kind === "follow" &&
        enabled &&
        value.data?.pending_follow === true &&
        value.data.following === false
      )
        return { userId, enabled: false, pending: true };
      if (value.data?.[result] !== enabled) throw new SocialPlatformError("unknown");
      return { userId, enabled };
    }
    case "addListMember":
    case "removeListMember": {
      const listId = xResourceId(action.listId);
      const userId = xResourceId(action.userId);
      const member = action.kind === "addListMember";
      const url = `${BASE}/lists/${listId}/members`;
      const { value } = member
        ? await xCall(http, account, url, token, writeJson("POST", { user_id: userId }))
        : await xCall(http, account, `${url}/${userId}`, token, { method: "DELETE" });
      if (value.data?.is_member !== member) throw new SocialPlatformError("unknown");
      return { listId, userId, member };
    }
    case "createList": {
      const fields = listFields(action);
      if (!fields.name) throw new SocialPlatformError("rejected");
      const { value } = await xCall(
        http,
        account,
        `${BASE}/lists`,
        token,
        writeJson("POST", fields),
      );
      if (!isXResourceId(value.data?.id) || typeof value.data.name !== "string")
        throw new SocialPlatformError("unknown");
      return { listId: value.data.id, name: value.data.name };
    }
    case "updateList": {
      const listId = xResourceId(action.listId);
      const fields = listFields(action);
      if (Object.values(fields).every((field) => field === undefined))
        throw new SocialPlatformError("rejected");
      const { value } = await xCall(
        http,
        account,
        `${BASE}/lists/${listId}`,
        token,
        writeJson("PUT", fields),
      );
      if (value.data?.updated !== true) throw new SocialPlatformError("unknown");
      return { listId, updated: true };
    }
    case "deleteList": {
      const listId = xResourceId(action.listId);
      const { value } = await xCall(http, account, `${BASE}/lists/${listId}`, token, {
        method: "DELETE",
      });
      if (value.data?.deleted !== true) throw new SocialPlatformError("unknown");
      return { listId, deleted: true };
    }
    default:
      throw new SocialPlatformError("rejected");
  }
}

type Page<T> = { items: T[]; next?: string };
type XList = {
  id: string;
  name: string;
  description?: string;
  private?: boolean;
  memberCount?: number;
};
type XListMember = { id: string; name: string; username: string };

function pageUrl(path: string, cursor?: string): URL {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("max_results", "25");
  if (cursor !== undefined) {
    if (typeof cursor !== "string" || !cursor || cursor.length > 512)
      throw new SocialPlatformError("rejected");
    url.searchParams.set("pagination_token", cursor);
  }
  return url;
}

function pageRows(value: Record<string, unknown>): Record<string, unknown>[] {
  const data = value.data;
  if (
    data === undefined &&
    (value.meta as { result_count?: unknown } | undefined)?.result_count === 0 &&
    !value.errors
  )
    return [];
  if (!Array.isArray(data) || data.some((row) => !row || typeof row !== "object"))
    throw new SocialPlatformError("unknown");
  return data;
}

function nextCursor(value: Record<string, unknown>): string | undefined {
  const next = (value.meta as { next_token?: unknown } | undefined)?.next_token;
  return typeof next === "string" && next.length > 0 && next.length <= 512 ? next : undefined;
}

export async function getXOwnedLists(
  http: SocialHttp,
  account: SocialAccount,
  token: string,
  cursor?: string,
): Promise<Page<XList>> {
  const url = pageUrl(`users/${xResourceId(account.platformId)}/owned_lists`, cursor);
  url.searchParams.set("list.fields", "description,private,member_count");
  const { value } = await xCall(http, account, url.toString(), token);
  const items = pageRows(value).map(
    ({ id, name, description, private: isPrivate, member_count }) => {
      if (!isXResourceId(id) || typeof name !== "string") throw new SocialPlatformError("unknown");
      return {
        id,
        name,
        description: typeof description === "string" ? description : undefined,
        private: typeof isPrivate === "boolean" ? isPrivate : undefined,
        memberCount: typeof member_count === "number" ? member_count : undefined,
      };
    },
  );
  return { items, next: nextCursor(value) };
}

export async function getXListMembers(
  http: SocialHttp,
  account: SocialAccount,
  token: string,
  listId: string,
  cursor?: string,
): Promise<Page<XListMember>> {
  const url = pageUrl(`lists/${xResourceId(listId)}/members`, cursor);
  const { value } = await xCall(http, account, url.toString(), token);
  const items = pageRows(value).map(({ id, name, username }) => {
    if (!isXResourceId(id) || typeof name !== "string" || typeof username !== "string")
      throw new SocialPlatformError("unknown");
    return { id, name, username };
  });
  return { items, next: nextCursor(value) };
}
