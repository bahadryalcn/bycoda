import { X } from "../../../shared/ui/icons";
import { Stepper } from "../../../shared/ui/Stepper";
import type { TooltipRenderProps } from "react-joyride";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";

const guides = [
  { name: "Obi-Wan Kenobi", asset: "obi-wan", label: "New Tab" },
  { name: "Leia Organa", asset: "leia", label: "Queue message" },
  { name: "Yoda", asset: "yoda", label: "Stop" },
  { name: "Luke Skywalker", asset: "luke", label: "Changes" },
  { name: "Chewbacca", asset: "chewbacca", label: "Shortcuts" },
];

/** Joyride owns positioning, focus management and tour actions; Arc owns the controls. */
export function UsageGuideTooltip({
  backProps,
  closeProps,
  index,
  isLastStep,
  primaryProps,
  size,
  step,
  tooltipProps,
}: TooltipRenderProps) {
  const guide = guides[index];
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
        <span className="usage-guide-progress" aria-live="polite" aria-atomic="true">
          {t("Step {p0} of {p1}", { p0: index + 1, p1: size })}
        </span>
        <Button
          {...closeProps}
          variant="ghost"
          iconOnly
          label={closeProps["aria-label"] ?? closeProps.title ?? t("Close")}
        >
          <X size={18} aria-hidden="true" />
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
          steps={guides.map((guide) => ({ id: guide.asset, label: t(guide.label) }))}
          current={index}
          compact
        />
        <div className="usage-guide-actions">
          <Button {...backProps} variant="secondary" disabled={index === 0}>
            {t("← Back")}
          </Button>
          <Button {...primaryProps}>{t(isLastStep ? "Done" : "Continue →")}</Button>
        </div>
      </footer>
    </section>
  );
}
