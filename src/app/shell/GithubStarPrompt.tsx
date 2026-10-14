import { t, useLocale } from "../../shared/i18n";
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
  useLocale();
  const [dismissed, setDismissed] = useState(isPromptDismissed);
  const repositoryUrl = PRODUCT_IDENTITY.repositoryUrl;
  if (!repositoryUrl || dismissed) return null;
  return (
    <div data-github-star-prompt className="relative mb-1 h-8 w-full">
      <button
        type="button"
        aria-label={t("View {p0} on GitHub", { p0: PRODUCT_IDENTITY.displayName })}
        onClick={() => void openUrl(repositoryUrl).catch(() => undefined)}
        className="flex h-full w-full items-center justify-center gap-2 rounded-md bg-accent/8 pl-2.5 pr-8 text-accent hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Star className="size-3 shrink-0" strokeWidth={1.5} />
        <span className="truncate text-xs font-medium">{t("View on GitHub")}</span>
      </button>
      <button
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
        className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-content/50 hover:bg-content/8 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <X className="size-3" strokeWidth={1.75} />
      </button>
    </div>
  );
}
