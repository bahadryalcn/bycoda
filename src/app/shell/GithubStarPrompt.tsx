import { Button } from "../../shared/ui/Button";
import { useT } from "../../shared/i18n";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
import { Star, X } from "../../shared/ui/icons";

const DISMISSED_STORAGE_KEY = "bycoda.githubStarPrompt.dismissed.v1";
function isPromptDismissed() {
  try {
    return localStorage.getItem(DISMISSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Retained for callers resetting the former request cache. No network cache remains. */
export function resetGithubStarPromptCacheForTest() {}

/** Opens only the configured product repository; never acts on an upstream account. */
export function GithubStarPrompt() {
  const t = useT();
  const [dismissed, setDismissed] = useState(isPromptDismissed);
  const repositoryUrl = PRODUCT_IDENTITY.repositoryUrl;
  if (!repositoryUrl || dismissed) return null;
  return (
    <div data-github-star-prompt className="relative mb-1 h-8 w-full">
      <Button
        variant="ghost"
        motion="none"
        type="button"
        aria-label={t("View {p0} on GitHub", { p0: PRODUCT_IDENTITY.displayName })}
        onClick={() => void openUrl(repositoryUrl).catch(() => undefined)}
        className="flex h-full w-full items-center justify-center gap-2"
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
            localStorage.setItem(DISMISSED_STORAGE_KEY, "1");
          } catch {
            /* session dismissal still works */
          }
          setDismissed(true);
        }}
        className="absolute right-1 top-1/2 grid -translate-y-1/2 place-items-center"
      >
        <X className="icon-xs" strokeWidth={1.75} />
      </Button>
    </div>
  );
}
