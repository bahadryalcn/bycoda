import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Button } from "../../../shared/ui/Button";
import { hasActiveModalOverlay } from "../../../shared/ui/overlay";
import { Toast } from "../../../shared/ui/ToastRegion";
import {
  answerContributeLater,
  answerContributeNever,
  readContributeState,
  recordContributeUse,
  shouldPromptContribute,
} from "../model/contribute";
import {
  dismissContributeFlow,
  repositoryFolderName,
  startContribution,
  useContributeFlow,
} from "../model/contributeFlow";

const FIRST_DELAY_MS = 20_000;
const RETRY_MS = 5_000;

/**
 * The invitation to contribute, after a week and five days of use, and the progress of the
 * clone-and-open flow (also started from Settings → About). Non-blocking: it waits for dialogs
 * to close and for a visible window, and is hidden when no repository is configured.
 */
export function ContributePrompt() {
  useLocale();
  const flow = useContributeFlow();
  const [shown, setShown] = useState(false);
  const repository = PRODUCT_IDENTITY.repositoryUrl;
  useEffect(() => {
    if (!repository) return;
    recordContributeUse();
    if (!shouldPromptContribute(readContributeState(), Date.now())) return;
    let timer = setTimeout(function check() {
      if (hasActiveModalOverlay() || document.visibilityState !== "visible") {
        timer = setTimeout(check, RETRY_MS);
      } else if (shouldPromptContribute(readContributeState(), Date.now())) {
        setShown(true);
      }
    }, FIRST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [repository]);

  if (!repository) return null;
  if (flow.status === "cloning") {
    return (
      <Toast
        tone="info"
        title={t("Cloning…")}
        message={t("Downloading bycoda from GitHub.")}
        durationMs={null}
        width="lg"
      />
    );
  }
  if (flow.status === "opened") {
    return (
      <Toast
        tone="success"
        title={t("Opened {p0}", { p0: repositoryFolderName(repository) ?? "bycoda" })}
        message={t("Read CONTRIBUTING.md in the project root to get started.")}
        durationMs={12_000}
        width="lg"
        onDismiss={dismissContributeFlow}
      />
    );
  }
  if (flow.status === "failed") {
    return (
      <Toast
        tone="danger"
        title={t("Could not clone bycoda")}
        message={
          flow.reason === "git-missing"
            ? t("Git is not installed. Install Git and try again.")
            : flow.message
        }
        width="lg"
        onDismiss={dismissContributeFlow}
      />
    );
  }
  if (!shown) return null;
  return (
    <Toast
      tone="info"
      title={t("Want to contribute to bycoda?")}
      message={t(
        "bycoda is open source. Clone it, open it as a project and start with CONTRIBUTING.md.",
      )}
      durationMs={null}
      width="lg"
      actionsPlacement="footer"
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              setShown(false);
              startContribution().catch(() => undefined);
            }}
          >
            {t("Clone and open")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              answerContributeLater();
              setShown(false);
            }}
          >
            {t("Later")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              answerContributeNever();
              setShown(false);
            }}
          >
            {t("No thanks")}
          </Button>
        </>
      }
      onDismiss={() => {
        answerContributeLater();
        setShown(false);
      }}
    />
  );
}
