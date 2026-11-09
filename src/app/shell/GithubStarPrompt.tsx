import { Button } from "../../shared/ui/Button";
import { ButtonGroup } from "../../shared/ui/ButtonGroup";
import { useT } from "../../shared/i18n";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, type ReactNode } from "react";
import { version as appVersion } from "../../../package.json";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
import { Star, X } from "../../shared/ui/icons";

/** Dismissal is per app version, so the prompt returns once after every update. */
const dismissedKey = (version: string) => `bycoda.githubStarPrompt.dismissed.${version}`;
function isDismissed(version: string) {
  try {
    return localStorage.getItem(dismissedKey(version)) === "1";
  } catch {
    return false;
  }
}

function useGithubStar(version: string) {
  const [dismissed, setDismissed] = useState(() => isDismissed(version));
  const [seen, setSeen] = useState(version);
  if (seen !== version) {
    setSeen(version);
    setDismissed(isDismissed(version));
  }
  const repositoryUrl = PRODUCT_IDENTITY.repositoryUrl;
  return {
    visible: !!repositoryUrl && !dismissed,
    open: () => void openUrl(repositoryUrl!).catch(() => undefined),
    dismiss: () => {
      try {
        localStorage.setItem(dismissedKey(version), "1");
      } catch {
        /* session dismissal still works */
      }
      setDismissed(true);
    },
  };
}

/** Retained for callers resetting the former request cache. No network cache remains. */
export function resetGithubStarPromptCacheForTest() {}

/** Opens only the configured product repository; never acts on an upstream account. */
export function GithubStarPrompt({
  version = appVersion,
  action,
}: { version?: string; action?: ReactNode } = {}) {
  const t = useT();
  const star = useGithubStar(version);
  const { visible } = star;
  if (!visible && !action) return null;
  return (
    <ButtonGroup
      surface="navigation"
      aria-label={t("Actions")}
      data-github-star-prompt
      className={visible ? "w-full" : "self-end"}
    >
      {visible ? (
        <>
          <Button
            variant="ghost"
            motion="none"
            type="button"
            aria-label={t("View {p0} on GitHub", { p0: PRODUCT_IDENTITY.displayName })}
            onClick={star.open}
            className="min-w-0 flex-1"
          >
            <Star className="icon-xs shrink-0" strokeWidth={1.75} />
            <span className="truncate text-ui-caption font-medium">{t("View on GitHub")}</span>
          </Button>
          <Button
            iconOnly
            label={t("Dismiss GitHub repository prompt")}
            variant="ghost"
            motion="none"
            type="button"
            aria-label={t("Dismiss GitHub repository prompt")}
            onClick={star.dismiss}
          >
            <X className="icon-xs" strokeWidth={1.75} />
          </Button>
        </>
      ) : null}
      {action}
    </ButtonGroup>
  );
}
