import { Link } from "../../../shared/ui/icons";
import { InboxProviderMark } from "../../inbox/public/workItemMentions";
import type { UserLink } from "../model/linkPreview";

/** Stable link identity, also available before a remote favicon loads. */
export function UserLinkIcon({ link, className }: { link: UserLink; className?: string }) {
  const provider =
    link.host === "github.com"
      ? "github"
      : link.host === "gitlab.com"
        ? "gitlab"
        : link.host.endsWith(".atlassian.net")
          ? "jira"
          : null;
  return provider ? (
    <InboxProviderMark provider={provider} className={className} />
  ) : (
    <Link className={className} aria-hidden="true" />
  );
}
