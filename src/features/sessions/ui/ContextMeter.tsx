import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { contextRatio, contextTooltip, type ContextUsage } from "../model/contextUsage";
import { sessionUsageTooltip, type SessionUsage } from "../model/sessionUsage";
import { Popover } from "../../../shared/ui/Popover";
import "./chat-controls.css";

const SIZE = 14;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Ring turns amber then red as the window fills. */
function ringClass(ratio: number): string {
  if (ratio >= 0.9) return "text-(--ui-tone-danger-fg)";
  if (ratio >= 0.75) return "text-(--ui-tone-warning-fg)";
  return "context-meter-neutral";
}

/**
 * Circular gauge for how full the model context window is.
 *
 * Renders nothing until the harness reports both halves — Cursor's ACP stream
 * carries no usage at all, and a ring guessing at a number is worse than no
 * ring. A confirmed empty conversation without usage shows a bare ring.
 */
export function ContextMeter({
  usage,
  sessionUsage,
  onCompact,
  compactDisabled = false,
  empty = false,
}: {
  usage?: ContextUsage;
  sessionUsage?: SessionUsage;
  onCompact?: () => void;
  compactDisabled?: boolean;
  /** The conversation is confirmed to have no messages or prior usage. */
  empty?: boolean;
}) {
  useLocale();
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelHoverClose() {
    if (hoverCloseTimer.current !== null) {
      clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
  }
  function enterHover() {
    cancelHoverClose();
    setHovered(true);
  }
  function leaveHover() {
    cancelHoverClose();
    // Give the pointer time to cross the gap to the portalled popover.
    hoverCloseTimer.current = setTimeout(() => setHovered(false), 200);
  }
  function closeActions() {
    cancelHoverClose();
    setHovered(false);
    setOpen(false);
  }
  useEffect(() => () => cancelHoverClose(), []);
  const ratio = contextRatio(usage);
  if (!usage || ratio === null) {
    return empty && !usage && !sessionUsage ? (
      <span
        title={`0% · ${t("No context used yet")}`}
        className="grid size-7 shrink-0 place-items-center"
      >
        <MeterRing ratio={0} label={t("No context used yet")} />
      </span>
    ) : null;
  }

  const { headline, detail } = contextTooltip(usage);
  const session = sessionUsage ? sessionUsageTooltip(sessionUsage) : null;
  const label = [
    `${headline}, ${detail}`,
    ...(session ? [session.headline, ...session.details] : []),
  ].join(". ");
  const actionsOpen = (hovered || open) && onCompact != null;

  return (
    <div
      ref={root}
      className="context-meter relative shrink-0"
      onMouseEnter={enterHover}
      onMouseLeave={leaveHover}
    >
      {onCompact ? (
        <Button
          iconOnly
          label={t("{p0}. Open context actions", { p0: label })}
          variant="ghost"
          size="sm"
          className="size-7 shrink-0"
          type="button"
          title={label}
          aria-label={t("{p0}. Open context actions", { p0: label })}
          aria-expanded={actionsOpen}
          onClick={() => setOpen((value) => !value)}
        >
          <MeterRing ratio={ratio} />
        </Button>
      ) : (
        <span title={label} className="grid size-7 place-items-center">
          <MeterRing ratio={ratio} label={label} />
        </span>
      )}
      {hovered || actionsOpen ? (
        <Popover
          anchor={root}
          side="top"
          align="end"
          role={actionsOpen ? "dialog" : undefined}
          aria-label={actionsOpen ? t("Context usage") : undefined}
          autoFocus={open}
          tabIndex={open ? -1 : undefined}
          onDismiss={
            onCompact
              ? (reason) => {
                  closeActions();
                  if (reason === "escape") root.current?.querySelector("button")?.focus();
                }
              : undefined
          }
          onMouseEnter={enterHover}
          onMouseLeave={leaveHover}
          className={`context-meter-popover px-2.5 py-1.5 ${actionsOpen ? "" : "pointer-events-none"}`}
        >
          <div className="text-[12px] leading-4 text-(--ui-tone-neutral-fg)">{headline}</div>
          <div className="chat-control-secondary text-xs leading-4">{detail}</div>
          {session ? (
            <div className="mt-1.5 border-t border-(--ui-tone-neutral-border) pt-1.5">
              <div className="text-[12px] leading-4 text-(--ui-tone-neutral-fg)">
                {session.headline}
              </div>
              {session.details.map((line) => (
                <div key={line} className="chat-control-secondary text-xs leading-4">
                  {line}
                </div>
              ))}
            </div>
          ) : null}
          {actionsOpen ? (
            <Button
              fullWidth
              variant="item"
              type="button"
              disabled={compactDisabled}
              title={
                compactDisabled
                  ? t("Wait for the current operation to finish")
                  : t("Compact this conversation's context")
              }
              onClick={() => {
                closeActions();
                onCompact?.();
              }}
              className="w-full"
            >
              {t("Compact now")}
            </Button>
          ) : null}
        </Popover>
      ) : null}
    </div>
  );
}

function MeterRing({ ratio, label }: { ratio: number; label?: string }) {
  useLocale();
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={ringClass(ratio)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        className="text-(--ui-border)"
      />
      {/* A round cap would leave a dot on an empty ring. */}
      {ratio > 0 ? (
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      ) : null}
    </svg>
  );
}
