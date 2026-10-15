import { Check, X } from "lucide-react";
import type { TooltipRenderProps } from "react-joyride";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/arc/button/button";

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
        <Button {...closeProps} variant="ghost" className="usage-guide-close">
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
        <ol className="usage-guide-track" aria-label={t("Usage guide")}>
          {guides.map((item, itemIndex) => (
            <li
              key={item.asset}
              aria-current={itemIndex === index ? "step" : undefined}
              data-complete={itemIndex < index || undefined}
              title={t(item.label)}
              aria-label={t(item.label)}
            >
              <span className="usage-guide-marker" aria-hidden="true">
                {itemIndex < index ? <Check size={12} /> : itemIndex + 1}
              </span>
              <span className="usage-guide-track-label">{t(item.label)}</span>
            </li>
          ))}
        </ol>
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
