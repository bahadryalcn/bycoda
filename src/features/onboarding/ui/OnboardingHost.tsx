import { lazy, Suspense, useEffect, useState } from "react";
import {
  finishOnboarding,
  OPEN_ONBOARDING_EVENT,
  shouldShowOnboarding,
  type OnboardingContext,
} from "../model/onboarding";
import { OPEN_USAGE_GUIDE_EVENT, openUsageGuide } from "../model/usageGuide";
import { configureFileAccess } from "../../../platform/tauri/fileAccess";
import { Modal } from "../../../shared/ui/Modal";
import { t } from "../../../shared/i18n";

const OnboardingDialog = lazy(() => import("./OnboardingDialog"));
const UsageGuideDialog = lazy(() => import("./UsageGuideDialog"));
const GuideHub = lazy(() => import("./GuideHub"));

export function OnboardingHost({
  context,
  onImported,
  onOpenProject,
  projectCwd,
}: {
  context: OnboardingContext;
  onImported: () => void;
  onOpenProject: (path: string) => void;
  projectCwd: string;
}) {
  const [open, setOpen] = useState(() => shouldShowOnboarding(context));
  const [guide, setGuide] = useState<"hub" | "tour" | null>(null);
  const [accessError, setAccessError] = useState("");
  const [accessBusy, setAccessBusy] = useState(false);
  const setupAccess = () => {
    setAccessBusy(true);
    setAccessError("");
    void configureFileAccess()
      .catch((error) => setAccessError(String(error)))
      .finally(() => setAccessBusy(false));
  };
  useEffect(() => {
    // Native storage owns the decision, including migration of existing installs.
    // The native approval lock deduplicates StrictMode and concurrent windows.
    setupAccess();
    // Record existing installations too: deleting their last project isn't a first run.
    if (!shouldShowOnboarding(context)) finishOnboarding();
    const show = () => {
      setGuide(null);
      setOpen(true);
    };
    const showGuide = () => {
      setOpen(false);
      setGuide("hub");
    };
    window.addEventListener(OPEN_ONBOARDING_EVENT, show);
    window.addEventListener(OPEN_USAGE_GUIDE_EVENT, showGuide);
    return () => {
      window.removeEventListener(OPEN_ONBOARDING_EVENT, show);
      window.removeEventListener(OPEN_USAGE_GUIDE_EVENT, showGuide);
    };
  }, []); // The boot context is intentionally evaluated once per window.

  return accessError ? (
    <Modal title={t("File access")} onClose={() => setAccessError("")}>
      <p role="alert">{accessError}</p>
      <button disabled={accessBusy} onClick={setupAccess}>
        {t("Retry")}
      </button>
    </Modal>
  ) : guide === "tour" ? (
    <Suspense fallback={null}>
      <UsageGuideDialog onClose={() => setGuide(null)} />
    </Suspense>
  ) : guide === "hub" ? (
    <Suspense fallback={null}>
      <GuideHub
        projectCwd={projectCwd}
        onClose={() => setGuide(null)}
        onStartTour={() => setGuide("tour")}
      />
    </Suspense>
  ) : open ? (
    <Suspense fallback={null}>
      <OnboardingDialog
        onImported={onImported}
        onOpenProject={onOpenProject}
        onStartGuide={() => {
          finishOnboarding();
          // Use the shared request so the shell reveals the workspace too.
          openUsageGuide();
        }}
        onFinish={() => {
          finishOnboarding();
          setOpen(false);
        }}
      />
    </Suspense>
  ) : null;
}
