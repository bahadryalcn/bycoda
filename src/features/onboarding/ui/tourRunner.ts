import { useEffect, useEffectEvent } from "react";
import type { FloatingOptions, Locale, Options } from "react-joyride";
import { t } from "../../../shared/i18n";
import { LAYER } from "../../../shared/lib/layers";
import { guideActionBlocker, runGuideAction } from "../model/guide";
import type { GuideContext } from "../model/guideTopics";
import { findUsageGuideTarget } from "../model/usageGuideTargets";
import type { TourStepDef } from "../model/tourSteps";

/**
 * The Joyride configuration every spotlight tour shares: the Guide's quick tours, the
 * first-run tour and the "What's new" highlights. Joyride owns positioning, the focus trap and
 * re-anchoring on resize and scroll; Escape is left to `overlay.ts` (see the runners).
 */
export const TOUR_OPTIONS: Partial<Options> = {
  skipBeacon: true,
  skipScroll: true,
  scrollDuration: 0,
  buttons: ["back", "close", "primary", "skip"],
  blockTargetInteraction: true,
  overlayClickAction: false,
  dismissKeyAction: false,
  closeButtonAction: "skip",
  backgroundColor: "var(--color-background-base)",
  textColor: "var(--color-content)",
  primaryColor: "var(--color-content)",
  width: 520,
  targetWaitTimeout: 0,
  zIndex: LAYER.dialog,
};

export const TOUR_FLOATING: Partial<FloatingOptions> = {
  strategy: "fixed",
  hideArrow: true,
  shiftOptions: { crossAxis: true, padding: 16 },
};

/** Compact cards (first-run and "What's new" tours) are narrower and hug the target. */
export const COMPACT_TOUR_OPTIONS: Partial<Options> = {
  ...TOUR_OPTIONS,
  width: 340,
  spotlightPadding: 6,
  spotlightRadius: 8,
};

export function tourLocale(): Locale {
  return {
    back: t("← Back"),
    close: t("Close guide"),
    skip: t("Close guide"),
    last: t("Done"),
    next: t("Continue →"),
    open: t("Usage guide"),
  };
}

/** Labels of the compact card; they become the accessible names of its buttons. */
export function compactTourLocale(): Locale {
  return {
    back: t("Back"),
    close: t("Close"),
    skip: t("Skip tour"),
    last: t("Done"),
    next: t("Next"),
    open: t("Usage guide"),
  };
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** Left and right arrows step through the tour, like Back and Next. */
export function useTourArrowKeys(onPrevious: () => void, onNext: () => void) {
  const previous = useEffectEvent(onPrevious);
  const next = useEffectEvent(onNext);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.shiftKey || isEditable(event.target)) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        previous();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Controls are mounted by the same commit that asks for them; a short wait covers that. */
const TARGET_GRACE_MS = 300;
/** Revealing a hidden panel (sidebar tab, project view) may animate before its controls exist. */
const REVEAL_WAIT_MS = 900;
const POLL_MS = 60;

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Brings a step's controls on screen when it can: waits briefly for them, then runs the step's
 * `reveal` action once (when that action's own gate allows it). Resolves to the control, or
 * null when the step has to be skipped. A step without targets is explained in the center.
 */
export async function ensureTourTarget(
  step: TourStepDef,
  context: GuideContext,
): Promise<HTMLElement | null | "centered"> {
  if (step.targets.length === 0) return "centered";
  const found = findUsageGuideTarget(step.targets);
  if (found) return found;
  const reveal = step.reveal && !guideActionBlocker(step.reveal, context) ? step.reveal : null;
  const deadline = Date.now() + (reveal ? REVEAL_WAIT_MS : TARGET_GRACE_MS);
  if (reveal) runGuideAction(reveal);
  while (Date.now() < deadline) {
    await delay(POLL_MS);
    const next = findUsageGuideTarget(step.targets);
    if (next) return next;
  }
  return null;
}
