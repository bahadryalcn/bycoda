import { Text } from "../../shared/ui/Text";
import { Button } from "../../shared/ui/Button";
import { ButtonGroup } from "../../shared/ui/ButtonGroup";
import { useT } from "../../shared/i18n";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState, type ReactNode } from "react";
import { version as appVersion } from "../../../package.json";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
import { Star, X } from "../../shared/ui/icons";
import styles from "./GithubStarPrompt.module.css";

/** Dismissal is per app version, so the prompt returns once after every update. */
const dismissedKey = (version: string) => `bycoda.githubStarPrompt.dismissed.${version}`;
const DISMISS_EVENT = "bycoda:github-star-dismissed";
function isDismissed(version: string) {
  try {
    return localStorage.getItem(dismissedKey(version)) === "1";
  } catch {
    return false;
  }
}

function useGithubStar(version: string) {
  const [dismissed, setDismissed] = useState(() => isDismissed(version));
  useEffect(() => {
    const onDismiss = (event: Event) => {
      if ((event as CustomEvent<string>).detail === version) setDismissed(true);
    };
    window.addEventListener(DISMISS_EVENT, onDismiss);
    return () => window.removeEventListener(DISMISS_EVENT, onDismiss);
  }, [version]);
  const repositoryUrl = PRODUCT_IDENTITY.repositoryUrl;
  const handleDismiss = () => {
    try {
      localStorage.setItem(dismissedKey(version), "1");
    } catch {
      /* session dismissal still works */
    }
    setDismissed(true);
    window.dispatchEvent(new CustomEvent(DISMISS_EVENT, { detail: version }));
  };
  return {
    visible: !!repositoryUrl && !dismissed,
    open: () => void openUrl(repositoryUrl!).catch(() => undefined),
    dismiss: handleDismiss,
  };
}

/** Retained for callers resetting the former request cache. No network cache remains. */
export function resetGithubStarPromptCacheForTest() {}

type PromptProps = {
  version: string;
  action?: ReactNode;
  icon?: boolean;
  compact?: boolean;
};

/** Opens only the configured product repository; never acts on an upstream account. */
export function GithubStarPrompt({ version = appVersion, ...rest }: Partial<PromptProps>) {
  // A new version remounts, so the dismissal is read again for it.
  return <GithubStarPromptBody key={version} version={version} {...rest} />;
}

function GithubStarPromptBody({ version, action, icon = false, compact = false }: PromptProps) {
  const t = useT();
  const star = useGithubStar(version);
  const { visible } = star;
  if (!visible && !action) return null;
  const buttons = visible ? (
    <>
      <Button
        {...(icon ? { iconOnly: true as const } : { iconOnly: false as const })}
        label={t("View {p0} on GitHub", { p0: PRODUCT_IDENTITY.displayName })}
        variant="ghost"
        motion="none"
        type="button"
        aria-label={t("View {p0} on GitHub", { p0: PRODUCT_IDENTITY.displayName })}
        onClick={star.open}
        className={icon ? styles.open : "min-w-0 flex-1"}
      >
        <Star className={icon ? "icon-md" : "icon-xs shrink-0"} strokeWidth={1.75} />
        {!icon ? (
          <Text size="caption" tone="inherit" weight="medium" truncate>
            {t("View on GitHub")}
          </Text>
        ) : null}
      </Button>
      <Button
        iconOnly
        inset={icon}
        shape={icon ? "pill" : "default"}
        className={icon ? styles.dismiss : undefined}
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
  ) : null;
  return (
    <ButtonGroup
      surface={icon ? "transparent" : "navigation"}
      aria-label={t("Actions")}
      data-github-star-prompt
      data-icon={icon || undefined}
      data-compact={compact || undefined}
      className={icon ? styles.icons : visible ? "w-full" : "self-end"}
    >
      {icon && visible ? <div className={styles.star}>{buttons}</div> : buttons}
      {action}
    </ButtonGroup>
  );
}
