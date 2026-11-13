import styles from "./GitGraphList.module.css";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { t, useLocale } from "../../../shared/i18n/git";
import { useMemo } from "react";
import { GitBranch, Globe } from "../../../shared/ui/icons";
import { historyItemGraph, type HistoryItemViewModel } from "../model/gitGraph";
import {
  authorColor,
  authorInitials,
  splitRefsForBudget,
  type GraphRefChip,
} from "../model/gitGraphDisplay";

/** Longest a single ref pill grows before it truncates. */
export const PILL_MAX_PX = 104;

const REF_KIND_LABEL: Record<string, string> = {
  local: "Branch",
  remote: "Remote branch",
  tag: "Tag",
};

export function refTitle(ref: GraphRefChip): string {
  return `${REF_KIND_LABEL[ref.kind] ?? "Ref"}: ${ref.name}${ref.current ? " (current)" : ""}`;
}

/** The lane drawing of one row. Neighbouring rows rely on its overflow. */
export function GraphLane({ row }: { row: HistoryItemViewModel }) {
  useLocale();
  const graph = historyItemGraph(row);
  return (
    <svg
      aria-hidden
      className="git-history-graph pointer-events-none block shrink-0 overflow-visible"
      width={graph.width}
      height={graph.height}
      overflow="visible"
    >
      {graph.paths.map((path, pathIndex) => (
        <path
          key={pathIndex}
          d={path.d}
          fill="none"
          stroke={path.color}
          strokeWidth={path.strokeWidth}
          strokeLinecap="round"
        />
      ))}
      {graph.circles.map((circle, circleIndex) => (
        <circle
          key={circleIndex}
          cx={circle.cx}
          cy={circle.cy}
          r={circle.r}
          fill={circle.fill ?? "none"}
          strokeWidth={circle.strokeWidth}
        />
      ))}
    </svg>
  );
}

export function GraphAvatar({
  name,
  size = 14,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  useLocale();
  return (
    <Tooltip label={name || t("Unknown author")} asChild>
      <Text
        as="span"
        size="glyph"
        tone="background-base"
        weight="medium"
        leading="none"
        aria-hidden

        {...surfaceAttributes(
          { radius: "pill", variant: "user-color" },
          `grid shrink-0 place-items-center select-none ${styles.graphAvatar} ${className}`,
        )}
        style={
          {
            "--graph-avatar-size": `${size}px`,
            fontSize: Math.round(size * 0.5),
            color: "var(--color-background-base)",
            "--surface-user-color": authorColor(name),
          } as React.CSSProperties
        }
      >
        {authorInitials(name)}
      </Text>
    </Tooltip>
  );
}

function TagGlyph() {
  useLocale();
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="icon-xs shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
    >
      <path d="M2.5 2.5h5.6l5.4 5.4a1 1 0 0 1 0 1.4l-4.2 4.2a1 1 0 0 1-1.4 0L2.5 8.1z" />
      <circle cx="5.6" cy="5.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RefPill({ refInfo }: { refInfo: GraphRefChip }) {
  useLocale();
  return (
    <Tooltip label={refTitle(refInfo)} asChild>
      <Text
        as="span"
        tone={refInfo.color ? "background-base" : "secondary"}
        weight={refInfo.current ? "medium" : undefined}
        leading="none"

        {...surfaceAttributes(
          {
            radius: refInfo.kind === "tag" ? "control" : "pill",
            ring: refInfo.current ? "pane-outer" : undefined,
            variant: refInfo.color ? "user-color" : "inset",
          },
          `flex h-4 min-w-0 shrink items-center gap-0.5 px-1.5 ${styles.refPill}`,
        )}
        style={
          {
            "--graph-pill-max": `${PILL_MAX_PX}px`,
            "--surface-user-color": refInfo.color,
          } as React.CSSProperties
        }
      >
        {refInfo.kind === "tag" ? (
          <TagGlyph />
        ) : refInfo.kind === "remote" ? (
          <Globe className="icon-xs shrink-0" strokeWidth={2} />
        ) : (
          <GitBranch className="icon-xs shrink-0" strokeWidth={2} />
        )}
        <Text as="span" size="inherit" tone="inherit" truncate className="min-w-0">
          {refInfo.name}
        </Text>
      </Text>
    </Tooltip>
  );
}

/**
 * Pills that fit `budgetPx`; the rest collapse into a "+N" pill whose tooltip
 * lists them. The group never grows past `maxWidth`.
 */
export function RefPills({
  refs,
  budgetPx,
  maxWidth,
  className = "",
}: {
  refs: readonly GraphRefChip[];
  budgetPx: number;
  maxWidth: string;
  className?: string;
}) {
  useLocale();
  const { shown, hidden } = useMemo(
    () => splitRefsForBudget(refs, budgetPx, PILL_MAX_PX),
    [refs, budgetPx],
  );
  if (refs.length === 0) return null;
  return (
    <span
      className={`flex min-w-0 items-center gap-1 overflow-hidden ${styles.refGroup} ${className}`}
      style={{ "--graph-refs-max": maxWidth } as React.CSSProperties}
    >
      {shown.map((ref) => (
        <RefPill key={`${ref.kind}:${ref.name}`} refInfo={ref} />
      ))}
      {hidden.length > 0 ? (
        <Tooltip label={hidden.map(refTitle).join("\n")} asChild>
          <Text
            size="caption"
            tone="secondary"
            leading="none"
            {...surfaceAttributes(
              { radius: "pill", variant: "inset" },
              "flex h-4 shrink-0 items-center px-1.5",
            )}
          >
            +{hidden.length}
          </Text>
        </Tooltip>
      ) : null}
    </span>
  );
}

export function GraphSearchInput({
  value,
  autoFocus,
  onChange,
  onEscape,
}: {
  value: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onEscape?: () => void;
}) {
  useLocale();
  return (
    <SearchInput
      appearance="field"
      standalone
      type="text"
      value={value}
      autoFocus={autoFocus}
      placeholder={t("Message, author, branch, or commit ID")}
      aria-label={t("Search commits")}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={
        onEscape
          ? (event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              onEscape();
            }
          : undefined
      }
      containerClassName="w-full"
    />
  );
}
