import { useT } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Toast } from "../../../shared/ui/ToastRegion";
import {
  dismissContributeFlow,
  repositoryFolderName,
  useContributeFlow,
} from "../model/contributeFlow";

/**
 * Progress and result of the clone-and-open contribution flow, which the user starts from
 * Settings → About. There is no unsolicited invitation. Hidden when no repository is configured.
 */
export function ContributePrompt() {
  const t = useT();
  const flow = useContributeFlow();
  const repository = PRODUCT_IDENTITY.repositoryUrl;

  if (!repository) return null;
  if (flow.status === "cloning") {
    return <Toast tone="info" title={t("Cloning…")} durationMs={null} width="lg" />;
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
  return null;
}
