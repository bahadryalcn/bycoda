import type { useT } from "../../../shared/i18n";
import type { WorkItemSearchError } from "../../inbox/public/workItemMentions";

type Translate = ReturnType<typeof useT>;

/** Why a tracker search found nothing, in one short line for the empty mention menu. */
export function workItemSearchNotice(
  error: Pick<WorkItemSearchError, "failure" | "retryAt">,
  machine: string | undefined,
  t: Translate,
  now: number,
): string {
  const name = machine ?? t("this computer");
  switch (error.failure) {
    case "missing-tool":
      return t("GitHub CLI missing on {p0}", { p0: name });
    case "unauthenticated":
      return t("Sign in to GitHub on {p0}", { p0: name });
    case "rate-limited": {
      const seconds = error.retryAt ? Math.ceil((error.retryAt - now) / 1000) : 0;
      return seconds > 0 ? t("Rate limited, retry in {p0} s", { p0: seconds }) : t("Rate limited");
    }
    case "not-found":
    case "repository-unresolved":
      return t("Repository not found");
    case "remote-host-unavailable":
      return t("Connected machine unavailable");
    default:
      return t("Search failed");
  }
}
