import { useEffect, useRef } from "react";
import { X } from "../../../shared/ui/icons";
import { Stepper } from "../../../shared/ui/Stepper";
import { LiveText } from "../../../shared/ui/LiveText";
import type { TooltipRenderProps } from "react-joyride";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";

const guides = [
  { name: "Obi-Wan Kenobi", asset: "obi-wan" },
  { name: "Leia Organa", asset: "leia" },
  { name: "Yoda", asset: "yoda" },
  { name: "Luke Skywalker", asset: "luke" },
  { name: "Chewbacca", asset: "chewbacca" },
];

/**
 * Joyride owns positioning, focus management and tour actions; Arc owns the controls.
 * Steps flagged `data: { compact: true }` (first-run and "What's new" tours) get the compact card.
 */
export function UsageGuideTooltip(props: TooltipRenderProps) {
  return props.step.data?.compact ? <TourCard {...props} /> : <UsageGuidePanel {...props} />;
}

/** One short step: progress, title, a sentence, an optional Try it (in `content`), Skip/Back/Next. */
function TourCard({
  backProps,
  closeProps,
  index,
  isLastStep,
  primaryProps,
  skipProps,
  size,
  step,
  tooltipProps,
}: TooltipRenderProps) {
  const card = useRef<HTMLElement>(null);
  // Joyride traps focus in the card and lands on the primary action when it opens. A Try it
  // button disappears with its step, so focus is put back on the main action for the next card.
  useEffect(() => {
    const root = card.current;
    if (!root || root.contains(document.activeElement)) return;
    root.querySelector<HTMLElement>('[data-action="primary"]')?.focus({ preventScroll: true });
  }, [index]);
  return (
    <section
      {...tooltipProps}
      ref={card}
      className="bycoda-arc usage-guide-panel usage-guide-panel--compact"
      data-joyride-step={index}
      aria-labelledby="usage-guide-title"
      aria-describedby="usage-guide-description"
    >
      <header className="usage-guide-toolbar">
        <span className="usage-guide-progress-count" aria-hidden="true">
          {t("{p0} / {p1}", { p0: index + 1, p1: size })}
        </span>
        <LiveText className="sr-only" text={t("Step {p0} of {p1}", { p0: index + 1, p1: size })} />
        <Button
          {...closeProps}
          variant="ghost"
          iconOnly
          label={closeProps["aria-label"] ?? closeProps.title ?? t("Close")}
        >
          <X className="icon-md" aria-hidden="true" />
        </Button>
      </header>
      <div className="usage-guide-scroll" key={index}>
        <h2 id="usage-guide-title" className="usage-guide-tour-title">
          {step.title}
        </h2>
        {step.content}
      </div>
      <footer className="usage-guide-footer">
        {size > 1 && !isLastStep ? (
          <Button {...skipProps} variant="ghost" size="sm" className="usage-guide-skip">
            {t("Skip tour")}
          </Button>
        ) : null}
        <div className="usage-guide-actions">
          {size > 1 ? (
            <Button {...backProps} variant="secondary" size="sm" disabled={index === 0}>
              {t("Back")}
            </Button>
          ) : null}
          <Button {...primaryProps} size="sm">
            {t(isLastStep ? "Done" : "Next")}
          </Button>
        </div>
      </footer>
    </section>
  );
}

function UsageGuidePanel({
  backProps,
  closeProps,
  index,
  isLastStep,
  primaryProps,
  skipProps,
  size,
  step,
  tooltipProps,
}: TooltipRenderProps) {
  const guide = guides[index % guides.length];
  return (
    <section
      {...tooltipProps}
      className="bycoda-arc usage-guide-panel"
      data-joyride-step={index}
      aria-labelledby="usage-guide-title"
      aria-describedby="usage-guide-description"
    >
      <header className="usage-guide-toolbar">
        <span>{t("Usage guide")}</span>
        <LiveText
          className="usage-guide-progress"
          text={t("Step {p0} of {p1}", { p0: index + 1, p1: size })}
        />
        <Button
          {...closeProps}
          variant="ghost"
          iconOnly
          label={closeProps["aria-label"] ?? closeProps.title ?? t("Close")}
        >
          <X className="icon-lg" aria-hidden="true" />
        </Button>
      </header>
      <div className="usage-guide-scroll" key={index}>
        <div className="usage-guide-hero">
          <div className="usage-guide-intro">
            <h2 id="usage-guide-title">{step.title}</h2>
            <span className="usage-guide-companion">{guide.name}</span>
          </div>
          <img
            className="usage-guide-character"
            src={`/crew/star-wars/${guide.asset}.svg`}
            alt=""
            width={104}
            height={144}
          />
        </div>
        {step.content}
      </div>
      <footer className="usage-guide-footer">
        <Stepper
          label={t("Usage guide")}
          steps={Array.from({ length: size }, (_, position) => ({
            id: String(position),
            label: t("Step {p0} of {p1}", { p0: position + 1, p1: size }),
          }))}
          current={index}
          compact
        />
        <div className="usage-guide-actions">
          {size > 1 && !isLastStep ? (
            <Button
              {...skipProps}
              variant="ghost"
              aria-label={t("Skip tour")}
              className="usage-guide-skip"
            >
              {t("Skip tour")}
            </Button>
          ) : null}
          {size > 1 ? (
            <Button {...backProps} variant="secondary" disabled={index === 0}>
              {t("← Back")}
            </Button>
          ) : null}
          <Button {...primaryProps}>{t(isLastStep ? "Done" : "Continue →")}</Button>
        </div>
      </footer>
    </section>
  );
}
