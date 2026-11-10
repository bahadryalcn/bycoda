import { z } from "zod";
import type { AssistantPrWatch, PrWatch } from "../work/assistant-pr-watch";

const repo = z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/);
const schemas = {
  "pullRequests.assistantWatch": z.strictObject({
    number: z.number().int().min(1).max(999999999),
    repo: repo.optional(),
  }),
  "pullRequests.assistantUnwatch": z.strictObject({ id: z.string().min(1).max(64) }),
  "pullRequests.assistantWatches": z.strictObject({}),
};
export type RoomPrWatchAction = keyof typeof schemas;
export const isRoomPrWatchAction = (action: string): action is RoomPrWatchAction =>
  Object.hasOwn(schemas, action);

const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const ROOM_PR_WATCH_TOOLS = {
  "pullRequests.assistantWatch": object(
    {
      number: { type: "integer", minimum: 1, maximum: 999999999 },
      repo: { type: "string", pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", maxLength: 201 },
    },
    ["number"],
  ),
  "pullRequests.assistantUnwatch": object({ id: { type: "string", minLength: 1, maxLength: 64 } }, [
    "id",
  ]),
  "pullRequests.assistantWatches": object({}, []),
} as const;
export function describeRoomPrWatchTool(action: string) {
  if (action === "pullRequests.assistantWatch")
    return "Room only: watch a GitHub pull request of the target project on this Host, with no coding session needed. Pass number; repo (owner/name) defaults to the project's GitHub remote. The Host checks about every 3 minutes and notifies the owner when it is merged or closed, checks fail or pass, or a review arrives, even with the desktop closed. Read-only: never comments, merges or pushes. Watching the same PR again returns the existing watch; at most 30; stops after 14 days.";
  if (action === "pullRequests.assistantUnwatch")
    return "Room only: stop one Host-level pull request watch by id from pullRequests.assistantWatches.";
  if (action === "pullRequests.assistantWatches")
    return "Room only: list this project's Host-level pull request watches with last observed state, checks and any reason a watch became unavailable.";
  return undefined;
}

const view = (watch: PrWatch) => ({
  id: watch.id,
  repo: watch.repo,
  number: watch.number,
  title: watch.title,
  state: watch.unavailable ? "unavailable" : watch.lastState.state.toLowerCase(),
  checks: watch.lastState.checks,
  reviewDecision: watch.lastState.reviewDecision,
  lastCheckedAt: watch.lastCheckedAt,
  ...(watch.unavailable ? { reason: watch.unavailable } : {}),
});

/** Low-risk bounded writes: no native approval, scoped to the Room thread's project. */
export async function callRoomPrWatch(
  watches: Pick<AssistantPrWatch, "watch" | "unwatch" | "list">,
  call: { action: string; input: Record<string, unknown>; threadId: string; projectId?: string },
  authorized: () => Promise<boolean>,
) {
  const { action, input } = call;
  const scope = { threadId: call.threadId, projectId: call.projectId ?? "" };
  if (!scope.projectId) throw new Error("Choose a visible project for pull request watches.");
  if (!isRoomPrWatchAction(action)) throw new Error("Unsupported pull request tool.");
  const check = async () => {
    if (!(await authorized())) throw new Error("Room authority revoked.");
  };
  const parsed = schemas[action].parse(input) as { number?: number; repo?: string; id?: string };
  await check();
  if (action === "pullRequests.assistantWatches")
    return { watches: (await watches.list(scope.projectId)).map(view) };
  if (action === "pullRequests.assistantUnwatch")
    return { removed: await watches.unwatch(parsed.id!, scope.projectId) };
  const result = await watches.watch({ ...scope, number: parsed.number!, repo: parsed.repo });
  await check();
  return { existing: result.existing, watch: view(result.watch) };
}
