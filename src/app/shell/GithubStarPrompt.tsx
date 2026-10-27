import { Button } from "../../shared/ui/Button";
import { ButtonGroup } from "../../shared/ui/ButtonGroup";
import { useT } from "../../shared/i18n";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, type ReactNode } from "react";
import { version as appVersion } from "../../../package.json";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
import { Star, X } from "../../shared/ui/icons";

const DISMISSED_STORAGE_KEY = "bycoda.githubStarPrompt.dismissed.v1";
function dismissedVersion() {
  try {
    return localStorage.getItem(DISMISSED_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Retained for callers resetting the former request cache. No network cache remains. */
export function resetGithubStarPromptCacheForTest() {}

/** Opens only the configured product repository; never acts on an upstream account. */
export function GithubStarPrompt({
  version = appVersion,
  action,
}: { version?: string; action?: ReactNode } = {}) {
  const t = useT();
  const [dismissed, setDismissed] = useState(dismissedVersion);
  const repositoryUrl = PRODUCT_IDENTITY.repositoryUrl;
  const visible = !!repositoryUrl && dismissed !== version;
  if (!visible && !action) return null;
  return (
    <ButtonGroup
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
            onClick={() => void openUrl(repositoryUrl!).catch(() => undefined)}
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
            onClick={() => {
              try {
                localStorage.setItem(DISMISSED_STORAGE_KEY, version);
              } catch {
                /* session dismissal still works */
              }
              setDismissed(version);
            }}
          >
            <X className="icon-xs" strokeWidth={1.75} />
          </Button>
        </>
      ) : null}
      {action}
    </ButtonGroup>
  );
}
