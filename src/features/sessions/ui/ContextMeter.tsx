import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useId, useRef, useState } from "react";
import { contextRatio, formatTokens, type ContextUsage } from "../model/contextUsage";
import { formatApiTime, formatCost, type SessionUsage } from "../model/sessionUsage";
import { Popover } from "../../../shared/ui/Popover";
import { Info } from "../../../shared/ui/icons";
import type { Block } from "../model/session";
import { completedResponseSpeed, responseSpeedFill } from "../model/responseSpeed";
import { isHiddenTool, isSubagentBlock, subagentName } from "../model/transcriptActivity";
import "./chat-controls.css";

/** The outer ring turns amber then red as the context window fills. */
function ringClass(ratio: number): string {
  if (ratio >= 0.9) return "context-meter-danger";
  if (ratio >= 0.75) return "context-meter-warning";
  return "context-meter-neutral";
}

/**
 * Context ring with a central speed bolt; completed response metrics live in its panel.
 *
 * Renders nothing until the harness reports both halves — Cursor's ACP stream
 * carries no usage at all. A completed speed or subagent reading can still be
 * inspected when the parent's capacity is unknown; no capacity is invented.
 */
export function ContextMeter({
  usage,
  sessionUsage,
  contextBlocks = [],
  onCompact,
  compactDisabled = false,
  working = false,
  empty = false,
}: {
  usage?: ContextUsage;
  sessionUsage?: SessionUsage;
  contextBlocks?: readonly Block[];
  onCompact?: () => void;
  compactDisabled?: boolean;
  working?: boolean;
  /** The conversation is confirmed to have no messages or prior usage. */
  empty?: boolean;
}) {
  useLocale();
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const [speedInfoOpen, setSpeedInfoOpen] = useState(false);
  const speedInfoId = useId();
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
    setSpeedInfoOpen(false);
  }
  useEffect(() => () => cancelHoverClose(), []);
  const ratio = contextRatio(usage);
  const speed = completedResponseSpeed(contextBlocks);
  const agents = new Map<string, { name: string; usage?: ContextUsage }>();
  for (const block of contextBlocks) {
    if (!isSubagentBlock(block) || isHiddenTool(block)) continue;
    const id = block.tool?.callId ?? block.id;
    const reading = block.tool?.agentContext;
    const used = reading?.used;
    agents.set(id, {
      name: subagentName(block),
      usage:
        used !== undefined && Number.isFinite(used) && used >= 0 ? reading : agents.get(id)?.usage,
    });
  }
  if ((!usage || ratio === null) && agents.size === 0 && !speed) {
    return empty && !usage && !sessionUsage ? (
      <span
        title={`0% · ${t("No context used yet")}`}
        className="context-meter-summary context-meter-empty"
      >
        <ContextSignal ratio={0} label={`0% · ${t("No context used yet")}`} />
      </span>
    ) : null;
  }

  const detail = usage
    ? `${formatTokens(usage.used)}${ratio !== null ? ` / ${formatTokens(usage.window!)}` : ""} ${t("tokens")}`
    : t("Unavailable");
  const label = [
    detail,
    ...(sessionUsage ? [`${t("Cost")}: ${formatCost(sessionUsage.costUsd)}`] : []),
    ...(sessionUsage && sessionUsage.apiMs > 0
      ? [`${t("API time")}: ${formatApiTime(sessionUsage.apiMs)}`]
      : []),
  ].join(". ");
  const panelOpen = hovered || open;
  const percent = ratio === null ? t("Unknown") : `${Math.round(ratio * 100)}%`;

  return (
    <div
      ref={root}
      className="context-meter relative shrink-0"
      onMouseEnter={enterHover}
      onMouseLeave={leaveHover}
    >
      <Button
        variant="ghost"
        size="sm"
        motion="none"
        iconOnly
        label={t("Context usage")}
        className="context-meter-summary"
        type="button"
        title={t("Context usage")}
        aria-label={`${t("Context usage")}: ${percent}. ${speed ? `${t("Response speed")}: ${speed.tps.toFixed(1)} TPS. ` : ""}${label}`}
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        selected={open}
        onClick={() => (open ? closeActions() : setOpen(true))}
      >
        <ContextSignal ratio={ratio ?? 0} working={working} tps={speed?.tps} />
      </Button>
      {panelOpen ? (
        <Popover
          anchor={root}
          side="top"
          align="end"
          width={280}
          role="dialog"
          aria-label={t("Context usage")}
          autoFocus={open}
          tabIndex={open ? -1 : undefined}
          onDismiss={(reason) => {
            closeActions();
            if (reason === "escape") root.current?.querySelector("button")?.focus();
          }}
          onMouseEnter={enterHover}
          onMouseLeave={leaveHover}
          onFocusCapture={() => setOpen(true)}
          className="context-meter-popover"
        >
          <div className="context-meter-heading">
            <span>{t("Context usage")}</span>
            <strong className={ringClass(ratio ?? 0)}>{percent}</strong>
          </div>
          {ratio !== null ? (
            <div
              role="meter"
              aria-label={t("Context usage")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(ratio * 100)}
              aria-valuetext={detail}
              className={`context-meter-track ${ringClass(ratio)}`}
            >
              <div style={{ inlineSize: `${ratio * 100}%` }} />
            </div>
          ) : null}
          <div className="context-meter-tokens">
            <span>
              {usage
                ? `${formatTokens(usage.used)}${ratio !== null ? ` / ${formatTokens(usage.window!)}` : ""}`
                : t("Unavailable")}
            </span>
            {usage ? <span>{t("tokens")}</span> : null}
          </div>
          <section className="context-meter-speed-details" aria-label={t("Response speed")}>
            <div className="context-meter-heading">
              <span className="inline-flex items-center gap-1">
                {t("Response speed")}
                <Button
                  variant="ghost"
                  size="sm"
                  motion="none"
                  iconOnly
                  label={t("Response speed")}
                  aria-expanded={speedInfoOpen}
                  aria-controls={speedInfoId}
                  onClick={() => setSpeedInfoOpen((value) => !value)}
                >
                  <Info className="size-3.5" />
                </Button>
              </span>
              <strong>{speed ? `${speed.tps.toFixed(1)} TPS` : t("Unavailable")}</strong>
            </div>
            {speedInfoOpen ? (
              <p id={speedInfoId} className="context-meter-hint">
                {t(
                  "Average over the full turn, including tools and waiting; not live generation speed.",
                )}
              </p>
            ) : null}
          </section>
          {agents.size > 0 ? (
            <section className="context-meter-agents" aria-label={t("Subagents")}>
              <div className="context-meter-heading">
                {t("Subagents")} · {agents.size}
              </div>
              <ul className="context-meter-agent-list" tabIndex={0} aria-label={t("Subagents")}>
                {[...agents].map(([id, agent]) => {
                  const agentRatio = contextRatio(agent.usage);
                  return (
                    <li key={id} className="context-meter-agent">
                      <span className="context-meter-agent-name">{agent.name}</span>
                      <span className="context-meter-agent-value">
                        {agentRatio !== null ? (
                          <span className={ringClass(agentRatio)}>
                            {Math.round(agentRatio * 100)}%
                          </span>
                        ) : null}
                        <span>
                          {agent.usage === undefined
                            ? t("Unavailable")
                            : `${formatTokens(agent.usage.used)}${agentRatio !== null ? ` / ${formatTokens(agent.usage.window!)}` : ""} ${t("tokens")}`}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          {sessionUsage ? (
            <dl className="context-meter-stats">
              <div>
                <dt>{t("Cost")}</dt>
                <dd>{formatCost(sessionUsage.costUsd)}</dd>
              </div>
              {sessionUsage.apiMs > 0 ? (
                <div>
                  <dt>{t("API time")}</dt>
                  <dd>{formatApiTime(sessionUsage.apiMs)}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {onCompact ? (
            <div className="context-meter-actions">
              <Button
                fullWidth
                size="sm"
                variant="secondary"
                type="button"
                disabled={compactDisabled}
                title={t("Compact this conversation's context")}
                onClick={() => {
                  closeActions();
                  onCompact();
                }}
              >
                {t("Compact now")}
              </Button>
              {compactDisabled ? (
                <p className="context-meter-hint">
                  {t("Wait for the current operation to finish")}
                </p>
              ) : null}
            </div>
          ) : null}
        </Popover>
      ) : null}
    </div>
  );
}

function ContextSignal({
  ratio,
  label,
  working = false,
  tps,
}: {
  ratio: number;
  label?: string;
  working?: boolean;
  tps?: number;
}) {
  const clipId = useId();
  const fill = responseSpeedFill(tps);
  // The bolt is its own root <svg> so its working pulse animates on the
  // compositor; an animated element inside an SVG repaints every frame.
  return (
    <span className="context-signal-frame" data-working={working ? "true" : undefined}>
      <svg
        width={24}
        height={24}
        viewBox="0 0 24 24"
        className={`context-signal ${ringClass(ratio)}`}
        data-working={working ? "true" : undefined}
        data-speed-fill={fill}
        fill="none"
        strokeWidth={1.8}
        strokeLinecap="round"
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="1.5"
          className="context-signal-track"
        />
        {ratio > 0 ? (
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="1.5"
            pathLength="100"
            strokeDasharray="100"
            strokeDashoffset={100 * (1 - ratio)}
            transform="rotate(-90 12 12)"
          />
        ) : null}
      </svg>
      <svg
        width={24}
        height={24}
        viewBox="0 0 24 24"
        className="context-speed-bolt"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="8" y={17.2 - 10.4 * fill} width="8" height={10.4 * fill} />
          </clipPath>
        </defs>
        <path
          d="M13.5 6.8 8.5 12.5h3.3l-1.3 4.7 5-6.3h-3.2z"
          stroke="currentColor"
          strokeWidth="0.7"
          strokeLinejoin="round"
          className="context-speed-outline"
        />
        {fill > 0 ? (
          <path
            d="M13.5 6.8 8.5 12.5h3.3l-1.3 4.7 5-6.3h-3.2z"
            fill="currentColor"
            clipPath={`url(#${clipId})`}
          />
        ) : null}
      </svg>
    </span>
  );
}
