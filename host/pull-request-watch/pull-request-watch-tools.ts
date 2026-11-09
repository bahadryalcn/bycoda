import type { RuntimeLogPrincipal } from "../execution/runtime-log-tools";
import { parsePullRequestUrl } from "./pull-request-model";
import type { PullRequestWatches } from "./pull-request-watch";

const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const PULL_REQUEST_WATCH_TOOLS = {
  "pullRequests.watch": object(
    {
      number: { type: "integer", minimum: 1, maximum: 999999999 },
      url: { type: "string", minLength: 1, maxLength: 500 },
    },
    [],
  ),
  "pullRequests.unwatch": object(
    { watchId: { type: "string", minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9-]+$" } },
    ["watchId"],
  ),
  "pullRequests.watches": object({}, []),
};
export type PullRequestWatchTool = keyof typeof PULL_REQUEST_WATCH_TOOLS;
export const isPullRequestWatchTool = (action: string): action is PullRequestWatchTool =>
  Object.hasOwn(PULL_REQUEST_WATCH_TOOLS, action);
export const describePullRequestWatchTool = (action: string): string | undefined => {
  if (action === "pullRequests.watch")
    return "Watch a GitHub pull request for this session. Pass url or number, or neither to watch the pull request for this session's branch. The Host checks the PR about once a minute; when checks finish, a review or comment arrives, a new commit's checks finish, or the PR is merged or closed, it sends a message into this session. End your turn after watching instead of polling. Watching the same PR again returns the existing watch; at most 10 per session. Needs a session hosted by this Host, not a desktop-only one.";
  if (action === "pullRequests.unwatch")
    return "Stop one of this session's pull request watches by watchId. Returns removed=false for an unknown id or another session's watch.";
  if (action === "pullRequests.watches")
    return "List this session's pull request watches with the last observed state, checks summary and any lastError from the last poll.";
  return undefined;
};

/** Validates the watch input; the schema above is advisory, this is the enforced check. */
export function parsePullRequestWatchInput(input: Record<string, unknown>): {
  number?: number;
  url?: string;
} {
  const parsed: { number?: number; url?: string } = {};
  if (input.number !== undefined) {
    if (
      typeof input.number !== "number" ||
      !Number.isSafeInteger(input.number) ||
      input.number < 1 ||
      input.number > 999999999
    )
      throw new Error("number must be a positive integer.");
    parsed.number = input.number;
  }
  if (input.url !== undefined) {
    if (typeof input.url !== "string" || !input.url || input.url.length > 500)
      throw new Error("url must be a string of at most 500 characters.");
    const link = parsePullRequestUrl(input.url);
    if (!link) throw new Error("url must be a github.com pull request link.");
    if (parsed.number !== undefined && parsed.number !== link.number)
      throw new Error("number does not match url.");
    parsed.url = input.url;
  }
  return parsed;
}

export class PullRequestWatchTools {
  constructor(private readonly watches: Pick<PullRequestWatches, "watch" | "unwatch" | "list">) {}

  async call(
    action: PullRequestWatchTool,
    input: Record<string, unknown>,
    principal: RuntimeLogPrincipal,
    authorized: () => boolean | Promise<boolean>,
  ): Promise<unknown> {
    const check = async () => {
      if (!(await authorized())) throw new Error("Session authority revoked.");
    };
    await check();
    if (action === "pullRequests.watch") {
      const parsed = parsePullRequestWatchInput(input);
      await check();
      return await this.watches.watch(
        { sessionId: principal.sessionId, projectId: principal.projectId },
        parsed,
      );
    }
    if (action === "pullRequests.unwatch") {
      if (typeof input.watchId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(input.watchId))
        throw new Error("watchId is required.");
      await check();
      return { removed: await this.watches.unwatch(principal.sessionId, input.watchId) };
    }
    if (action === "pullRequests.watches")
      return { watches: await this.watches.list(principal.sessionId) };
    throw new Error("Unknown pull request action");
  }
}
