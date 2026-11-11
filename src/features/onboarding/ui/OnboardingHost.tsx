import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  finishOnboarding,
  OPEN_ONBOARDING_EVENT,
  shouldShowOnboarding,
  type OnboardingContext,
} from "../model/onboarding";
import { OPEN_USAGE_GUIDE_EVENT, openUsageGuide } from "../model/usageGuide";
import {
  highlightTourSteps,
  markHighlightSeen,
  pendingHighlights,
  syncHighlightBaseline,
  type FeatureHighlight,
} from "../model/featureHighlights";
import {
  recordTourProgress,
  saveTourRecord,
  shouldOfferTour,
  START_TOUR_EVENT,
  startTour,
  tourResumeStep,
  type TourKind,
} from "../model/tourState";
import { firstRunTourSteps } from "../model/tourSteps";
import { configureFileAccess } from "../../../platform/tauri/fileAccess";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { hasActiveModalOverlay } from "../../../shared/ui/overlay";
import { t } from "../../../shared/i18n";
import { FeatureHighlightMarkers } from "./FeatureHighlightMarkers";
import type { GuidedTourOutcome } from "./GuidedTour";

const OnboardingDialog = lazy(() => import("./OnboardingDialog"));
const UsageGuideDialog = lazy(() => import("./UsageGuideDialog"));
const GuideHub = lazy(() => import("./GuideHub"));
const GuidedTour = lazy(() => import("./GuidedTour"));
const TourOffer = lazy(() =>
  import("./TourOffer").then((module) => ({ default: module.TourOffer })),
);

/** Where the guide is: the hub, a topic's quick tour, or one step's "Show me" spotlight. */
type GuideView =
  | { view: "hub"; topic?: string }
  | { view: "tour"; topic: string }
  | { view: "spotlight"; topic: string; step: string };

/** The guided tour on screen: the first-run walkthrough or the "What's new" highlights. */
type ActiveTour =
  | { kind: "first-run"; start?: string }
  | { kind: "whats-new"; highlights: FeatureHighlight[] };

/** The welcome offer waits for the app to settle, then for every dialog to close. */
const OFFER_DELAY_MS = 2500;
const OFFER_RETRY_MS = 1500;

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
  const [guide, setGuide] = useState<GuideView | null>(null);
  const [tour, setTour] = useState<ActiveTour | null>(null);
  const [offer, setOffer] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [accessBusy, setAccessBusy] = useState(false);
  const setupAccess = () => {
    setAccessBusy(true);
    setAccessError("");
    void configureFileAccess()
      .catch((error) => setAccessError(String(error)))
      .finally(() => setAccessBusy(false));
  };
  // Native storage owns the decision, including migration of existing installs, and its
  // approval lock deduplicates StrictMode and concurrent windows. Ask only once Quick setup
  // and the guide are closed: those dialogs mount later and would cover the consent dialog
  // until its native deadline expires.
  const accessReady = !open && !guide;
  useEffect(() => {
    if (accessReady) setupAccess();
  }, [accessReady]);
  useEffect(() => {
    // Record existing installations too: deleting their last project isn't a first run.
    if (!shouldShowOnboarding(context)) finishOnboarding();
    // A fresh install starts "What's new" from this version; an update keeps older entries pending.
    syncHighlightBaseline();
    const show = () => {
      setGuide(null);
      setTour(null);
      setOffer(false);
      setOpen(true);
    };
    const showGuide = () => {
      setOpen(false);
      setTour(null);
      setOffer(false);
      setGuide({ view: "hub" });
    };
    const showTour = (event: Event) => {
      const kind: TourKind = (event as CustomEvent<TourKind>).detail;
      if (kind === "whats-new") {
        const highlights = pendingHighlights();
        if (highlights.length === 0) return;
        setTour({ kind, highlights });
      } else {
        setTour({ kind: "first-run", start: tourResumeStep() });
      }
      setGuide(null);
      setOffer(false);
    };
    window.addEventListener(OPEN_ONBOARDING_EVENT, show);
    window.addEventListener(OPEN_USAGE_GUIDE_EVENT, showGuide);
    window.addEventListener(START_TOUR_EVENT, showTour);
    return () => {
      window.removeEventListener(OPEN_ONBOARDING_EVENT, show);
      window.removeEventListener(OPEN_USAGE_GUIDE_EVENT, showGuide);
      window.removeEventListener(START_TOUR_EVENT, showTour);
    };
  }, []); // The boot context is intentionally evaluated once per window.

  // Everyone who has never finished, skipped or declined the tour is offered it once, but never
  // over Quick setup, the guide or any open dialog: the offer waits until they are closed.
  const idle = !accessError && !open && !guide && !tour && !offer;
  useEffect(() => {
    if (!idle) return;
    let timer = 0;
    const check = () => {
      if (!shouldOfferTour()) return;
      if (document.visibilityState === "visible" && !hasActiveModalOverlay()) {
        setOffer(true);
        return;
      }
      timer = window.setTimeout(check, OFFER_RETRY_MS);
    };
    timer = window.setTimeout(check, OFFER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [idle]);

  const endTour = (outcome: GuidedTourOutcome) => {
    if (tour?.kind === "first-run") {
      if (outcome.type === "completed") saveTourRecord("completed");
      else if (outcome.type === "skipped") saveTourRecord("skipped");
      else if (outcome.type === "paused") recordTourProgress("paused", outcome.stepId);
      // Nothing to point at: do not offer it again in a state where it cannot work.
      else recordTourProgress("later");
    }
    setTour(null);
  };
  const tourSteps = tour
    ? tour.kind === "first-run"
      ? firstRunTourSteps()
      : highlightTourSteps(tour.highlights)
    : [];

  const content = accessError ? (
    <Modal
      title={t("File access")}
      onClose={() => setAccessError("")}
      footer={
        <ModalActions>
          <Button disabled={accessBusy} onClick={setupAccess} variant="secondary" type="button">
            {t("Retry")}
          </Button>
        </ModalActions>
      }
    >
      <Alert tone="danger">{accessError}</Alert>
    </Modal>
  ) : guide?.view === "tour" ? (
    <Suspense fallback={null}>
      <UsageGuideDialog
        tourId={guide.topic}
        projectCwd={projectCwd}
        onClose={() => setGuide(null)}
      />
    </Suspense>
  ) : guide?.view === "spotlight" ? (
    <Suspense fallback={null}>
      <UsageGuideDialog
        tourId={guide.topic}
        stepId={guide.step}
        projectCwd={projectCwd}
        // A fix that opens another window ends the visit; otherwise return to the guide.
        onClose={(reason) =>
          setGuide(reason === "action" ? null : { view: "hub", topic: guide.topic })
        }
      />
    </Suspense>
  ) : guide?.view === "hub" ? (
    <Suspense fallback={null}>
      <GuideHub
        projectCwd={projectCwd}
        initialTopic={guide.topic}
        onClose={() => setGuide(null)}
        onStartTour={(topic) =>
          setGuide({ view: "tour", topic: typeof topic === "string" ? topic : "chat" })
        }
        onShowStep={(topic, step) => setGuide({ view: "spotlight", topic, step })}
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
  ) : tour ? (
    <Suspense fallback={null}>
      <GuidedTour
        // A new run (for example "What's new" right after the first-run tour) starts fresh.
        key={tour.kind}
        steps={tourSteps}
        startStepId={tour.kind === "first-run" ? tour.start : undefined}
        projectCwd={projectCwd}
        onStepShown={(id) => {
          if (tour.kind === "whats-new") markHighlightSeen(id);
          else recordTourProgress("paused", id);
        }}
        onEnd={endTour}
      />
    </Suspense>
  ) : offer ? (
    <Suspense fallback={null}>
      <TourOffer
        onStart={() => {
          setOffer(false);
          startTour("first-run");
        }}
        onLater={() => {
          saveTourRecord("later");
          setOffer(false);
        }}
      />
    </Suspense>
  ) : null;

  return (
    <>
      {content}
      <FeatureHighlightMarkers />
    </>
  );
}
