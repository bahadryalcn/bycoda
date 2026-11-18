import { xResourceId } from "./adapters/x-identifiers";

/** Destinations on X that require the owner to complete the action in a browser. */
export const X_DESTINATIONS = [
  "signup",
  "connect",
  "profile",
  "post",
  "publish",
  "messages",
  "audience",
  "lists",
  "analytics",
  "earnings",
  "live",
  "spaces",
] as const;

export type XDestination = (typeof X_DESTINATIONS)[number];

const paths: Record<XDestination, string> = {
  signup: "/i/flow/signup",
  connect: "/i/flow/login",
  profile: "/settings/profile",
  post: "/",
  publish: "/compose/post",
  messages: "/messages",
  audience: "/settings/your_twitter_data",
  lists: "/i/lists",
  analytics: "/i/jf/creators/studio",
  earnings: "/i/jf/creators/studio",
  live: "/i/live-studio",
  spaces: "/i/spaces/start",
};

export function xHandoff(destination: unknown, target?: unknown, accountId?: unknown) {
  if (
    typeof destination !== "string" ||
    !(X_DESTINATIONS as readonly string[]).includes(destination)
  )
    throw new Error("Choose an X destination.");
  const name = destination as XDestination;
  let path = paths[name];
  if (name === "post") path = `/i/web/status/${xResourceId(target)}`;
  if (name === "audience" && target) path = `/i/user/${xResourceId(target)}`;
  if (name === "audience" && !target && accountId) path = `/i/user/${xResourceId(accountId)}`;
  return { status: "needs_human" as const, url: `https://x.com${path}` };
}
