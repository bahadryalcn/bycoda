import { Button } from "../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { useT } from "../../../shared/i18n";
import { useId, useMemo, useRef, useState } from "react";
import { contextRatio, formatTokens, type ContextUsage } from "../model/contextUsage";
import { formatApiTime, formatCost, type SessionUsage } from "../model/sessionUsage";
import { Meter, meterTone } from "../../../shared/ui/Meter";
import { Popover } from "../../../shared/ui/Popover";
import { useHoverCard } from "../../../shared/ui/HoverCard";
import { Info } from "../../../shared/ui/icons";
import type { Block } from "../model/session";
import { completedResponseSpeed, responseSpeedFill } from "../model/responseSpeed";
import { isHiddenTool, isSubagentBlock, subagentName } from "../model/transcriptActivity";
import "./chat-controls.css";

const NO_BLOCKS: readonly Block[] = [];

/** Ratios at which the meter turns amber, then red, as the context window fills. */
const WARNING_PERCENT = 75;
const DANGER_PERCENT = 90;

/** Text tone matching the meter's own: neutral, amber, red. */
function ringClass(ratio: number): string {
  const tone = meterTone(ratio * 100, { warning: WARNING_PERCENT, danger: DANGER_PERCENT });
  if (tone === "danger") return "context-meter-danger";
  if (tone === "warning") return "context-meter-warning";
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
  contextBlocks = NO_BLOCKS,
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const [speedInfoOpen, setSpeedInfoOpen] = useState(false);
  const speedInfoId = useId();
  const root = useRef<HTMLDivElement>(null);
  // Hover and keyboard focus preview the panel; a click pins it (the Popover below).
  const hover = useHoverCard({
    side: "top",
    align: "end",
    width: 280,
    disabled: open,
    className: "context-meter-popover",
    "aria-label": t("Context usage"),
  });
  function closeActions() {
    hover.close();
    setOpen(false);
    setSpeedInfoOpen(false);
  }
  const ratio = contextRatio(usage);
  // Scans the whole transcript: only redo it when the blocks change, not per keystroke.
  const speed = useMemo(() => completedResponseSpeed(contextBlocks), [contextBlocks]);
  const agents = useMemo(() => subagentReadings(contextBlocks), [contextBlocks]);
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
  const panelOpen = hover.open || open;
  // The speed explanation is per opening: a hover card closed by Escape or leave starts collapsed.
  if (!panelOpen && speedInfoOpen) setSpeedInfoOpen(false);
  const percent = ratio === null ? t("Unknown") : `${Math.round(ratio * 100)}%`;

  // Built only while a panel shows: the meter re-renders with the composer.
  const renderPanel = () => (
    <>
      <div className="context-meter-heading">
        <span>{t("Context usage")}</span>
        <strong className={ringClass(ratio ?? 0)}>{percent}</strong>
      </div>
      {ratio !== null ? (
        <Meter
          label={t("Context usage")}
          value={Math.round(ratio * 100)}
          warning={WARNING_PERCENT}
          danger={DANGER_PERCENT}
          valueText={detail}
          size="md"
          className="my-3"
        />
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
              <Info className="icon-sm" />
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
                      <span className={ringClass(agentRatio)}>{Math.round(agentRatio * 100)}%</span>
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
        <DescriptionList size="sm" className="context-meter-stats">
          <DescriptionItem term={t("Cost")}>{formatCost(sessionUsage.costUsd)}</DescriptionItem>
          {sessionUsage.apiMs > 0 ? (
            <DescriptionItem term={t("API time")}>
              {formatApiTime(sessionUsage.apiMs)}
            </DescriptionItem>
          ) : null}
        </DescriptionList>
      ) : null}
      {onCompact ? (
        <div className="context-meter-actions">
          <Button
            fullWidth
            size="sm"
            variant="secondary"
            type="button"
            disabled={compactDisabled}
            onClick={() => {
              closeActions();
              onCompact();
            }}
          >
            {t("Compact now")}
          </Button>
          {compactDisabled ? (
            <p className="context-meter-hint">{t("Wait for the current operation to finish")}</p>
          ) : null}
        </div>
      ) : null}
    </>
  );

  return (
    <div ref={root} className="context-meter relative shrink-0" {...hover.trigger}>
      <Button
        variant="ghost"
        size="sm"
        motion="none"
        iconOnly
        label={t("Context usage")}
        className="context-meter-summary"
        type="button"
        // The hover/focus card already previews the full panel; a hint would cover it twice.
        title=""
        aria-label={`${t("Context usage")}: ${percent}. ${speed ? `${t("Response speed")}: ${speed.tps.toFixed(1)} TPS. ` : ""}${label}`}
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        selected={open}
        onClick={() => (open ? closeActions() : setOpen(true))}
      >
        <ContextSignal ratio={ratio ?? 0} working={working} tps={speed?.tps} />
      </Button>
      {open ? (
        <Popover
          anchor={root}
          side="top"
          align="end"
          width={280}
          role="dialog"
          aria-label={t("Context usage")}
          autoFocus
          tabIndex={-1}
          onDismiss={(reason) => {
            closeActions();
            if (reason === "escape") root.current?.querySelector("button")?.focus();
          }}
          className="context-meter-popover"
        >
          {renderPanel()}
        </Popover>
      ) : (
        hover.card(renderPanel)
      )}
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
      <Meter
        variant="ring"
        size="md"
        label={label}
        aria-hidden={label ? undefined : true}
        value={ratio * 100}
        warning={WARNING_PERCENT}
        danger={DANGER_PERCENT}
        className="context-signal"
        data-working={working ? "true" : undefined}
        data-speed-fill={fill}
      />
      <span className="context-speed-pulse">
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
    </span>
  );
}

function subagentReadings(blocks: readonly Block[]) {
  const agents = new Map<string, { name: string; usage?: ContextUsage }>();
  for (const block of blocks) {
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
  return agents;
}
