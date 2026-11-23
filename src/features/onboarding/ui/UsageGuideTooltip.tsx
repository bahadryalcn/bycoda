import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useEffect, useRef } from "react";
import { X } from "../../../shared/ui/icons";
import { LiveText } from "../../../shared/ui/LiveText";
import type { TooltipRenderProps } from "react-joyride";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import { ScrollArea } from "../../../shared/ui/ScrollArea";

/**
 * The one tour card for every spotlight tour (first-run, "What's new" and the Guide's quick
 * tours). Joyride owns positioning, focus management and tour actions; Arc owns the controls.
 * One short step: progress, title, a sentence, an optional Try it (in `content`), Skip/Back/Next.
 */
export function UsageGuideTooltip({
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
    <Text
      as="section"
      size="body"
      tone="primary"
      leading="normal"
      {...tooltipProps}
      ref={card}
      {...surfaceAttributes(
        { variant: "floating", frame: "card", radius: "panel" },
        "bycoda-arc usage-guide-panel usage-guide-panel--compact",
      )}
      data-joyride-step={index}
      aria-labelledby="usage-guide-title"
      aria-describedby="usage-guide-description"
    >
      <Text
        as="header"
        size="caption"
        tone="secondary"
        leading="normal"
        className="usage-guide-toolbar"
      >
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
      </Text>
      <ScrollArea gutter="stable" className="usage-guide-scroll" key={index}>
        <Heading size="page" level={2} id="usage-guide-title" className="usage-guide-tour-title">
          {step.title}
        </Heading>
        {step.content}
      </ScrollArea>
      <footer className="usage-guide-footer">
        {size > 1 && !isLastStep ? (
          <Button
            {...withoutTitle(skipProps)}
            variant="ghost"
            size="sm"
            className="usage-guide-skip"
          >
            {t("Skip tour")}
          </Button>
        ) : null}
        <div className="usage-guide-actions">
          {size > 1 ? (
            <Button
              {...withoutTitle(backProps)}
              variant="secondary"
              size="sm"
              disabled={index === 0}
            >
              {t("Back")}
            </Button>
          ) : null}
          <Button {...withoutTitle(primaryProps)} size="sm">
            {t(isLastStep ? "Done" : "Next")}
          </Button>
        </div>
      </footer>
    </Text>
  );
}

/**
 * Joyride puts a `title` on its action props; the shared `Button` turns `title` into a tooltip
 * that only repeats the visible label, so the tour drops it.
 */
function withoutTitle<T extends { title?: string }>(props: T): Omit<T, "title"> {
  const { title: _title, ...rest } = props;
  return rest;
}
