const AVATAR_COLORS = ["info", "success", "warning", "danger", "feature", "orchestration"] as const;

/** Finite semantic palette: stable per identity; collisions are expected. */
export function inboxAvatarColor(identity: string): string {
  let hash = 2166136261;
  for (const character of identity.trim()) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  }
  return `var(--ui-avatar-${AVATAR_COLORS[(hash >>> 0) % AVATAR_COLORS.length]})`;
}

/** These images need the native media route, including private Jira sites. */
export function isJiraAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname.endsWith(".atlassian.net") ||
        (url.hostname.startsWith("avatar-management--avatars.") &&
          url.hostname.endsWith(".prod.public.atl-paas.net")) ||
        url.pathname === "/secure/useravatar" ||
        /^\/rest\/api\/(2|3)\/user\/avatar(?:\/|$)/.test(url.pathname))
    );
  } catch {
    return false;
  }
}
