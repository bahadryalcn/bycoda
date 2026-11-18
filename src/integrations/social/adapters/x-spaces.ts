import type { SocialAccount, SocialHttp } from "../adapter";
import { xGet, xPostId } from "./x";

type XSpace = {
  id: string;
  url: string;
  title?: string;
  state?: string;
  scheduledStart?: string;
  startedAt?: string;
  endedAt?: string;
  participantCount?: number;
};

const optionalText = (value: unknown) => (typeof value === "string" ? value : undefined);

/** Returns only Spaces from X's creator-scoped lookup. X controls which states it retains. */
export async function xListOwnSpaces(
  http: SocialHttp,
  account: SocialAccount,
  token: string,
): Promise<{ spaces: XSpace[]; partial: boolean }> {
  const creatorId = xPostId(account.platformId);
  const url = new URL("https://api.x.com/2/spaces/by/creator_ids");
  url.searchParams.set("user_ids", creatorId);
  url.searchParams.set(
    "space.fields",
    "title,state,scheduled_start,started_at,ended_at,participant_count",
  );
  const { value } = await xGet(http, account, url.toString(), token);
  const spaces: XSpace[] = [];
  for (const space of value.data ?? []) {
    if (
      typeof space.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(space.id) ||
      (space.creator_id !== undefined && space.creator_id !== creatorId)
    )
      continue;
    spaces.push({
      id: space.id,
      url: `https://x.com/i/spaces/${space.id}`,
      title: optionalText(space.title),
      state: optionalText(space.state),
      scheduledStart: optionalText(space.scheduled_start),
      startedAt: optionalText(space.started_at),
      endedAt: optionalText(space.ended_at),
      participantCount:
        Number.isSafeInteger(space.participant_count) && space.participant_count >= 0
          ? space.participant_count
          : undefined,
    });
  }
  return {
    spaces,
    partial: Boolean(value.errors?.length) || spaces.length !== (value.data?.length ?? 0),
  };
}
